import fs from 'fs';
import path from 'path';
import { GPT4Client } from '../utils/gpt-client';
import { PlaywrightManager } from '../automation/playwright-manager';
import { VISION_DECISION_PROMPT, TASK_PLANNING_PROMPT, VISION_DECISION_PROMPT_SOM } from '../utils/prompts';
import { config } from '../utils/config';
import { generateDataset } from '../output/generate-dataset';
import { SetOfMarksGenerator } from '../perception/som-generator';
import { StateObserver } from '../perception/state-observer';
import { AccessibilityTreeExtractor } from '../perception/accessibility-tree';
import { UniversalElementResolver } from '../execution/universal-element-resolver';

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

    // 3. Initialize SoM and State Observer
    const somGenerator = new SetOfMarksGenerator(this.pw.getPage());
    const stateObserver = new StateObserver(this.pw.getPage());

    // Start observing state changes
    await stateObserver.startObserving(async (change) => {
      console.log(`State change detected: ${change.description}`);
      if (change.requiresScreenshot) {
        await this.captureStateWithSoM(history.length, taskName, somGenerator);
      }
    });

    // 4. Execution Loop
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

        // B. PERCEPTION - Generate Set-of-Marks (with fallback)
        let somElements: any[] = [];
        let screenshotPath: string;
        
        try {
          const somResult = await somGenerator.generate();
          if (somResult.elements.length > 0 && somResult.annotatedScreenshot) {
            somElements = somResult.elements;
            screenshotPath = somResult.annotatedScreenshot;
            console.log(`SoM generated: ${somElements.length} elements`);
          } else {
            // Fallback to regular screenshot
            screenshotPath = path.join(screenshotDir, `step_${String(step).padStart(3, '0')}.png`);
            await this.pw.screenshot(screenshotPath);
            console.log('SoM failed, using regular screenshot');
          }
        } catch (somError) {
          console.warn('SoM generation error, using fallback:', somError);
          screenshotPath = path.join(screenshotDir, `step_${String(step).padStart(3, '0')}.png`);
          await this.pw.screenshot(screenshotPath);
        }
        
        // C. CONTEXT - Extract accessibility tree (structured)
        const treeExtractor = new AccessibilityTreeExtractor(this.pw.getPage());
        const accessibilityTree = await treeExtractor.extract();
        const currentUrl = this.pw.getCurrentUrl();

        // D. Build Prompt (SoM-aware if we have elements, otherwise use regular prompt)
        const recoveryContext = this.buildRecoveryContext(history);
        const useSoMPrompt = somElements.length > 0;
        const prompt = useSoMPrompt
          ? VISION_DECISION_PROMPT_SOM
              .replace('{objective}', task)
              .replace('{currentUrl}', currentUrl)
              .replace('{accessibilityTree}', JSON.stringify(accessibilityTree, null, 2))
              .replace('{actionHistory}', JSON.stringify(this.compactHistory(history.slice(-3))))
              .replace('{recoveryContext}', recoveryContext)
          : VISION_DECISION_PROMPT
              .replace('{objective}', task)
              .replace('{actionHistory}', JSON.stringify(this.compactHistory(history.slice(-3))))
              .replace('{domContext}', JSON.stringify(accessibilityTree, null, 2).substring(0, 3000))
              .replace('{currentUrl}', currentUrl)
              .replace('{recoveryContext}', recoveryContext);

        // E. REASONING - GPT-4V decides next action
        const decision = await this.gpt.analyzeScreenshot(screenshotPath, prompt);
        
        // F. Refine Decision (Business Logic Heuristics)
        this.refineDecision(decision, history, task);

        console.log(`Decision: ${decision.nextAction.type} -> somId: ${(decision.nextAction as any).somId || 'N/A'}`);
        console.log(`Reasoning: ${decision.nextAction.reasoning}`);
        console.log(`Progress: ${decision.progressAssessment}%`);

        // G. EXECUTION - Resolve element and execute
        if (decision.nextAction.type === 'complete') {
          complete = true;
          console.log('Task marked as complete by agent.');
        } else {
          try {
            if (useSoMPrompt && somElements.length > 0) {
              // Use SoM-based resolution
              const resolver = new UniversalElementResolver(this.pw.getPage(), somElements);
              
              if ((decision.nextAction as any).somId && (decision.nextAction as any).somId > 0) {
                const element = await resolver.resolveByID((decision.nextAction as any).somId);
                if (element) {
                  await this.executeActionOnElement(decision.nextAction, element, resolver);
                } else {
                  console.error(`Failed to resolve SoM ID: ${(decision.nextAction as any).somId}`);
                  // Fallback to description-based resolution
                  const fallback = await resolver.resolveByDescription(decision.nextAction.reasoning || decision.nextAction.target);
                  if (fallback) {
                    await this.executeActionOnElement(decision.nextAction, fallback, resolver);
                  } else {
                    console.warn('SoM resolution failed, waiting and continuing...');
                    await this.pw.getPage().waitForTimeout(1000);
                  }
                }
              } else {
                // No valid somId - try description-based resolution
                const element = await resolver.resolveByDescription(decision.nextAction.reasoning || decision.nextAction.target);
                if (element) {
                  await this.executeActionOnElement(decision.nextAction, element, resolver);
                } else {
                  console.warn('SoM description resolution failed, waiting and continuing...');
                  await this.pw.getPage().waitForTimeout(1000);
                }
              }
            } else {
              // Fallback: Use coordinate-based click if we have target
              console.log('Using fallback execution (no SoM elements available)');
              const page = this.pw.getPage();
              
              if (decision.nextAction.type === 'click') {
                // Try to find element by text/role
                const locator = page.getByRole('button', { name: new RegExp(decision.nextAction.target, 'i') })
                  .or(page.getByText(new RegExp(decision.nextAction.target, 'i')))
                  .first();
                if (await locator.isVisible().catch(() => false)) {
                  await locator.click();
                } else {
                  console.warn(`Could not find element: ${decision.nextAction.target}`);
                }
              } else if (decision.nextAction.type === 'type') {
                const locator = page.getByPlaceholder(new RegExp(decision.nextAction.target, 'i'))
                  .or(page.getByRole('textbox', { name: new RegExp(decision.nextAction.target, 'i') }))
                  .first();
                if (await locator.isVisible().catch(() => false)) {
                  await locator.fill(decision.nextAction.value || '');
                } else {
                  console.warn(`Could not find input: ${decision.nextAction.target}`);
                }
              } else if (decision.nextAction.type === 'navigate') {
                await this.pw.navigate(decision.nextAction.target || decision.nextAction.value || '');
              } else if (decision.nextAction.type === 'wait') {
                await page.waitForTimeout(3000);
              }
              
              await this.pw.waitForStable();
            }
          } catch (execError) {
            console.error(`Action execution failed: ${execError instanceof Error ? execError.message : String(execError)}`);
            // Continue to next step instead of crashing
          }
          
          // Post-action check: Auto-complete if we detect success patterns
          if (this.checkImplicitCompletion(task, decision, history)) {
            complete = true;
          }

          // Periodic session save (less frequent, only on key states)
          if ((step % 5 === 0 || decision.isKeyState) && (await this.pw.isLoggedIn())) {
            await this.pw.saveSession();
          }
        }

        // H. Record History
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
      await stateObserver.stopObserving();
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


  private async captureStateWithSoM(step: number, taskName: string, somGenerator: SetOfMarksGenerator): Promise<void> {
    const { annotatedScreenshot } = await somGenerator.generate();
    const screenshotDir = path.join(config.paths.screenshots, taskName);
    const targetPath = path.join(screenshotDir, `step_${String(step).padStart(3, '0')}_som.png`);
    
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    
    // Copy the SoM screenshot to the target location
    if (fs.existsSync(annotatedScreenshot)) {
      fs.copyFileSync(annotatedScreenshot, targetPath);
    }
  }

  private async executeActionOnElement(action: any, element: any, resolver: UniversalElementResolver): Promise<void> {
    const page = this.pw.getPage();
    
    try {
      if (action.type === 'click') {
        if (element && typeof element.click === 'function') {
          await element.scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
          await element.click({ timeout: 5000 });
          console.log(`Clicked element via SoM resolution`);
        } else {
          // Coordinate-based click already happened in resolver
          console.log(`Clicked element via coordinate fallback`);
          await page.waitForTimeout(500);
        }
      } else if (action.type === 'type') {
        if (element && typeof element.fill === 'function') {
          await element.fill(action.value || '');
          console.log(`Typed "${action.value}" via fill`);
        } else if (element && typeof element.type === 'function') {
          await element.type(action.value || '', { delay: 50 });
          console.log(`Typed "${action.value}" via type`);
        } else {
          // Fallback: use keyboard typing
          await page.keyboard.type(action.value || '', { delay: 50 });
          console.log(`Typed "${action.value}" via keyboard`);
        }
      } else if (action.type === 'navigate') {
        await this.pw.navigate(action.target || action.value);
        console.log(`Navigated to: ${action.target || action.value}`);
      } else if (action.type === 'wait') {
        await page.waitForTimeout(3000);
        console.log('Waited 3 seconds');
      } else if (action.type === 'scroll') {
        await page.keyboard.press('PageDown');
        console.log('Scrolled down');
      }
      
      // Wait for UI to stabilize after action
      await this.pw.waitForStable();
    } catch (error) {
      console.error(`Action execution failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
