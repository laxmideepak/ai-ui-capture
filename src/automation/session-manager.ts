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

      // Generic workspace detection - look for common workspace indicators
      return await this.checkGenericAuth(page);

    } catch (error) {
      console.error('Auth Check Failed:', error);
      return false;
    }
  }

  private isOnLoginPage(url: string): boolean {
    return url.includes('/login') || url.includes('/signin') || url.includes('/auth');
  }

  private async checkGenericAuth(page: Page): Promise<boolean> {
    // Generic workspace indicators that work across apps
    const workspaceIndicators = [
      // Sidebars and navigation
      '[data-testid*="sidebar"]',
      '[aria-label*="sidebar" i]',
      '[class*="sidebar" i]',
      '[class*="Sidebar" i]',
      // Navigation menus
      'nav',
      '[role="navigation"]',
      // User avatars/menus
      '[aria-label*="user" i]',
      '[aria-label*="account" i]',
      '[class*="avatar" i]',
      '[class*="Avatar" i]',
      // Workspace indicators
      '[data-testid*="workspace"]',
      '[aria-label*="workspace" i]',
      // Content areas (not login forms)
      '[contenteditable="true"]',
      '[role="main"]',
      // Common app-specific content
      'a[href*="/issue/"]',
      'a[href*="/task/"]',
      'a[href*="/project/"]',
    ];

    let indicatorCount = 0;
    for (const selector of workspaceIndicators) {
      const count = await page.locator(selector).count();
      indicatorCount += count;
      if (count > 0) break; // Found at least one indicator
    }

    const isLoggedIn = indicatorCount > 0;
    console.log(isLoggedIn ? 'Auth: Workspace indicators detected' : 'Auth: No workspace indicators found');
    return isLoggedIn;
  }
}
