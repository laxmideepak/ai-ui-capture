import { Browser, Page, chromium, BrowserContext } from 'playwright';
import { config } from '../utils/config';
import fs from 'fs';
import path from 'path';
import { ElementFinder } from './element-finder';
import { ActionExecutor } from './action-executor';
import { SessionManager } from './session-manager';
import { DOMExtractor } from './dom-extractor';

interface ActionPayload {
  type: string;
  target: string;
  value?: string;
  reasoning?: string;
}

export class PlaywrightManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private lastIssueTitle: string | null = null;
  private isClosing = false;

  private elementFinder!: ElementFinder;
  private actionExecutor!: ActionExecutor;
  private sessionManager!: SessionManager;
  private domExtractor!: DOMExtractor;

  async initialize(): Promise<Page> {
    const authPath = path.resolve(process.cwd(), config.paths.auth);
    const hasAuth = fs.existsSync(authPath) && fs.readFileSync(authPath, 'utf-8').trim().length > 0;

    if (hasAuth) {
      console.log('Loading saved session...');
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

    this.setupEventHandlers();
    this.initializeHelpers();

    return this.page;
  }

  private setupEventHandlers(): void {
    if (!this.page) return;

    this.page.on('close', () => {
      if (!this.isClosing) {
        console.warn('Page closed unexpectedly');
      }
    });

    this.page.on('crash', () => console.error('Page crashed'));

    this.page.on('framenavigated', (frame) => {
      if (frame === this.page?.mainFrame()) {
        console.log(`Navigation: ${frame.url()}`);
      }
    });
  }

  private initializeHelpers(): void {
    this.elementFinder = new ElementFinder(this.page!, this);
    this.actionExecutor = new ActionExecutor(this.page!, this.elementFinder, this);
    this.sessionManager = new SessionManager();
    this.domExtractor = new DOMExtractor();
  }

  getCurrentUrl(): string {
    return this.page?.url() || '';
  }

  async navigate(url: string): Promise<void> {
    this.ensurePage();
    await this.page!.goto(url, { waitUntil: 'domcontentloaded' });
    await this.waitForStable();

    const hasAuthError = await this.page!
      .locator('text=/authentication error|don\'t have access|workspace admin/i')
      .isVisible()
      .catch(() => false);

    if (hasAuthError) {
      const errorText = await this.page!
        .locator('text=/authentication error|don\'t have access/i')
        .first()
        .textContent()
        .catch(() => '');
      console.error(`Authentication error: ${errorText}`);
      console.error('You don\'t have access to this workspace. Please use a workspace you have access to.');
      throw new Error(`Authentication error: ${errorText}`);
    }
  }

  async isLoggedIn(): Promise<boolean> {
    this.ensurePage();
    return this.sessionManager.isLoggedIn(this.page!);
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
      console.log('Browser closed');
    } catch {
      // Suppress errors during cleanup
    }
  }

  async screenshot(filepath: string): Promise<void> {
    this.ensurePage();
    try {
      await this.page!.waitForTimeout(400);
      await this.page!.screenshot({
        path: filepath,
        fullPage: false,
        animations: 'disabled',
      });
      console.log(`Screenshot: ${filepath}`);
    } catch {
      console.error('Screenshot failed');
    }
  }

  async getSimplifiedDOM(): Promise<string> {
    this.ensurePage();
    return this.domExtractor.extract(this.page!);
  }

  async captureStateWithMetadata(step: number, taskName: string): Promise<void> {
    this.ensurePage();
    const dir = `output/screenshots/${taskName}`;
    const screenshotPath = `${dir}/step_${String(step).padStart(3, '0')}.png`;
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
      // Metadata save is non-critical
    }
  }

  async executeAction(action: ActionPayload, retries = 2): Promise<void> {
    this.ensurePage();
    return this.actionExecutor.execute(action, retries);
  }

  async waitForStable(ms = 3000): Promise<void> {
    if (!this.page) return;
    try {
      await this.page.waitForLoadState('networkidle', { timeout: ms });
    } catch {
      // SPAs often don't reach networkidle - not an error
    }
    await this.page.waitForTimeout(600);
  }

  getLastIssueTitle(): string | null {
    return this.lastIssueTitle;
  }

  setLastIssueTitle(title: string | null): void {
    this.lastIssueTitle = title;
  }

  private ensurePage(): void {
    if (!this.page || this.page.isClosed()) {
      throw new Error('Page not initialized');
    }
  }
}
