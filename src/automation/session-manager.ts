import { BrowserContext, Page } from 'playwright';
import { config } from '../utils/config';
import fs from 'fs';
import path from 'path';

export class SessionManager {
  async saveSession(context: BrowserContext): Promise<void> {
    try {
      const authPath = path.resolve(process.cwd(), config.paths.auth);
      const authDir = path.dirname(authPath);

      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }

      await context.storageState({ path: authPath });
      console.log(`Session saved: ${authPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('Failed to save session:', message);
    }
  }

  async isLoggedIn(page: Page): Promise<boolean> {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Login check failed:', message);
      return false;
    }
  }

  private isOnLoginPage(url: string): boolean {
    return url.includes('/login') || url.includes('/signin') || url.includes('/auth');
  }

  private async checkLinearAuth(page: Page): Promise<boolean> {
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

  private async checkNotionAuth(page: Page): Promise<boolean> {
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

  private async checkAsanaAuth(page: Page): Promise<boolean> {
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

