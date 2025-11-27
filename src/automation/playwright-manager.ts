import { Browser, Page, chromium, BrowserContext, Locator } from 'playwright';
import { config } from '../utils/config';
import fs from 'fs';
import path from 'path';

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
  private isClosing: boolean = false;

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

    return this.page;
  }

  getCurrentUrl(): string {
    return this.page?.url() || '';
  }

  async navigate(url: string): Promise<void> {
    this.ensurePage();
    await this.page!.goto(url, { waitUntil: 'domcontentloaded' });
    await this.waitForStable();
    
    const hasAuthError = await this.page!.locator('text=/authentication error|don\'t have access|workspace admin/i').isVisible().catch(() => false);
    if (hasAuthError) {
      const errorText = await this.page!.locator('text=/authentication error|don\'t have access/i').first().textContent().catch(() => '');
      console.error(`Authentication error: ${errorText}`);
      console.error('You don\'t have access to this workspace. Please use a workspace you have access to.');
      throw new Error(`Authentication error: ${errorText}`);
    }
  }

  async isLoggedIn(): Promise<boolean> {
    this.ensurePage();
    try {
      const url = this.page!.url();
      
      if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) {
        console.log('Login check: On login page');
        return false;
      }

      const loginButtons = await this.page!.locator('text=/continue with|sign in|log in/i').count();
      if (loginButtons > 0) {
        console.log('Login check: Login buttons found');
        return false;
      }

      const isNotion = url.includes('notion.so') || url.includes('notion.com');
      const isLinear = url.includes('linear.app');
      const isAsana = url.includes('asana.com');

      if (isLinear) {
        const indicators = await this.page!.locator(
          '[data-testid*="sidebar"], [aria-label*="Issues" i], a[href*="/issue/"]'
        ).count();
        if (indicators > 0) {
          console.log('Login check: Linear workspace detected');
          return true;
        }
        console.log('Login check: No Linear workspace indicators found');
      }

      if (isNotion) {
        const indicators = await this.page!.locator(
          '[data-testid*="sidebar"], [data-testid*="workspace"], [aria-label*="workspace" i], [class*="sidebar"]'
        ).count();
        if (indicators > 0) {
          console.log('Login check: Notion workspace detected');
          return true;
        }
        const contentArea = await this.page!.locator('[contenteditable="true"], [class*="notion-page"]').count();
        if (contentArea > 0) {
          console.log('Login check: Notion content area detected');
          return true;
        }
        console.log('Login check: No Notion workspace indicators found');
      }

      if (isAsana) {
        const indicators = await this.page!.locator(
          '[data-testid*="sidebar"], [aria-label*="workspace" i], [class*="Sidebar"], [class*="Workspace"]'
        ).count();
        if (indicators > 0) {
          console.log('Login check: Asana workspace detected');
          return true;
        }
        const taskList = await this.page!.locator('[class*="Task"], [class*="Project"]').count();
        if (taskList > 0) {
          console.log('Login check: Asana task/project list detected');
          return true;
        }
        console.log('Login check: No Asana workspace indicators found');
      }

      const result = !url.includes('/login') && !url.includes('/signin');
      console.log(`Login check: Generic fallback = ${result}`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Login check failed:', errorMessage);
      return false;
    }
  }

  async saveSession(): Promise<void> {
    if (!this.context) return;
    
    try {
      const authPath = path.resolve(process.cwd(), config.paths.auth);
      const authDir = path.dirname(authPath);
      
      // Ensure directory exists
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }
      
      await this.context.storageState({ path: authPath });
      console.log(`Session saved: ${authPath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Failed to save session:', errorMessage);
    }
  }

  async close(): Promise<void> {
    this.isClosing = true;
    try {
      // Save session before closing
      await this.saveSession();
      
      await this.page?.close();
      await this.context?.close();
      await this.browser?.close();
      console.log('Browser closed');
    } catch (e) {
      // Silent close
    }
  }

  async screenshot(filepath: string): Promise<void> {
    this.ensurePage();
    try {
      await this.page!.waitForTimeout(400);
      await this.page!.screenshot({ path: filepath, fullPage: false, animations: 'disabled' });
      console.log(`Screenshot: ${filepath}`);
    } catch (e) {
      console.error('Screenshot failed');
    }
  }

  async getSimplifiedDOM(): Promise<string> {
    this.ensurePage();
    const page = this.page!;

    try {
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);

      const selector = 'button, input, textarea, a, [role="button"], [role="link"], [role="listitem"], [role="menuitem"], [role="textbox"], [contenteditable="true"], [contenteditable], [placeholder], [data-testid], [aria-label]';

      const domJson = await page.evaluate((sel: string) => {
        // This code runs in the browser context where DOM types are available
        // @ts-expect-error - document is available in browser context
        const doc = document;
        // @ts-expect-error - window is available in browser context
        const win = window;
        try {
          const elements = Array.from(doc.querySelectorAll(sel))
            .slice(0, 80)
            .map((el: any) => {
              try {
                const rect = el.getBoundingClientRect();
                
                let inDialog = false;
                let current: any = el;
                while (current) {
                  const role = current.getAttribute('role');
                  const tag = current.tagName.toLowerCase();
                  if (role === 'dialog' || role === 'alertdialog' || tag === 'dialog' || 
                      current.getAttribute('aria-modal') === 'true' ||
                      current.classList.contains('modal')) {
                    inDialog = true;
                    break;
                  }
                  current = current.parentElement;
                }

                const style = win.getComputedStyle(el);
                const visible = rect.width > 0 && rect.height > 0 && 
                               style.display !== 'none' && 
                               style.visibility !== 'hidden' && 
                               style.opacity !== '0';

                if (!visible) return null;

                return {
                  tag: el.tagName.toLowerCase(),
                  text: (el.textContent || '').trim().substring(0, 60),
                  role: el.getAttribute('role'),
                  ariaLabel: el.getAttribute('aria-label') || '',
                  placeholder: el.getAttribute('placeholder') || '',
                  href: el.getAttribute('href') || '',
                  type: el.getAttribute('type') || '',
                  dataTestId: el.getAttribute('data-testid') || '',
                  x: Math.round(rect.left),
                  y: Math.round(rect.top),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                  inDialog,
                  visible: true,
                };
              } catch {
                return null;
              }
            })
            .filter((el): el is NonNullable<typeof el> => el !== null)
            .filter(el => el.text || el.ariaLabel || el.dataTestId || el.tag === 'input' || el.tag === 'textarea' || el.tag === 'button');

          return JSON.stringify(elements);
        } catch (err) {
          console.error('DOM eval error:', err);
          return JSON.stringify([]);
        }
      }, selector);

      if (!domJson || domJson === '[]' || domJson.length < 10) {
        console.warn('Empty DOM context returned');
        const title = await page.title().catch(() => 'Unknown');
        const url = page.url();
        return JSON.stringify([{ tag: 'page', text: title, href: url }]);
      }

      return domJson;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('DOM extraction failed:', errorMessage);
      try {
        const title = await page.title().catch(() => 'Unknown');
        const url = page.url();
        return JSON.stringify([{ tag: 'page', text: title, href: url }]);
      } catch {
        return '[]';
      }
    }
  }

  async captureStateWithMetadata(step: number, taskName: string): Promise<void> {
    this.ensurePage();
    const dir = `output/screenshots/${taskName}`;
    const screenshotPath = `${dir}/step_${String(step).padStart(3, '0')}.png`;
    const metadataPath = screenshotPath.replace('.png', '_meta.json');

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

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
      // Silent fail
    }
  }

  async executeAction(action: ActionPayload, retries = 2): Promise<void> {
    this.ensurePage();

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`Retry ${attempt}/${retries}`);
          await this.page!.waitForTimeout(1000);
        }

        console.log(`Action: ${action.type} -> "${action.target}"`);

        if (action.type === 'wait') {
          await this.page!.waitForTimeout(2000);
          return;
        }
        if (action.type === 'complete') {
          console.log('Task complete');
          return;
        }
        if (action.type === 'navigate') {
          await this.navigate(action.value || action.target);
          return;
        }
        if (action.type === 'scroll') {
          await this.scroll(action.target);
          return;
        }

        let element = await this.findElement(action.target);
        if (!element) {
          element = await this.fallbackFind(action.target);
        }
        if (!element) {
          if (await this.tryShortcut(action)) return;
          console.warn(`Element not found: "${action.target}"`);
          if (attempt === retries) return;
          continue;
        }

        if (action.type === 'click') {
          await this.click(element, action.target);
        } else if (action.type === 'type') {
          await this.type(element, action);
        }

        await this.waitForStable();
        return;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown';
        console.error(`Attempt ${attempt + 1} failed: ${errorMessage}`);
        if (attempt === retries) return;
      }
    }
  }

  private async findElement(target: string): Promise<Locator | null> {
    if (!this.page) return null;
    console.log(`Finding: "${target}"`);

    if (/issue title|^title$/i.test(target)) {
      return this.findTitleField();
    }

    if (/description/i.test(target)) {
      return this.findDescriptionField();
    }

    if (/comment/i.test(target)) {
      return this.findCommentField();
    }

    if (/status badge|status of|change status/i.test(target)) {
      console.log('Status operation detected - trying issue detail approach');
      
      const issueMatch = target.match(/([A-Z]{2,10}-\d+)/i);
      if (issueMatch) {
        const issueId = issueMatch[1];
        console.log(`Looking for issue ${issueId} to open detail view`);
        
        const issueLink = await this.findIssue(issueId);
        if (issueLink) {
          console.log(`Found issue ${issueId}, clicking to open detail`);
          await issueLink.click();
          await this.waitForStable(1000);
          
          const statusButton = this.page!.getByRole('button', { name: /status|todo|in progress|done|backlog/i }).first();
          if (await statusButton.count() > 0 && await this.isVisible(statusButton)) {
            console.log('Found status dropdown in detail view');
            return statusButton;
          }
          
          const statusField = await this.findStatusField();
          if (statusField) return statusField;
        }
      }
      
      const statusBtn = this.page!.getByRole('button', { name: /status/i }).first();
      if (await statusBtn.count() > 0 && await this.isVisible(statusBtn)) {
        return statusBtn;
      }
      
      const status = await this.findStatusField();
      if (status) return status;
    }

    if (/assignee|assign|unassigned|to yourself/i.test(target)) {
      const assignee = await this.findAssigneeField();
      if (assignee) return assignee;
    }

    if (/status|in progress|todo|done|backlog/i.test(target) && !/status badge|status of/i.test(target)) {
      const status = await this.findStatusField();
      if (status) return status;
    }

    const issueMatch = target.match(/^([A-Z]{2,10}-\d+)/i);
    if (issueMatch) {
      return this.findIssue(issueMatch[1]);
    }

    if (/notification/i.test(target)) {
      const notificationResult = await this.findNotificationElement();
      if (notificationResult) {
        console.log('Found notification element');
        return notificationResult;
      }
    }

    const dialogResult = await this.findInDialog(target);
    if (dialogResult) {
      console.log(`Found in dialog: "${target}"`);
      const resolved = await this.resolveLabelToInput(dialogResult);
      if (resolved) return resolved;
      return dialogResult;
    }

    const strategies: (() => Promise<Locator | null>)[] = [
      () => this.tryLocator(this.page!.getByRole('button', { name: target, exact: true })),
      () => this.tryLocator(this.page!.getByRole('button', { name: new RegExp(target, 'i') })),
      () => this.tryLocator(this.page!.getByRole('link', { name: target, exact: true })),
      () => this.tryLocator(this.page!.getByRole('link', { name: new RegExp(target, 'i') })),
      () => this.tryLocator(this.page!.getByText(target, { exact: true })),
      () => this.tryLocator(this.page!.getByPlaceholder(target)),
      () => this.tryLocator(this.page!.getByLabel(target)),
      () => this.tryLocator(this.page!.getByRole('textbox', { name: new RegExp(target, 'i') })),
      () => this.tryLocator(this.page!.getByText(new RegExp(target, 'i'))),
      () => this.tryLocator(this.page!.locator(`[aria-label*="${target}" i]`)),
    ];

    for (const strategy of strategies) {
      const result = await strategy();
      if (result) {
        const resolved = await this.resolveLabelToInput(result);
        if (resolved) return resolved;
        return result;
      }
    }

    return null;
  }

  private async findInDialog(target: string): Promise<Locator | null> {
    if (!this.page) return null;

    const dialogSelectors = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      'dialog',
      '[data-testid*="modal"]',
      '[data-testid*="dialog"]',
    ];

    for (const dialogSel of dialogSelectors) {
      const dialog = this.page.locator(dialogSel).first();
      if (await this.isVisible(dialog)) {
        const dialogStrategies: (() => Promise<Locator | null>)[] = [
          () => this.tryLocator(dialog.getByRole('button', { name: target, exact: true })),
          () => this.tryLocator(dialog.getByRole('button', { name: new RegExp(target, 'i') })),
          () => this.tryLocator(dialog.getByRole('link', { name: target, exact: true })),
          () => this.tryLocator(dialog.getByText(target, { exact: true })),
          () => this.tryLocator(dialog.getByPlaceholder(target)),
          () => this.tryLocator(dialog.getByLabel(target)),
          () => this.tryLocator(dialog.getByRole('textbox', { name: new RegExp(target, 'i') })),
          () => this.tryLocator(dialog.locator(`[aria-label*="${target}" i]`)),
        ];

        for (const strategy of dialogStrategies) {
          const result = await strategy();
          if (result) return result;
        }
      }
    }

    return null;
  }

  private async findTitleField(): Promise<Locator | null> {
    const selectors = [
      'input[placeholder*="Issue title" i]',
      'input[placeholder*="title" i]:not([type="search"])',
      'div[contenteditable="true"][placeholder*="title" i]',
      '[role="dialog"] input[type="text"]',
    ];

    for (const sel of selectors) {
      const loc = this.page!.locator(sel).first();
      if (await this.isVisible(loc)) {
        const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
        if (tag === 'input' || tag === 'div') {
          console.log(`Found title: ${sel}`);
          return loc;
        }
      }
    }

    const textboxes = await this.page!.getByRole('textbox').all();
    for (const textbox of textboxes) {
      const placeholder = (await textbox.getAttribute('placeholder')) || '';
      if (placeholder.toLowerCase().includes('title') || placeholder === '') {
        console.log('Found title via textbox role');
        return textbox;
      }
    }

    return null;
  }

  private async findDescriptionField(): Promise<Locator | null> {
    const selectors = [
      'div[contenteditable="true"][placeholder*="description" i]',
      'div[contenteditable="true"][data-placeholder*="Add a description" i]',
      'textarea[placeholder*="description" i]',
    ];

    for (const sel of selectors) {
      const loc = this.page!.locator(sel).first();
      if (await this.isVisible(loc)) {
        console.log(`Found description: ${sel}`);
        return loc;
      }
    }

    const addBtn = this.page!.getByText('Add description', { exact: false }).first();
    if (await this.isVisible(addBtn)) {
      console.log('Clicking "Add description" button');
      await addBtn.click();
      await this.waitForStable(800);

      for (const sel of selectors) {
        const loc = this.page!.locator(sel).first();
        if (await this.isVisible(loc)) return loc;
      }
    }

    if (this.lastIssueTitle) {
      console.log(`Opening issue "${this.lastIssueTitle}" for description`);
      if (await this.openIssueViaSearch(this.lastIssueTitle)) {
        this.lastIssueTitle = null;
        await this.waitForStable(1000);

        const btn = this.page!.getByText('Add description', { exact: false }).first();
        if (await this.isVisible(btn)) {
          await btn.click();
          await this.waitForStable(800);
        }

        for (const sel of selectors) {
          const loc = this.page!.locator(sel).first();
          if (await this.isVisible(loc)) return loc;
        }
      }
    }

    return null;
  }

  private async findAssigneeField(): Promise<Locator | null> {
    if (!this.page) return null;

    const patterns = [
      () => this.page!.getByRole('button', { name: /assign/i }),
      () => this.page!.getByRole('button', { name: /assignee/i }),
      () => this.page!.getByText(/No assignee/i),
      () => this.page!.getByText(/Unassigned/i),
      () => this.page!.locator('[aria-label*="Assignee" i]'),
      () => this.page!.locator('[aria-label*="assign" i]'),
      () => this.page!.locator('[data-testid*="assignee" i]'),
      () => this.page!.locator('button:has-text("Assign")'),
      () => this.page!.locator('button:has-text("Unassigned")'),
    ];

    for (const pattern of patterns) {
      try {
        const locator = pattern();
        const count = await locator.count();
        if (count > 0) {
          const first = locator.first();
          if (await this.isVisible(first)) {
            console.log('Found assignee field');
            return first;
          }
        }
      } catch {
        // Continue to next pattern
      }
    }

    return null;
  }

  private async findStatusField(): Promise<Locator | null> {
    if (!this.page) return null;

    const patterns = [
      () => this.page!.getByRole('button', { name: /status/i }),
      () => this.page!.locator('[aria-label*="Status" i]'),
      () => this.page!.locator('[data-testid*="status" i]'),
      () => this.page!.locator('button[class*="status"], button[class*="badge"]'),
      () => this.page!.locator('[role="button"]:has-text("Todo")'),
      () => this.page!.locator('[role="button"]:has-text("In Progress")'),
      () => this.page!.locator('[role="button"]:has-text("Done")'),
      () => this.page!.locator('[role="button"]:has-text("Backlog")'),
      () => this.page!.locator('button:has-text("Status")'),
    ];

    for (const pattern of patterns) {
      try {
        const locator = pattern();
        const count = await locator.count();
        if (count > 0) {
          for (let i = 0; i < Math.min(count, 5); i++) {
            const item = locator.nth(i);
            if (await this.isVisible(item)) {
              console.log('Found status field');
              return item;
            }
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async findNotificationElement(): Promise<Locator | null> {
    if (!this.page) return null;

    const patterns = [
      () => this.page!.getByRole('button', { name: /notification/i }),
      () => this.page!.locator('[aria-label*="notification" i]'),
      () => this.page!.locator('[data-testid*="notification" i]'),
      () => this.page!.locator('button[class*="notification"], button[class*="bell"]'),
      () => this.page!.locator('svg[class*="bell"], svg[class*="notification"]').locator('xpath=ancestor::button[1]'),
      () => this.page!.locator('button:has(svg[class*="bell"])'),
      () => this.page!.locator('button:has(svg[class*="notification"])'),
      () => this.page!.locator('[role="button"]:has-text("notification")'),
    ];

    for (const pattern of patterns) {
      try {
        const locator = pattern();
        const count = await locator.count();
        if (count > 0) {
          const first = locator.first();
          if (await this.isVisible(first)) {
            console.log('Found notification element');
            return first;
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async findCommentField(): Promise<Locator | null> {
    const selectors = [
      '[contenteditable="true"][placeholder*="comment" i]',
      'textarea[placeholder*="comment" i]',
      'div[contenteditable="true"][role="textbox"]',
    ];

    for (const sel of selectors) {
      const loc = this.page!.locator(sel).first();
      if (await this.isVisible(loc)) {
        const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
        if (tag !== 'button') {
          console.log(`Found comment: ${sel}`);
          return loc;
        }
      }
    }

    return null;
  }

  private async findIssue(issueId: string): Promise<Locator | null> {
    console.log(`Finding issue: ${issueId}`);
    const id = issueId.toUpperCase();
    const idLower = id.toLowerCase();

    const byText = this.page!.getByText(id, { exact: true });
    if (await this.isVisible(byText)) {
      const parent = byText.locator('xpath=ancestor::a').first();
      if (await this.isVisible(parent)) {
        const href = await parent.getAttribute('href');
        if (href && (href.includes(`/${idLower}/`) || href.includes(`/${id}/`))) {
          console.log(`Found issue via text->ancestor: ${id}`);
          return parent;
        }
      }
      const textHref = await byText.getAttribute('href').catch(() => null);
      if (textHref && (textHref.includes(`/${idLower}/`) || textHref.includes(`/${id}/`))) {
        console.log(`Found issue via text: ${id}`);
        return byText.first();
      }
    }

    const byData = this.page!.locator(`[data-issue-id="${id}"], [data-issue-id="${idLower}"]`);
    if (await this.isVisible(byData)) {
      console.log(`Found issue via data-issue-id: ${id}`);
      return byData.first();
    }

    const allLinks = this.page!.locator('a[href*="/issue/"]');
    const linkCount = await allLinks.count();
    
    for (let i = 0; i < linkCount; i++) {
      const link = allLinks.nth(i);
      const href = await link.getAttribute('href');
      if (href) {
        const exactMatch = new RegExp(`/issue/${idLower}(?:/|\\?|$)`).test(href) || 
                          new RegExp(`/issue/${id}(?:/|\\?|$)`).test(href);
        if (exactMatch && await this.isVisible(link)) {
          console.log(`Found issue via exact href: ${id} (${href})`);
          return link;
        }
      }
    }

    const byTextCI = this.page!.getByText(new RegExp(`^${id}$`, 'i'));
    if (await this.isVisible(byTextCI)) {
      const parent = byTextCI.locator('xpath=ancestor::a').first();
      if (await this.isVisible(parent)) {
        const href = await parent.getAttribute('href');
        if (href && (href.includes(`/${idLower}/`) || href.includes(`/${id}/`))) {
          console.log(`Found issue via case-insensitive text: ${id}`);
          return parent;
        }
      }
    }

    console.log(`Trying search for: ${id}`);
    if (await this.openIssueViaSearch(id)) {
      return this.page!.locator('body');
    }

    return null;
  }

  private async fallbackFind(target: string): Promise<Locator | null> {
    const lower = target.toLowerCase();

    if (/\.{3}|more|menu|options/.test(lower)) {
      for (const selector of ['[aria-label*="more" i]', '[aria-label*="options" i]', 'button[aria-haspopup="true"]']) {
        const loc = this.page!.locator(selector).first();
        if (await this.isVisible(loc)) return loc;
      }
    }

    if (/create|new|add/.test(lower)) {
      for (const selector of ['button:has-text("Create")', 'button:has-text("New")', '[aria-label*="create" i]']) {
        const loc = this.page!.locator(selector).first();
        if (await this.isVisible(loc)) return loc;
      }
    }

    if (/submit|post|send|save/.test(lower)) {
      for (const selector of ['button[type="submit"]', 'button:has-text("Post")', 'button:has-text("Send")']) {
        const loc = this.page!.locator(selector).first();
        if (await this.isVisible(loc)) return loc;
      }
    }

    const modal = this.page!.locator('[role="dialog"]').first();
    if (await this.isVisible(modal)) {
      const inModal = modal.getByText(target, { exact: false });
      if (await this.isVisible(inModal)) return inModal.first();
    }

    return null;
  }

  private async tryShortcut(action: ActionPayload): Promise<boolean> {
    const target = action.target.toLowerCase();

    if (/create|new|plus|\+/.test(target)) {
      console.log('Trying "C" key (create)');
      await this.page!.keyboard.press('KeyC');
      await this.page!.waitForTimeout(1500);

      const modal = this.page!.locator('[role="dialog"], [placeholder*="Title" i]');
      if (await this.isVisible(modal)) {
        console.log('Create modal opened');
        return true;
      }
    }

    if (/submit|send|post|save/.test(target)) {
      console.log('Trying Cmd+Enter (submit)');
      await this.page!.keyboard.press('Meta+Enter');
      await this.page!.waitForTimeout(1500);
      return true;
    }

    if (/delete|remove/.test(target)) {
      console.log('Trying Cmd+Backspace (delete)');
      await this.page!.keyboard.press('Meta+Backspace');
      await this.page!.waitForTimeout(1000);
      await this.page!.keyboard.press('Enter');
      return true;
    }

    if (/close|cancel/.test(target)) {
      await this.page!.keyboard.press('Escape');
      return true;
    }

    return false;
  }

  private async click(element: Locator, target: string): Promise<void> {
    await element.scrollIntoViewIfNeeded();
    await this.page!.waitForTimeout(300);

    try {
      await element.click({ timeout: 5000 });
    } catch {
      await element.click({ force: true });
    }

    console.log(`Clicked: "${target}"`);

    await this.page!.waitForTimeout(500);
    const menuOpen = await this.page!.locator('[role="menu"], [role="listbox"]').isVisible().catch(() => false);
    if (menuOpen) {
      await this.autoSelectMenuOption(target);
    }
  }

  private async type(element: Locator, action: ActionPayload): Promise<void> {
    await element.scrollIntoViewIfNeeded();
    await this.page!.waitForTimeout(300);

    let [tag, contentEditable, role, isNotion] = await element.evaluate((el) => [
      el.tagName.toLowerCase(),
      el.getAttribute('contenteditable'),
      el.getAttribute('role'),
      el.closest('[class*="notion"]') !== null || el.getAttribute('data-content-root') !== null,
    ]);

    if (tag === 'label') {
      console.log('Found label element, resolving to associated input');
      const resolved = await this.resolveLabelToInput(element);
      if (resolved) {
        element = resolved;
        [tag, contentEditable, role, isNotion] = await element.evaluate((el) => [
          el.tagName.toLowerCase(),
          el.getAttribute('contenteditable'),
          el.getAttribute('role'),
          el.closest('[class*="notion"]') !== null || el.getAttribute('data-content-root') !== null,
        ]);
      } else {
        throw new Error(`Found label but could not resolve to input field`);
      }
    }

    const editable = tag === 'input' || tag === 'textarea' || contentEditable === 'true' || contentEditable === '' || role === 'textbox';
    if (!editable) {
      throw new Error(`Not editable: ${tag}, role=${role}, contenteditable=${contentEditable}`);
    }

    console.log(`Typing into: ${tag}${isNotion ? ' (Notion)' : ''}`);

    await element.click({ force: true });
    await this.page!.waitForTimeout(400);

    if (action.value) {
      if (isNotion || (tag === 'div' && contentEditable !== null)) {
        await this.page!.keyboard.press('Meta+A');
        await this.page!.waitForTimeout(100);
        await this.page!.keyboard.press('Backspace');
        await this.page!.waitForTimeout(200);
        
        await this.page!.keyboard.type(action.value, { delay: 50 });
        console.log(`Typed (keyboard): "${action.value}"`);
        
        await this.page!.waitForTimeout(500);
      } else {
        try {
          await element.fill('');
        } catch {
          await this.page!.keyboard.press('Meta+A');
          await this.page!.keyboard.press('Backspace');
        }
        await element.fill(action.value);
        console.log(`Typed: "${action.value}"`);

        const current = await element.inputValue().catch(() => element.textContent());
        if (!current?.includes(action.value)) {
          console.warn('Type verification failed, but continuing');
        }
      }
    }

    const target = action.target.toLowerCase();
    const currentUrl = this.page!.url();

    if (/issue title|^title$/.test(target)) {
      this.lastIssueTitle = action.value || null;
      console.log('Auto-submit: Cmd+Enter for issue');
      await this.page!.keyboard.press('Meta+Enter');
      await this.page!.waitForTimeout(2000);
    }

    if (/description/.test(target)) {
      console.log('Auto-save: Cmd+Enter for description');
      await this.page!.keyboard.press('Meta+Enter');
      await this.waitForStable(1500);
    }

    if (/comment/.test(target)) {
      console.log('Auto-submit: Cmd+Enter for comment');
      await this.page!.keyboard.press('Meta+Enter');
      await this.waitForStable(1500);
    }

    if (/full name|name|username|email|profile/i.test(target) && currentUrl.includes('/settings/')) {
      console.log('Settings field detected - looking for save button');
      await this.page!.waitForTimeout(500);
      
      const saveButton = await this.findSaveButton();
      if (saveButton) {
        console.log('Clicking save button');
        await saveButton.click();
        await this.waitForStable(1000);
      } else {
        console.log('No save button found - trying Tab+Enter or Escape to trigger save');
        await this.page!.keyboard.press('Tab');
        await this.page!.waitForTimeout(300);
        await this.page!.keyboard.press('Enter');
        await this.waitForStable(1000);
      }
    }
  }

  private async findSaveButton(): Promise<Locator | null> {
    if (!this.page) return null;

    const patterns = [
      () => this.page!.getByRole('button', { name: /save|update|apply|confirm/i }),
      () => this.page!.locator('button[type="submit"]'),
      () => this.page!.locator('button:has-text("Save")'),
      () => this.page!.locator('button:has-text("Update")'),
      () => this.page!.locator('[aria-label*="save" i]'),
      () => this.page!.locator('[data-testid*="save" i]'),
    ];

    for (const pattern of patterns) {
      try {
        const locator = pattern();
        const count = await locator.count();
        if (count > 0) {
          const first = locator.first();
          if (await this.isVisible(first)) {
            return first;
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async scroll(target: string): Promise<void> {
    const lower = target.toLowerCase();

    if (lower.includes('down')) {
      await this.page!.mouse.wheel(0, 800);
    } else if (lower.includes('up')) {
      await this.page!.mouse.wheel(0, -800);
    } else if (lower.includes('bottom')) {
      await this.page!.keyboard.press('End');
    } else if (lower.includes('top')) {
      await this.page!.keyboard.press('Home');
    } else {
      await this.page!.mouse.wheel(0, 600);
    }

    await this.page!.waitForTimeout(500);
    console.log('Scrolled');
  }

  private async openIssueViaSearch(title: string): Promise<boolean> {
    try {
      await this.page!.keyboard.press('Escape');
      await this.page!.waitForTimeout(300);

      await this.page!.keyboard.press('Meta+KeyK');
      await this.page!.waitForTimeout(600);

      const search = this.page!.locator('[role="combobox"], [placeholder*="command" i]').first();
      if (await this.isVisible(search)) {
        console.log('Search opened');
        await this.page!.keyboard.type(title, { delay: 30 });
        await this.page!.waitForTimeout(800);

        await this.page!.keyboard.press('Enter');
        await this.page!.waitForTimeout(1500);

        if (this.page!.url().includes('/issue/')) {
          console.log(`Opened: ${this.page!.url()}`);
          return true;
        }

        await this.page!.keyboard.press('ArrowDown');
        await this.page!.keyboard.press('Enter');
        await this.page!.waitForTimeout(1500);

        if (this.page!.url().includes('/issue/')) {
          return true;
        }

        await this.page!.keyboard.press('Escape');
      }
    } catch {
      // Silent fail
    }
    return false;
  }

  private async autoSelectMenuOption(target: string): Promise<void> {
    const lower = target.toLowerCase();
    const match = lower.match(/(?:to|select|set)\s+(done|high|urgent|in progress|todo|low|medium|backlog)/i);

    if (match) {
      const option = match[1];
      console.log(`Auto-selecting: "${option}"`);
      await this.page!.waitForTimeout(800);

      const optionLoc = this.page!.getByText(option, { exact: false }).first();
      if (await this.isVisible(optionLoc)) {
        await optionLoc.click({ timeout: 3000 });
        console.log(`Selected: "${option}"`);
      }
    }
  }

  private async isVisible(locator: Locator): Promise<boolean> {
    try {
      const count = await locator.count();
      if (count === 0) return false;
      return await locator.first().isVisible({ timeout: 1000 });
    } catch {
      return false;
    }
  }

  private async resolveLabelToInput(locator: Locator): Promise<Locator | null> {
    try {
      const tag = await locator.first().evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'label') {
        const forAttr = await locator.first().getAttribute('for');
        if (forAttr) {
          const input = this.page!.locator(`#${forAttr}`);
          if (await this.isVisible(input)) {
            console.log(`Resolved label to input via for="${forAttr}"`);
            return input.first();
          }
        }
        const associatedInput = locator.first().locator('input, textarea, [contenteditable="true"]');
        if (await this.isVisible(associatedInput)) {
          console.log('Resolved label to associated input');
          return associatedInput.first();
        }
        const nextInput = locator.first().locator('xpath=following::input[1] | following::textarea[1]');
        if (await this.isVisible(nextInput)) {
          console.log('Resolved label to following input');
          return nextInput.first();
        }
      }
    } catch {
      // Silent
    }
    return null;
  }

  private async tryLocator(locator: Locator): Promise<Locator | null> {
    try {
      if (await this.isVisible(locator)) {
        return locator.first();
      }
    } catch {
      // Silent
    }
    return null;
  }

  async waitForStable(ms = 3000): Promise<void> {
    if (!this.page) return;
    try {
      await this.page.waitForLoadState('networkidle', { timeout: ms });
    } catch {
      // SPAs may not reach networkidle
    }
    await this.page.waitForTimeout(600);
  }

  private ensurePage(): void {
    if (!this.page || this.page.isClosed()) {
      throw new Error('Page not initialized');
    }
  }
}
