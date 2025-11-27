"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const config_1 = require("../utils/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class SessionManager {
    async saveSession(context) {
        try {
            const authPath = path_1.default.resolve(process.cwd(), config_1.config.paths.auth);
            const authDir = path_1.default.dirname(authPath);
            if (!fs_1.default.existsSync(authDir)) {
                fs_1.default.mkdirSync(authDir, { recursive: true });
            }
            await context.storageState({ path: authPath });
            console.log(`Session saved: ${authPath}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('Failed to save session:', message);
        }
    }
    async isLoggedIn(page) {
        try {
            const url = page.url();
            if (this.isOnLoginPage(url)) {
                console.log('Login check: On login page');
                return false;
            }
            const loginButtons = await page.locator('text=/continue with|sign in|log in/i').count();
            if (loginButtons > 0) {
                console.log('Login check: Login buttons found');
                return false;
            }
            if (url.includes('linear.app')) {
                return this.checkLinearAuth(page);
            }
            if (url.includes('notion.so') || url.includes('notion.com')) {
                return this.checkNotionAuth(page);
            }
            if (url.includes('asana.com')) {
                return this.checkAsanaAuth(page);
            }
            const result = !this.isOnLoginPage(url);
            console.log(`Login check: Generic fallback = ${result}`);
            return result;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('Login check failed:', message);
            return false;
        }
    }
    isOnLoginPage(url) {
        return url.includes('/login') || url.includes('/signin') || url.includes('/auth');
    }
    async checkLinearAuth(page) {
        const indicators = await page
            .locator('[data-testid*="sidebar"], [aria-label*="Issues" i], a[href*="/issue/"]')
            .count();
        if (indicators > 0) {
            console.log('Login check: Linear workspace detected');
            return true;
        }
        console.log('Login check: No Linear workspace indicators found');
        return false;
    }
    async checkNotionAuth(page) {
        const indicators = await page
            .locator('[data-testid*="sidebar"], [data-testid*="workspace"], [aria-label*="workspace" i], [class*="sidebar"]')
            .count();
        if (indicators > 0) {
            console.log('Login check: Notion workspace detected');
            return true;
        }
        const contentArea = await page.locator('[contenteditable="true"], [class*="notion-page"]').count();
        if (contentArea > 0) {
            console.log('Login check: Notion content area detected');
            return true;
        }
        console.log('Login check: No Notion workspace indicators found');
        return false;
    }
    async checkAsanaAuth(page) {
        const indicators = await page
            .locator('[data-testid*="sidebar"], [aria-label*="workspace" i], [class*="Sidebar"], [class*="Workspace"]')
            .count();
        if (indicators > 0) {
            console.log('Login check: Asana workspace detected');
            return true;
        }
        const taskList = await page.locator('[class*="Task"], [class*="Project"]').count();
        if (taskList > 0) {
            console.log('Login check: Asana task/project list detected');
            return true;
        }
        console.log('Login check: No Asana workspace indicators found');
        return false;
    }
}
exports.SessionManager = SessionManager;
