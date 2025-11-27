import fs from 'fs';
import path from 'path';
import { BrowserContext, Page } from 'playwright';
import { config } from '../utils/config';

export class SessionManager {
  async saveSession(context: BrowserContext): Promise<void> {
    try {
      const authPath = path.resolve(process.cwd(), config.paths.auth);
      const authDir = path.dirname(authPath);

      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }

      await context.storageState({ path: authPath });
      console.log(`Session state saved to: ${authPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('Warning: Failed to save session state:', message);
    }
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    try {
      const url = page.url();

      if (this.isOnLoginPage(url)) {
        console.log('Auth Status: Login page detected');
        return false;
      }

      // Check for generic "Sign In" buttons
      const loginButtonCount = await page.locator('text=/continue with|sign in|log in/i').count();
      if (loginButtonCount > 0) {
        console.log('Auth Status: Login buttons detected');
        return false;
      }

      // Platform-specific checks
      if (url.includes('linear.app')) return await this.checkLinearAuth(page);
      if (url.includes('notion.so') || url.includes('notion.com')) return await this.checkNotionAuth(page);
      if (url.includes('asana.com')) return await this.checkAsanaAuth(page);

      // Default assumption: If not on login page, we are likely logged in
      console.log('Auth Status: Generic logged-in check passed');
      return true;

    } catch (error) {
      console.error('Auth Check Failed:', error);
      return false;
    }
  }

  private isOnLoginPage(url: string): boolean {
    return url.includes('/login') || url.includes('/signin') || url.includes('/auth');
  }

  private async checkLinearAuth(page: Page): Promise<boolean> {
    const selector = '[data-testid*="sidebar"], [aria-label*="Issues" i], a[href*="/issue/"]';
    const hasWorkspace = await page.locator(selector).count() > 0;
    
    console.log(hasWorkspace ? 'Auth: Linear workspace active' : 'Auth: No Linear workspace found');
    return hasWorkspace;
  }

  private async checkNotionAuth(page: Page): Promise<boolean> {
    const sidebarCount = await page.locator('[data-testid*="sidebar"], [data-testid*="workspace"], [class*="sidebar"]').count();
    if (sidebarCount > 0) {
      console.log('Auth: Notion workspace active');
      return true;
    }
    
    const contentCount = await page.locator('[contenteditable="true"], [class*="notion-page"]').count();
    return contentCount > 0;
  }

  private async checkAsanaAuth(page: Page): Promise<boolean> {
    const sidebarCount = await page.locator('[data-testid*="sidebar"], [aria-label*="workspace" i], [class*="Sidebar"]').count();
    if (sidebarCount > 0) {
      console.log('Auth: Asana workspace active');
      return true;
    }
    
    const taskListCount = await page.locator('[class*="Task"], [class*="Project"]').count();
    return taskListCount > 0;
  }
}
