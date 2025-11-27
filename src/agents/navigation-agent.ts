import fs from 'fs';
import path from 'path';
import { GPT4Client } from '../utils/gpt-client';
import { PlaywrightManager } from '../automation/playwright-manager';
import { VISION_DECISION_PROMPT, TASK_PLANNING_PROMPT } from '../utils/prompts';
import { config } from '../utils/config';
import { generateDataset } from '../output/generate-dataset';

export interface ActionEntry {
  step: number;
  action: {
    type: string;
    target: string;
    value?: string;
    reasoning: string;
  };
  description: string;
  timestamp: string;
  progressAssessment: number;
  isKeyState: boolean;
}

interface ExecutionPlan {
  maxSteps: number;
  appName: string;
  baseUrl: string;
}

export class NavigationAgent {
  private gpt: GPT4Client;
  private pw: PlaywrightManager;

  constructor(pw: PlaywrightManager) {
    this.gpt = new GPT4Client();
    this.pw = pw;
  }

  async execute(task: string): Promise<ActionEntry[]> {
    const taskName = this.sanitizeTaskName(task);
    const screenshotDir = this.setupDirectories(taskName);
    const history: ActionEntry[] = [];

    // 1. Plan
    const plan = await this.createExecutionPlan(task);
    
    // 2. Auth Check
    await this.ensureSession();

    // 3. Execution Loop
    let step = 0;
    let complete = false;

    console.log(`\n--- Starting Task: ${task} ---`);
    console.log(`Max Steps: ${plan.maxSteps}`);

    try {
      while (!complete && step < plan.maxSteps) {
        console.log(`\n--- Step ${step} ---`);

        // A. Stuck Detection & Recovery
        if (this.detectAndHandleStuckState(history, step, taskName)) {
          // If true, we need to backtrack.
          // Remove last 2 entries and retry from previous state.
          history.splice(-2);
          step = history.length;
          console.log(`Backtracking to step ${step}...`);
          continue;
        }

        // B. Capture State
        await this.captureState(step, taskName, history);
        const screenshotPath = path.join(screenshotDir, `step_${String(step).padStart(3, '0')}.png`);
        const domContext = await this.getRobustDOM();
        const currentUrl = this.pw.getCurrentUrl();

        // C. Build Prompt
        const recoveryContext = this.buildRecoveryContext(history);
        const prompt = VISION_DECISION_PROMPT
          .replace('{objective}', task)
          .replace('{actionHistory}', JSON.stringify(this.compactHistory(history.slice(-3))))
          .replace('{domContext}', domContext.substring(0, 3000))
          .replace('{currentUrl}', currentUrl)
          .replace('{recoveryContext}', recoveryContext);

        // D. Decide
        const decision = await this.gpt.analyzeScreenshot(screenshotPath, prompt);
        
        // E. Refine Decision (Business Logic Heuristics)
        this.refineDecision(decision, history, task);

        console.log(`Decision: ${decision.nextAction.type} -> "${decision.nextAction.target}"`);
        console.log(`Reasoning: ${decision.nextAction.reasoning}`);
        console.log(`Progress: ${decision.progressAssessment}%`);

        // F. Execute or Complete
        if (decision.nextAction.type === 'complete') {
          complete = true;
          console.log('Task marked as complete by agent.');
        } else {
          await this.pw.executeAction(decision.nextAction);
          
          // Post-action check: Auto-complete if we detect success patterns
          if (this.checkImplicitCompletion(task, decision, history)) {
            complete = true;
          }

          // Periodic session save (less frequent, only on key states)
          if ((step % 5 === 0 || decision.isKeyState) && (await this.pw.isLoggedIn())) {
            await this.pw.saveSession();
          }
        }

        // G. Record History
        history.push({
          step,
          action: decision.nextAction,
          description: decision.stateDescription,
          timestamp: new Date().toISOString(),
          progressAssessment: decision.progressAssessment,
          isKeyState: decision.isKeyState,
        });

        step++;
      }

      if (step >= plan.maxSteps) console.warn('Warning: Reached maximum steps limit.');

    } catch (error) {
      console.error(`Execution Fatal Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await this.finalize(taskName, history, step);
    }

    return history;
  }

  // --- Phases ---

  private async createExecutionPlan(task: string): Promise<ExecutionPlan> {
    const appName = this.detectApp(task);
    // Generic URL selection - use detected app or current URL domain
    const baseUrl = this.getBaseUrlForApp(appName);
    let maxSteps = config.agent.maxSteps;

    try {
      const planningPrompt = TASK_PLANNING_PROMPT
        .replace('{task}', task)
        .replace('{appName}', appName)
        .replace('{baseUrl}', baseUrl);

      const plan = await this.gpt.planTask(planningPrompt);
      
      console.log(`Plan: ${plan.taskName} (${plan.complexity})`);
      console.log(`Milestones: ${plan.keyMilestones.join(' -> ')}`);
      
      // Heuristic: GPT estimate + buffer
      maxSteps = Math.min(config.agent.maxSteps, plan.estimatedSteps + 3);
    } catch (err) {
      console.warn('Planning failed, using defaults.', err);
    }

    return { maxSteps, appName, baseUrl };
  }

  private async ensureSession(): Promise<void> {
    const isLoggedIn = await this.pw.isLoggedIn();
    if (isLoggedIn) {
      console.log('Session: Valid auth detected.');
      await this.pw.saveSession();
    } else {
      console.log('Session: Not logged in. Agent will attempt login.');
    }
  }

  // --- Logic Helpers ---

  /**
   * Returns true if the agent is stuck and we should BACKTRACK.
   * Throws if we cannot recover.
   */
  private detectAndHandleStuckState(history: ActionEntry[], step: number, taskName: string): boolean {
    if (!this.isStuck(history)) return false;

    const stuckAction = history[history.length - 1].action;
    console.error(`\nSTUCK: Repeated failure on ${stuckAction.type} -> "${stuckAction.target}"`);

    const recoveryCount = history.filter(h => h.description?.includes('RECOVERY_MODE')).length;
    
    if (recoveryCount >= 3) {
      throw new Error('Max recovery attempts reached. Terminating execution loop.');
    }

    // Capture the failure state before backtracking
    this.pw.captureStateWithMetadata(step, taskName).catch(() => {});

    if (history.length >= 2) {
      console.log(`Attempting recovery ${recoveryCount + 1}/3...`);
      // Mark current state as recovery mode for prompts
      history[history.length - 1].description += ' [RECOVERY_MODE]';
      return true; // Signal to backtrack
    }

    throw new Error('Stuck at start of task. Cannot backtrack.');
  }

  /**
   * Applies business rules to modify the GPT decision if necessary.
   * e.g., Preventing premature completion of multi-step tasks.
   */
  private refineDecision(decision: any, history: ActionEntry[], task: string): void {
    const taskLower = task.toLowerCase();
    
    // Rule 1: "Create with description" must not finish after just title
    const hasDescriptionRequest = taskLower.includes('description') && taskLower.includes('create');
    const hasTitle = history.some(h => h.action.type === 'type' && /title/i.test(h.action.target || ''));
    const hasDescription = history.some(h => h.action.type === 'type' && /description/i.test(h.action.target || ''));

    if (decision.nextAction.type === 'complete' && hasDescriptionRequest && hasTitle && !hasDescription) {
      console.log('Refinement: Blocking premature completion (Description missing)');
      decision.nextAction = {
        type: 'click',
        target: 'Add description',
        reasoning: 'Task requires description to be added after creating issue.'
      };
      decision.progressAssessment = 60;
      return;
    }

    // Rule 2: "Create and Assign" must not finish after just creation
    const isMultiStep = (taskLower.includes('and') || taskLower.includes('then')) &&
                        taskLower.includes('create') && 
                        taskLower.includes('assign');

    if (decision.nextAction.type === 'complete' && isMultiStep) {
      const hasCreated = history.some(h => h.action.type === 'type' && /title|issue/i.test(h.action.target || ''));
      const hasAssigned = history.some(h => /assign/i.test(h.action.target || ''));

      if (hasCreated && !hasAssigned) {
        console.log('Refinement: Blocking premature completion (Assignment missing)');
        decision.nextAction = {
          type: 'click',
          target: 'Assignee field',
          reasoning: 'Task requires assignment after creation.'
        };
        decision.progressAssessment = 70;
        return;
      }
    }

    // Rule 2: Repeated clicks on the same target usually mean the UI isn't updating 
    // or we are done but GPT doesn't realize it.
    if (decision.nextAction.type === 'click' && decision.progressAssessment > 80 && history.length >= 2) {
      const lastTwo = history.slice(-2);
      const isRepeated = lastTwo.every(h => 
        h.action.type === 'click' && h.action.target === decision.nextAction.target
      );

      if (isRepeated && (taskLower.includes('status') || taskLower.includes('assign'))) {
        console.log('Refinement: Repeated clicks detected. Inferring completion.');
        decision.nextAction = {
          type: 'complete',
          target: 'Task completed',
          reasoning: 'Repeated interaction suggests UI state is final.'
        };
        decision.progressAssessment = 100;
      }
    }
  }

  private checkImplicitCompletion(task: string, decision: any, history: ActionEntry[]): boolean {
    // If we are changing status, and we keep trying to click the new status, we are likely done.
    if (task.toLowerCase().includes('status') && decision.progressAssessment >= 80 && history.length >= 2) {
      const match = task.match(/to\s+(.+?)(?:\s+in|\s*$)/i);
      if (match) {
        const targetStatus = match[1].trim().toLowerCase();
        const recentClicks = history.slice(-3).filter(h => 
          h.action.target.toLowerCase().includes(targetStatus)
        );
        
        if (recentClicks.length >= 2) {
          console.log(`Implicit Completion: Status "${targetStatus}" appears set.`);
          return true;
        }
      }
    }
    return false;
  }

  private async getRobustDOM(): Promise<string> {
    let dom = await this.pw.getSimplifiedDOM();
    if (dom === '[]' || dom.length < 10) {
      console.warn('DOM empty, retrying after wait...');
      await this.pw.waitForStable();
      dom = await this.pw.getSimplifiedDOM();
    }
    return dom;
  }

  private buildRecoveryContext(history: ActionEntry[]): string {
    const failures = history.slice(-3).filter(h => 
      h.description?.toLowerCase().includes('not found') || 
      h.description?.includes('RECOVERY_MODE')
    ).length;

    if (failures >= 2) {
      return `\nRECOVERY MODE: Previous actions failed. \nGUIDANCE:\n- If changing status: Click Issue ID first, then Status dropdown.\n- If assigning: Open issue detail page first.\n- Avoid "Status badge of..." targets.`;
    }

    return '';
  }

  // --- Internal Utilities ---

  private async captureState(step: number, taskName: string, history: ActionEntry[]): Promise<void> {
    // Capture on step 0 or if something significant happened (key state)
    const shouldCapture = step === 0 || (history.length > 0 && history[history.length - 1].isKeyState);
    if (shouldCapture) {
      await this.pw.captureStateWithMetadata(step, taskName);
    }
  }

  private async finalize(taskName: string, history: ActionEntry[], steps: number): Promise<void> {
    console.log(`Task finalized. Total steps: ${steps}`);
    // Save final screenshot logic is handled by 'complete' action or stuck handler
    try {
      await generateDataset(taskName, history);
    } catch (err) {
      console.error('Dataset generation failed:', err);
    }
  }

  private setupDirectories(taskName: string): string {
    const dir = path.join(config.paths.screenshots, taskName);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private detectApp(task: string): string {
    const lower = task.toLowerCase();
    // Detect app from task description or URL patterns
    if (lower.includes('notion')) return 'notion';
    if (lower.includes('asana')) return 'asana';
    if (lower.includes('linear')) return 'linear';
    if (lower.includes('github')) return 'github';
    if (lower.includes('jira')) return 'jira';
    if (lower.includes('trello')) return 'trello';
    
    // Try to detect from current URL
    const currentUrl = this.pw.getCurrentUrl();
    if (currentUrl.includes('notion.so') || currentUrl.includes('notion.com')) return 'notion';
    if (currentUrl.includes('asana.com')) return 'asana';
    if (currentUrl.includes('linear.app')) return 'linear';
    if (currentUrl.includes('github.com')) return 'github';
    if (currentUrl.includes('jira')) return 'jira';
    if (currentUrl.includes('trello.com')) return 'trello';
    
    // Default to generic - let the system figure it out
    return 'generic';
  }

  private getBaseUrlForApp(appName: string): string {
    // Map app names to URLs, fallback to current URL or generic
    const urlMap: Record<string, string> = {
      notion: config.urls.notion,
      asana: config.urls.asana,
      linear: config.urls.linear,
    };
    
    if (urlMap[appName]) {
      return urlMap[appName];
    }
    
    // For unknown apps, try to extract from current URL
    const currentUrl = this.pw.getCurrentUrl();
    if (currentUrl) {
      try {
        const urlObj = new URL(currentUrl);
        return `${urlObj.protocol}//${urlObj.host}`;
      } catch {
        // Invalid URL, use default
      }
    }
    
    // Ultimate fallback
    return config.urls.linear; // Keep as fallback but should rarely be used
  }

  private sanitizeTaskName(task: string): string {
    return task.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 50);
  }

  private compactHistory(history: ActionEntry[]): Array<{ step: number; type: string; target: string; progress: number }> {
    return history.map(h => ({
      step: h.step,
      type: h.action.type,
      target: h.action.target,
      progress: h.progressAssessment
    }));
  }

  private isStuck(history: ActionEntry[]): boolean {
    if (history.length < 3) return false;

    const last3 = history.slice(-3);
    const first = last3[0];

    // Same action 3 times?
    const sameAction = last3.every(h => 
      h.action.target === first.action.target && h.action.type === first.action.type
    );
    
    // No progress?
    const stagnant = last3.every(h => 
      Math.abs(h.progressAssessment - first.progressAssessment) < 5
    );

    // Constant errors?
    const errors = last3.every(h => 
      h.description.toLowerCase().includes('not found') || 
      h.action.reasoning.toLowerCase().includes('not found')
    );

    return (sameAction && stagnant) || errors;
  }
}
