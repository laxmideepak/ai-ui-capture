import fs from 'fs';
import path from 'path';
import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { config } from '../utils/config';
import { SessionManager } from './session-manager';

export interface ActionPayload {
  type: string;
  target: string;
  value?: string;
  reasoning?: string;
}

export class PlaywrightManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  
  // Helpers
  private sessionManager!: SessionManager;

  // State
  private lastIssueTitle: string | null = null;
  private isClosing = false;

  async initialize(): Promise<Page> {
    const authPath = path.resolve(process.cwd(), config.paths.auth);
    const hasAuth = fs.existsSync(authPath) && fs.readFileSync(authPath, 'utf-8').trim().length > 0;

    if (hasAuth) {
      console.log('Session: Loading saved state...');
    }

    this.browser = await chromium.launch({
      headless: config.browser.headless,
      slowMo: config.browser.slowMo,
    });

    this.context = await this.browser.newContext({
      viewport: config.browser.viewport,
      storageState: hasAuth ? authPath : undefined,
    });

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(config.browser.timeout);

    this.setupEventHandlers(this.page);
    this.initializeHelpers(this.page);

    return this.page;
  }

  getCurrentUrl(): string {
    return this.page?.url() || '';
  }

  getPage(): Page {
    this.ensurePage();
    return this.page!;
  }

  async navigate(url: string): Promise<void> {
    this.ensurePage();
    
    await this.page!.goto(url, { waitUntil: 'domcontentloaded' });
    await this.waitForStable();

    // Check for common SaaS permission blocks immediately after navigation
    const authErrorLocator = this.page!.locator('text=/authentication error|don\'t have access|workspace admin/i');
    const isBlocked = await authErrorLocator.isVisible().catch(() => false);

    if (isBlocked) {
      const errorText = await authErrorLocator.first().textContent().catch(() => 'Unknown access error');
      const msg = `Authentication Error: ${errorText}`;
      console.error(msg);
      throw new Error(msg);
    }
  }

  async isLoggedIn(): Promise<boolean> {
    this.ensurePage();
    return this.sessionManager.isLoggedIn(this.page!);
  }



  async screenshot(filepath: string): Promise<void> {
    this.ensurePage();
    try {
      await this.page!.waitForTimeout(400); // Allow animations to settle
      await this.page!.screenshot({
        path: filepath,
        fullPage: false,
        animations: 'disabled',
      });
      console.log(`Screenshot saved: ${filepath}`);
    } catch (err) {
      console.error('Screenshot failed:', err);
    }
  }

  async captureStateWithMetadata(step: number, taskName: string): Promise<void> {
    this.ensurePage();
    const dir = `output/screenshots/${taskName}`;
    const screenshotPath = path.join(dir, `step_${String(step).padStart(3, '0')}.png`);
    const metadataPath = screenshotPath.replace('.png', '_meta.json');

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await this.screenshot(screenshotPath);

    try {
      const metadata = {
        step,
        url: this.page!.url(),
        timestamp: new Date().toISOString(),
        title: await this.page!.title(),
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    } catch {
      // Metadata is non-critical, ignore write errors
    }
  }

  async saveSession(): Promise<void> {
    if (!this.context) return;
    await this.sessionManager.saveSession(this.context);
  }

  async close(): Promise<void> {
    this.isClosing = true;
    try {
      await this.saveSession();
      await this.page?.close();
      await this.context?.close();
      await this.browser?.close();
      console.log('Browser shutdown complete');
    } catch (err) {
      console.warn('Error during browser shutdown (ignored):', err);
    }
  }

  async waitForStable(ms = 3000): Promise<void> {
    if (!this.page) return;
    try {
      await this.page.waitForLoadState('networkidle', { timeout: ms });
    } catch {
      // SPAs often never reach true networkidle; proceed anyway
    }
    await this.page.waitForTimeout(600);
  }

  // --- State Accessors ---

  getLastIssueTitle(): string | null {
    return this.lastIssueTitle;
  }

  setLastIssueTitle(title: string | null): void {
    this.lastIssueTitle = title;
  }

  // --- Internals ---

  private ensurePage(): void {
    if (!this.page || this.page.isClosed()) {
      throw new Error('PlaywrightManager: Page not initialized or closed');
    }
  }

  private setupEventHandlers(page: Page): void {
    page.on('close', () => {
      if (!this.isClosing) console.warn('Warning: Page closed unexpectedly');
    });
    page.on('crash', () => console.error('Critical: Page crashed'));
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        console.log(`Navigated to: ${frame.url()}`);
      }
    });
  }

  private initializeHelpers(page: Page): void {
    this.sessionManager = new SessionManager();
  }
}

