import dotenv from 'dotenv';
import { PlaywrightManager } from './automation/playwright-manager';
import { NavigationAgent } from './agents/navigation-agent';
import { config } from './utils/config';

dotenv.config();

async function main() {
  const task = process.argv[2] || 'Create a new issue in Linear';

  console.log(`Starting agent: "${task}"`);
  console.log('Using GPT-4 Vision + Playwright\n');

  const pw = new PlaywrightManager();

  try {
    await pw.initialize();
    await pw.navigate(config.urls.linear);

    const agent = new NavigationAgent(pw);
    const history = await agent.execute(task);

    console.log('\nExecution Summary:');
    history.forEach((entry, i) => {
      console.log(`  ${i + 1}. ${entry.action.type} -> ${entry.action.target}`);
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('\nFatal error:', errorMessage);
    process.exit(1);
  } finally {
    await pw.close();
  }
}

main().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  console.error('Unhandled error:', errorMessage);
  process.exit(1);
});
