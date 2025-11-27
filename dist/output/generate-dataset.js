"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDataset = generateDataset;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../utils/config");
async function generateDataset(taskName, logs) {
    const sanitized = taskName.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 50);
    const taskDir = path_1.default.join(config_1.config.paths.dataset, sanitized);
    const sourceDir = path_1.default.join(config_1.config.paths.screenshots, sanitized);
    if (fs_1.default.existsSync(taskDir)) {
        fs_1.default.rmSync(taskDir, { recursive: true, force: true });
    }
    fs_1.default.mkdirSync(taskDir, { recursive: true });
    console.log(`\nGenerating dataset: "${taskName}"`);
    if (fs_1.default.existsSync(sourceDir)) {
        const files = fs_1.default.readdirSync(sourceDir);
        for (const file of files) {
            fs_1.default.copyFileSync(path_1.default.join(sourceDir, file), path_1.default.join(taskDir, file));
        }
        console.log(`   Copied ${files.length} files`);
    }
    const readme = buildReadme(taskName, logs, sanitized);
    fs_1.default.writeFileSync(path_1.default.join(taskDir, 'README.md'), readme);
    console.log('   Generated README.md');
    fs_1.default.writeFileSync(path_1.default.join(taskDir, 'metadata.json'), JSON.stringify(logs, null, 2));
    console.log('   Generated metadata.json');
    const runJson = buildRunJson(taskName, logs);
    fs_1.default.writeFileSync(path_1.default.join(taskDir, 'run.json'), JSON.stringify(runJson, null, 2));
    console.log('   Generated run.json');
    console.log(`\nDataset saved: ${taskDir}`);
}
function buildReadme(taskName, logs, sanitized) {
    const lastAction = logs[logs.length - 1]?.action.type;
    const status = lastAction === 'complete' ? 'Success' : 'Partial';
    let md = `# ${taskName}\n\n`;
    md += `**Date:** ${new Date().toISOString().split('T')[0]}\n`;
    md += `**Steps:** ${logs.length}\n`;
    md += `**Status:** ${status}\n\n`;
    md += `## Steps\n\n`;
    for (const log of logs) {
        const stepNum = String(log.step).padStart(3, '0');
        const screenshot = `step_${stepNum}.png`;
        md += `### Step ${log.step}\n\n`;
        if (log.description) {
            md += `**State:** ${log.description}\n\n`;
        }
        if (typeof log.progressAssessment === 'number') {
            md += `**Progress:** ${log.progressAssessment}%\n\n`;
        }
        if (log.isKeyState) {
            md += `**Key State:** ✓ (Screenshot captured)\n\n`;
        }
        md += `**Action:** \`${log.action.type}\`\n`;
        md += `**Target:** \`${log.action.target}\`\n`;
        if (log.action.value) {
            md += `**Value:** "${log.action.value}"\n`;
        }
        md += `\n> ${log.action.reasoning}\n\n`;
        if (fs_1.default.existsSync(path_1.default.join(config_1.config.paths.dataset, sanitized, screenshot))) {
            md += `![Step ${log.step}](${screenshot})\n\n`;
        }
        md += `---\n\n`;
    }
    return md;
}
function buildRunJson(taskName, logs) {
    return {
        task: taskName,
        timestamp: new Date().toISOString(),
        totalSteps: logs.length,
        status: logs[logs.length - 1]?.action.type === 'complete' ? 'completed' : 'partial',
        steps: logs.map((log) => ({
            step: log.step,
            timestamp: log.timestamp || new Date().toISOString(),
            state: {
                description: log.description || '',
                progress: log.progressAssessment || 0,
                isKeyState: log.isKeyState || false,
            },
            action: {
                type: log.action.type,
                target: log.action.target,
                value: log.action.value,
                reasoning: log.action.reasoning,
            },
            screenshot: `step_${String(log.step).padStart(3, '0')}.png`,
        })),
        summary: {
            firstAction: logs[0]?.action.type || 'unknown',
            lastAction: logs[logs.length - 1]?.action.type || 'unknown',
            finalProgress: logs[logs.length - 1]?.progressAssessment || 0,
            keyStates: logs.filter((l) => l.isKeyState).length,
        },
    };
}
