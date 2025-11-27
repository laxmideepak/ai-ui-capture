"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const playwright_manager_1 = require("./automation/playwright-manager");
const navigation_agent_1 = require("./agents/navigation-agent");
const config_1 = require("./utils/config");
dotenv_1.default.config();
async function main() {
    const task = process.argv[2] || 'Create a new issue in Linear';
    console.log(`Starting agent: "${task}"`);
    console.log('Using GPT-4 Vision + Playwright\n');
    const pw = new playwright_manager_1.PlaywrightManager();
    try {
        await pw.initialize();
        await pw.navigate(config_1.config.urls.linear);
        const agent = new navigation_agent_1.NavigationAgent(pw);
        const history = await agent.execute(task);
        console.log('\nExecution Summary:');
        history.forEach((entry, i) => {
            console.log(`  ${i + 1}. ${entry.action.type} -> ${entry.action.target}`);
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('\nFatal error:', errorMessage);
        process.exit(1);
    }
    finally {
        await pw.close();
    }
}
main().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Unhandled error:', errorMessage);
    process.exit(1);
});
