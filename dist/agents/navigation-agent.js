"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NavigationAgent = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const gpt_client_1 = require("../utils/gpt-client");
const prompts_1 = require("../utils/prompts");
const config_1 = require("../utils/config");
const generate_dataset_1 = require("../output/generate-dataset");
class NavigationAgent {
    gpt;
    pw;
    constructor(pw) {
        this.gpt = new gpt_client_1.GPT4Client();
        this.pw = pw;
    }
    async execute(task) {
        const history = [];
        const taskName = this.sanitizeTaskName(task);
        const screenshotDir = path_1.default.join(config_1.config.paths.screenshots, taskName);
        this.ensureCleanDir(screenshotDir);
        let maxSteps = config_1.config.agent.maxSteps;
        try {
            const appName = this.detectApp(task);
            const baseUrl = appName === 'notion' ? config_1.config.urls.notion : config_1.config.urls.linear;
            const planningPrompt = prompts_1.TASK_PLANNING_PROMPT
                .replace('{task}', task)
                .replace('{appName}', appName)
                .replace('{baseUrl}', baseUrl);
            const plan = await this.gpt.planTask(planningPrompt);
            console.log(`\nPlanning: ${plan.taskName}`);
            console.log(`   Estimated steps: ${plan.estimatedSteps}`);
            console.log(`   Complexity: ${plan.complexity}`);
            if (plan.keyMilestones.length > 0) {
                console.log(`   Milestones: ${plan.keyMilestones.join(' → ')}`);
            }
            maxSteps = Math.min(config_1.config.agent.maxSteps, plan.estimatedSteps + 3);
            console.log(`   Max steps set to: ${maxSteps}\n`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn('Planning failed, using default maxSteps:', errorMessage);
        }
        const isLoggedIn = await this.pw.isLoggedIn();
        if (isLoggedIn) {
            console.log('Already logged in, proceeding with task');
            await this.pw.saveSession();
        }
        else {
            console.log('Not logged in - agent will handle login if needed');
        }
        let step = 0;
        let complete = false;
        try {
            while (!complete && step < maxSteps) {
                console.log(`\n--- Step ${step} ---`);
                if (this.isStuck(history)) {
                    const stuckAction = history[history.length - 1].action;
                    const lastProgress = history[history.length - 1]?.progressAssessment || 0;
                    console.error(`\nLoop detected - same action repeated 3+ times with no progress: ${stuckAction.type} -> "${stuckAction.target}"`);
                    console.error(`Last progress: ${lastProgress}%`);
                    const recoveryAttempts = (history.filter(h => h.description?.includes('recovery') || h.description?.includes('Loop detected')).length) || 0;
                    if (recoveryAttempts >= 3) {
                        console.error('Max recovery attempts reached. Breaking loop.');
                        console.error('Suggestion: The target element may not exist. Try opening the issue detail page first, or use a different approach.');
                        break;
                    }
                    await this.pw.captureStateWithMetadata(step, taskName);
                    console.log('Screenshot captured for debugging');
                    if (history.length >= 2) {
                        history.splice(-2);
                        console.log(`Removed last 2 failed attempts, attempting recovery (attempt ${recoveryAttempts + 1}/3)...`);
                        step = history.length;
                        continue;
                    }
                    console.error('Breaking loop. Check screenshot to see why element is not working.');
                    break;
                }
                const shouldCapture = step === 0 || (history.length > 0 && history[history.length - 1]?.isKeyState);
                if (shouldCapture) {
                    await this.pw.captureStateWithMetadata(step, taskName);
                }
                const screenshotPath = path_1.default.join(screenshotDir, `step_${String(step).padStart(3, '0')}.png`);
                let domContext = await this.pw.getSimplifiedDOM();
                if (domContext === '[]' || domContext.length < 10) {
                    console.warn('Empty or minimal DOM context - page may not be loaded');
                    await this.pw.waitForStable();
                    const retryDom = await this.pw.getSimplifiedDOM();
                    if (retryDom !== '[]' && retryDom.length > 10) {
                        console.log('DOM context retrieved on retry');
                        domContext = retryDom;
                    }
                }
                const compactHistory = this.compactHistory(history.slice(-3));
                const currentUrl = this.pw.getCurrentUrl();
                const recentFailures = history.slice(-3).filter(h => h.description?.toLowerCase().includes('not found') ||
                    h.description?.toLowerCase().includes('element not found')).length;
                let recoveryContext = '';
                if (recentFailures >= 2) {
                    recoveryContext = `

RECOVERY MODE: Previous actions failed multiple times.

IMPORTANT GUIDANCE:
- If trying to change status: Click the issue ID FIRST to open detail view, then click status dropdown
- If trying to assign: Click the issue to see assignee field on detail page
- NEVER try to click "Status badge of [ID]" - these don't exist as clickable elements
- Use simple element names: "DEE-9" to open issue, "Status" for status dropdown
- Consider alternative approaches if current one keeps failing

`;
                }
                const prompt = prompts_1.VISION_DECISION_PROMPT
                    .replace('{objective}', task)
                    .replace('{actionHistory}', JSON.stringify(compactHistory))
                    .replace('{domContext}', domContext.substring(0, 3000))
                    .replace('{currentUrl}', currentUrl)
                    .replace('{recoveryContext}', recoveryContext);
                const decision = await this.gpt.analyzeScreenshot(screenshotPath, prompt);
                console.log(`Decision: ${decision.nextAction.type} -> ${decision.nextAction.target}`);
                console.log(`Reasoning: ${decision.nextAction.reasoning}`);
                console.log(`Progress: ${decision.progressAssessment}% | Key State: ${decision.isKeyState}`);
                if (decision.nextAction.type === 'click' && decision.progressAssessment >= 80 && history.length >= 2) {
                    const isStatusChangeTask = task.toLowerCase().includes('status') || (task.toLowerCase().includes('change') && task.toLowerCase().includes('progress'));
                    const isAssignmentTask = task.toLowerCase().includes('assign');
                    const recentActions = history.slice(-2);
                    const lastTwoSame = recentActions.every(h => h.action.target === decision.nextAction.target && h.action.type === 'click');
                    if (lastTwoSame && (isStatusChangeTask || isAssignmentTask)) {
                        console.log('Detected repeated clicks on same target at high progress - likely already completed');
                        console.log('   Converting to completion based on status/assignment task pattern');
                        decision.nextAction.type = 'complete';
                        decision.nextAction.target = 'Task completed';
                        decision.nextAction.reasoning = 'Status/assignment already changed - repeated clicks indicate completion';
                        decision.progressAssessment = 100;
                        decision.isKeyState = true;
                    }
                }
                if (decision.nextAction.type === 'complete') {
                    complete = true;
                    console.log('Task marked complete');
                    await this.pw.captureStateWithMetadata(step, taskName);
                    await this.pw.saveSession();
                }
                else {
                    await this.pw.executeAction(decision.nextAction);
                    if (task.toLowerCase().includes('status') && decision.progressAssessment >= 80 && history.length >= 2) {
                        const lastThree = history.slice(-3);
                        const targetStatusMatch = task.match(/to\s+(.+?)(?:\s+in|\s*$)/i);
                        if (targetStatusMatch) {
                            const targetStatus = targetStatusMatch[1].trim();
                            const clickingTargetRepeatedly = lastThree.filter(h => h.action.target?.toLowerCase().includes(targetStatus.toLowerCase())).length >= 2;
                            if (clickingTargetRepeatedly) {
                                console.log(`Detected repeated clicks on target status "${targetStatus}" - status likely changed, marking complete`);
                                complete = true;
                                await this.pw.captureStateWithMetadata(step, taskName);
                                await this.pw.saveSession();
                                break;
                            }
                        }
                    }
                    if (step % 3 === 0) {
                        const loggedIn = await this.pw.isLoggedIn();
                        if (loggedIn) {
                            await this.pw.saveSession();
                        }
                    }
                }
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
            if (step >= maxSteps) {
                console.warn(`Reached max steps (${maxSteps})`);
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Execution failed: ${errorMessage}`);
        }
        finally {
            console.log(`Task complete. Steps: ${step}`);
            await this.saveDataset(taskName, history);
        }
        return history;
    }
    sanitizeTaskName(task) {
        return task.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 50);
    }
    ensureCleanDir(dir) {
        if (fs_1.default.existsSync(dir)) {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    detectApp(task) {
        const lower = task.toLowerCase();
        if (lower.includes('notion') || (lower.includes('page') && !lower.includes('issue'))) {
            return 'notion';
        }
        if (lower.includes('asana') || lower.includes('milestone')) {
            return 'asana';
        }
        if (lower.includes('linear') || lower.includes('issue') || lower.includes('project')) {
            return 'linear';
        }
        return 'linear';
    }
    isStuck(history) {
        if (history.length < 3)
            return false;
        const last3 = history.slice(-3);
        const first = last3[0];
        // Check for repeated actions on same target
        const sameAction = last3.every((h) => h.action.target === first.action.target && h.action.type === first.action.type);
        // Check for progress stagnation (no progress change in last 3 steps)
        const progressStagnant = last3.every((h) => Math.abs(h.progressAssessment - first.progressAssessment) < 5);
        // Additional check: repeated "Element not found" errors
        const allFailed = last3.every((h) => h.description?.toLowerCase().includes('not found') ||
            h.description?.toLowerCase().includes('element not found') ||
            h.action.reasoning?.toLowerCase().includes('not found'));
        return (sameAction && progressStagnant) || allFailed;
    }
    compactHistory(history) {
        return history.map((h) => ({
            step: h.step,
            type: h.action.type,
            target: h.action.target,
            progress: h.progressAssessment,
        }));
    }
    async saveDataset(taskName, history) {
        try {
            await (0, generate_dataset_1.generateDataset)(taskName, history);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Dataset generation failed: ${errorMessage}`);
        }
    }
}
exports.NavigationAgent = NavigationAgent;
