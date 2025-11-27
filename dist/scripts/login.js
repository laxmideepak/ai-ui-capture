"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = require("playwright");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const AUTH_FILE = path_1.default.join(process.cwd(), 'output/auth.json');
async function login() {
    console.log('Starting login...\n');
    if (!fs_1.default.existsSync('output')) {
        fs_1.default.mkdirSync('output');
    }
    const browser = await playwright_1.chromium.launch({ headless: false });
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
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Login failed or timed out:', errorMessage);
    }
    finally {
        await browser.close();
    }
}
login();
