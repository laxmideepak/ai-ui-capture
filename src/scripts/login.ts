import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const AUTH_FILE = path.join(process.cwd(), 'output/auth.json');

async function login() {
  console.log('Starting login...\n');

  if (!fs.existsSync('output')) {
    fs.mkdirSync('output');
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('Opening Linear login page...');
    await page.goto('https://linear.app/login');

    console.log('Please log in manually in the browser window.');
    console.log('Waiting for dashboard (URL containing /team/)...\n');

    await page.waitForURL(/.*\/team\/.*/, { timeout: 120000 });

    console.log('Dashboard detected!');

    await page.context().storageState({ path: AUTH_FILE });
    console.log(`Session saved: ${AUTH_FILE}\n`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Login failed or timed out:', errorMessage);
  } finally {
    await browser.close();
  }
}

login();
