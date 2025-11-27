import { Locator, Page } from 'playwright';
import type { PlaywrightManager } from './playwright-manager';

type LocatorStrategy = (page: Page) => Locator;

export class ElementFinder {
  constructor(
    private page: Page,
    private manager: PlaywrightManager
  ) {}

  async findElement(target: string): Promise<Locator | null> {
    console.log(`Finding element for target: "${target}"`);

    // 1. Specialized Field Handlers (semantic, not app-specific)
    if (/^title$|title field|item title|task title|issue title/i.test(target)) return this.findTitleField();
    // Description field detection - exclude button text "Add description..."
    if (/description/i.test(target) && !/^add description/i.test(target)) {
      const descField = await this.findDescriptionField();
      if (descField) return descField;
    }
    if (/comment/i.test(target)) return this.findCommentField();
    if (/status badge|status of|change status/i.test(target)) return this.findStatusWithIssueNavigation(target);
    if (/assignee|assign|unassigned|to yourself/i.test(target)) return this.findAssigneeField();
    
    // Status check (exclude "status of" which is handled above)
    if (/status|in progress|todo|done|backlog/i.test(target) && !/status badge|status of/i.test(target)) {
      return this.findStatusField();
    }

    // 2. Item ID Pattern (e.g., PROJ-123, TASK-456, #123, etc.)
    // Matches common ID patterns: ALPHA-NUM, #NUM, or standalone IDs
    const idPatterns = [
      /^([A-Z]{2,10}-\d+)/i,  // PROJ-123, TASK-456
      /^#(\d+)/i,              // #123, #456
      /^([A-Z]+\d+)/i,         // ABC123
    ];
    
    for (const pattern of idPatterns) {
      const match = target.match(pattern);
      if (match) {
        return this.findItemById(match[1] || match[0]);
      }
    }

    // 3. Dialogs (Priority Search)
    const dialogResult = await this.findInDialog(target);
    if (dialogResult) {
      console.log(`Found target in dialog: "${target}"`);
      return (await this.resolveLabelToInput(dialogResult)) || dialogResult;
    }

    // 5. Generic Strategies
    const strategies = this.getGenericStrategies(target);
    for (const strategy of strategies) {
      const result = await strategy();
      if (result) {
        return (await this.resolveLabelToInput(result)) || result;
      }
    }

    return null;
  }

  async fallbackFind(target: string): Promise<Locator | null> {
    const lower = target.toLowerCase();

    // Define fallback buckets
    const fallbacks = [
      {
        match: /\.{3}|more|menu|options/,
        selectors: ['[aria-label*="more" i]', '[aria-label*="options" i]', 'button[aria-haspopup="true"]']
      },
      {
        match: /create|new|add/,
        selectors: ['button:has-text("Create")', 'button:has-text("New")', '[aria-label*="create" i]']
      },
      {
        match: /submit|post|send|save/,
        selectors: ['button[type="submit"]', 'button:has-text("Post")', 'button:has-text("Send")']
      }
    ];

    for (const group of fallbacks) {
      if (group.match.test(lower)) {
        for (const selector of group.selectors) {
          const locator = this.page.locator(selector).first();
          if (await this.isVisible(locator)) return locator;
        }
      }
    }

    // Modal fallback text search
    const modal = this.page.locator('[role="dialog"]').first();
    if (await this.isVisible(modal)) {
      const inModal = modal.getByText(target, { exact: false }).first();
      if (await this.isVisible(inModal)) return inModal;
    }

    return null;
  }

  // --- Specific Finders ---

  private async findStatusWithIssueNavigation(target: string): Promise<Locator | null> {
    console.log('Status operation: Attempting issue detail navigation');
    const issueMatch = target.match(/([A-Z]{2,10}-\d+)/i);
    
    if (issueMatch) {
      const issueId = issueMatch[1];
      const issueLink = await this.findItemById(issueId);
      
      if (issueLink) {
        console.log(`Clicking issue ${issueId} to reveal status`);
        await issueLink.click();
        await this.manager.waitForStable(1000);

        const statusButton = this.page
          .getByRole('button', { name: /status|todo|in progress|done|backlog/i })
          .first();
          
        if (await this.isVisible(statusButton)) return statusButton;
        
        const statusField = await this.findStatusField();
        if (statusField) return statusField;
      }
    }

    const statusBtn = this.page.getByRole('button', { name: /status/i }).first();
    if (await this.isVisible(statusBtn)) return statusBtn;

    return this.findStatusField();
  }

  private async findInDialog(target: string): Promise<Locator | null> {
    const dialogSelectors = [
      '[role="dialog"]', '[role="alertdialog"]', 'dialog', 
      '[data-testid*="modal"]', '[data-testid*="dialog"]'
    ];

    for (const sel of dialogSelectors) {
      const dialog = this.page.locator(sel).first();
      if (await this.isVisible(dialog)) {
        const strategies = this.getDialogStrategies(dialog, target);
        for (const strategy of strategies) {
          const result = await strategy();
          if (result) return result;
        }
      }
    }
    return null;
  }

  private async findTitleField(): Promise<Locator | null> {
    // Generic title field detection - looks for common title/name field patterns
    const selectors = [
      'input[placeholder*="title" i]:not([type="search"])',
      'input[placeholder*="name" i]:not([type="search"])',
      'div[contenteditable="true"][placeholder*="title" i]',
      'div[contenteditable="true"][placeholder*="name" i]',
      '[role="dialog"] input[type="text"]:first-of-type',
      '[role="dialog"] input[type="text"]:not([type="search"])',
    ];

    for (const selector of selectors) {
      const locator = this.page.locator(selector).first();
      if (await this.isVisible(locator)) {
        const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
        if (tag === 'input' || tag === 'div') {
          console.log(`Found title via selector: ${selector}`);
          return locator;
        }
      }
    }

    // Fallback: Check all textboxes
    const textboxes = await this.page.getByRole('textbox').all();
    for (const textbox of textboxes) {
      const placeholder = (await textbox.getAttribute('placeholder')) || '';
      if (placeholder.toLowerCase().includes('title') || placeholder === '') {
        console.log('Found title via generic textbox role');
        return textbox;
      }
    }
    return null;
  }

  private async findDescriptionField(): Promise<Locator | null> {
    const selectors = [
      'div[contenteditable="true"][placeholder*="description" i]',
      'div[contenteditable="true"][data-placeholder*="Add a description" i]',
      'div[contenteditable="true"]:has-text("")', // Empty contenteditable (description field after clicking)
      'textarea[placeholder*="description" i]',
    ];

    // 1. Direct search for existing description field (already opened)
    for (const selector of selectors) {
      const locator = this.page.locator(selector).first();
      if (await this.isVisible(locator)) {
        // Verify it's actually editable, not a button
        const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
        const role = await locator.getAttribute('role').catch(() => null);
        if (tag === 'div' && role !== 'button') {
          console.log(`Found description field via selector: ${selector}`);
          return locator;
        }
      }
    }

    // 2. Look for contenteditable divs that might be description fields
    const contentEditables = await this.page.locator('div[contenteditable="true"]').all();
    for (const editable of contentEditables) {
      const placeholder = await editable.getAttribute('placeholder').catch(() => '') || '';
      const dataPlaceholder = await editable.getAttribute('data-placeholder').catch(() => '') || '';
      const role = await editable.getAttribute('role').catch(() => null);
      
      if (role !== 'button' && (placeholder.toLowerCase().includes('description') || 
          dataPlaceholder.toLowerCase().includes('description') ||
          (placeholder === '' && dataPlaceholder === ''))) {
        const text = (await editable.textContent().catch(() => '')) || '';
        // If it's empty or has minimal text, it's likely the description field
        if (text.trim().length < 50) {
          console.log('Found description field via contenteditable search');
          return editable;
        }
      }
    }

    // 3. If no field found, try clicking common "add description/note/body" buttons
    const addButtonPatterns = [
      this.page.getByText(/add description/i, { exact: false }),
      this.page.getByText(/add note/i, { exact: false }),
      this.page.getByText(/add body/i, { exact: false }),
      this.page.getByText(/add details/i, { exact: false }),
      this.page.locator('button:has-text(/add.*description/i)'),
      this.page.locator('button:has-text(/add.*note/i)'),
    ];
    
    for (const buttonPattern of addButtonPatterns) {
      const addButton = buttonPattern.first();
      if (await this.isVisible(addButton)) {
        console.log('Clicking button to reveal description field');
        await addButton.click();
        await this.manager.waitForStable(1000); // Give it time to appear
        
        // Retry search after button click
        for (const selector of selectors) {
          const locator = this.page.locator(selector).first();
          if (await this.isVisible(locator)) {
            const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
            if (tag === 'div' || tag === 'textarea') {
              console.log(`Found description field after button click: ${selector}`);
              return locator;
            }
          }
        }
        
        // Also check contenteditables again after click
        const newEditables = await this.page.locator('div[contenteditable="true"]').all();
        for (const editable of newEditables) {
          const role = await editable.getAttribute('role').catch(() => null);
          if (role !== 'button') {
            const text = (await editable.textContent().catch(() => '')) || '';
            if (text.trim().length < 50) {
              console.log('Found description field after button click via contenteditable');
              return editable;
            }
          }
        }
        break; // Only try first matching button
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
    for (const selector of selectors) {
      const locator = this.page.locator(selector).first();
      if (await this.isVisible(locator)) {
        const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
        if (tag !== 'button') return locator;
      }
    }
    return null;
  }

  async findAssigneeField(): Promise<Locator | null> {
    return this.findByPatterns(this.getAssigneePatterns());
  }

  async findStatusField(): Promise<Locator | null> {
    const locator = await this.findByPatterns(this.getStatusPatterns());
    if (locator) console.log('Found status field');
    return locator;
  }

  private async findItemById(itemId: string): Promise<Locator | null> {
    console.log(`Searching for item: ${itemId}`);
    const id = itemId.toUpperCase();
    const idLower = id.toLowerCase();

    // Strategy 1: Visible Text -> Ancestor Anchor
    const byText = this.page.getByText(id, { exact: true });
    if (await this.isVisible(byText)) {
      const parent = byText.locator('xpath=ancestor::a').first();
      if (await this.isVisible(parent)) {
        const href = await parent.getAttribute('href');
        if (href && (href.includes(`/${idLower}/`) || href.includes(`/${id}/`) || href.includes(`#${idLower}`))) {
          return parent;
        }
      }
      // Check if text element itself is the link
      const textHref = await byText.getAttribute('href').catch(() => null);
      if (textHref && (textHref.includes(`/${idLower}/`) || textHref.includes(`/${id}/`) || textHref.includes(`#${idLower}`))) {
        return byText.first();
      }
    }

    // Strategy 2: Data Attributes (generic item ID patterns)
    const dataPatterns = [
      `[data-item-id="${id}"]`,
      `[data-item-id="${idLower}"]`,
      `[data-id="${id}"]`,
      `[data-id="${idLower}"]`,
      `[data-issue-id="${id}"]`,
      `[data-issue-id="${idLower}"]`,
      `[data-task-id="${id}"]`,
      `[data-task-id="${idLower}"]`,
    ];
    
    for (const pattern of dataPatterns) {
      const byData = this.page.locator(pattern);
      if (await this.isVisible(byData)) return byData.first();
    }

    // Strategy 3: Href scan - look for links containing the ID
    const allLinks = this.page.locator('a[href]');
    const linkCount = Math.min(await allLinks.count(), 100); // Limit to avoid performance issues
    
    for (let i = 0; i < linkCount; i++) {
      const link = allLinks.nth(i);
      const href = await link.getAttribute('href');
      if (href && (href.includes(idLower) || href.includes(id) || href.includes(`#${idLower}`))) {
        if (await this.isVisible(link)) return link;
      }
    }

    // Strategy 4: Global search (if app supports it)
    console.log(`Item not found on page, trying global search for: ${id}`);
    if (await this.openItemViaSearch(id)) {
      return this.page.locator('body'); // Return valid locator to indicate success
    }

    return null;
  }

  private async openItemViaSearch(query: string): Promise<boolean> {
    try {
      // Reset UI state
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(300);
      
      // Cmd+K / Ctrl+K
      await this.page.keyboard.press('Meta+KeyK');
      await this.page.waitForTimeout(600);

      const searchInput = this.page.locator('[role="combobox"], [placeholder*="command" i]').first();
      if (await this.isVisible(searchInput)) {
        await this.page.keyboard.type(query, { delay: 30 });
        await this.page.waitForTimeout(800);
        
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(1500);

        if (this.page.url().includes('/issue/')) return true;

        // Try second option if first failed
        await this.page.keyboard.press('ArrowDown');
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(1500);

        if (this.page.url().includes('/issue/')) return true;

        await this.page.keyboard.press('Escape');
      }
    } catch {
      // Silently fail search attempts
    }
    return false;
  }

  // --- Utilities ---

  private async findByPatterns(patterns: LocatorStrategy[]): Promise<Locator | null> {
    for (const pattern of patterns) {
      try {
        const locator = pattern(this.page);
        if (await this.isVisible(locator)) return locator.first();
      } catch {
        continue;
      }
    }
    return null;
  }

  async isVisible(locator: Locator): Promise<boolean> {
    try {
      if ((await locator.count()) === 0) return false;
      return await locator.first().isVisible({ timeout: 1000 });
    } catch {
      return false;
    }
  }

  async resolveLabelToInput(locator: Locator): Promise<Locator | null> {
    try {
      const first = locator.first();
      const tag = await first.evaluate((el) => el.tagName.toLowerCase());
      
      if (tag !== 'label') return null;

      // 1. 'for' attribute
      const forAttr = await first.getAttribute('for');
      if (forAttr) {
        const input = this.page.locator(`#${forAttr}`);
        if (await this.isVisible(input)) return input.first();
      }

      // 2. Nested input
      const nested = first.locator('input, textarea, [contenteditable="true"]');
      if (await this.isVisible(nested)) return nested.first();

      // 3. Immediately following input
      const sibling = first.locator('xpath=following::input[1] | following::textarea[1]');
      if (await this.isVisible(sibling)) return sibling.first();

    } catch {
      // Ignore resolution errors
    }
    return null;
  }

  async tryLocator(locator: Locator): Promise<Locator | null> {
    return (await this.isVisible(locator)) ? locator.first() : null;
  }

  // --- Pattern Factories ---

  private getGenericStrategies(target: string): (() => Promise<Locator | null>)[] {
    const t = target;
    const r = new RegExp(target, 'i');
    return [
      () => this.tryLocator(this.page.getByRole('button', { name: t, exact: true })),
      () => this.tryLocator(this.page.getByRole('button', { name: r })),
      () => this.tryLocator(this.page.getByRole('link', { name: t, exact: true })),
      () => this.tryLocator(this.page.getByRole('link', { name: r })),
      () => this.tryLocator(this.page.getByText(t, { exact: true })),
      () => this.tryLocator(this.page.getByPlaceholder(t)),
      () => this.tryLocator(this.page.getByLabel(t)),
      () => this.tryLocator(this.page.getByRole('textbox', { name: r })),
      () => this.tryLocator(this.page.getByText(r)),
      () => this.tryLocator(this.page.locator(`[aria-label*="${t}" i]`)),
    ];
  }

  private getDialogStrategies(dialog: Locator, target: string): (() => Promise<Locator | null>)[] {
    const t = target;
    const r = new RegExp(target, 'i');
    return [
      () => this.tryLocator(dialog.getByRole('button', { name: t, exact: true })),
      () => this.tryLocator(dialog.getByRole('button', { name: r })),
      () => this.tryLocator(dialog.getByRole('link', { name: t, exact: true })),
      () => this.tryLocator(dialog.getByText(t, { exact: true })),
      () => this.tryLocator(dialog.getByPlaceholder(t)),
      () => this.tryLocator(dialog.getByLabel(t)),
      () => this.tryLocator(dialog.getByRole('textbox', { name: r })),
      () => this.tryLocator(dialog.locator(`[aria-label*="${t}" i]`)),
    ];
  }

  private getAssigneePatterns(): LocatorStrategy[] {
    return [
      (p) => p.getByRole('button', { name: /assign/i }),
      (p) => p.getByRole('button', { name: /assignee/i }),
      (p) => p.getByText(/No assignee/i),
      (p) => p.getByText(/Unassigned/i),
      (p) => p.locator('[aria-label*="Assignee" i]'),
      (p) => p.locator('[aria-label*="assign" i]'),
      (p) => p.locator('[data-testid*="assignee" i]'),
      (p) => p.locator('button:has-text("Assign")'),
      (p) => p.locator('button:has-text("Unassigned")'),
    ];
  }

  private getStatusPatterns(): LocatorStrategy[] {
    return [
      (p) => p.getByRole('button', { name: /status/i }),
      (p) => p.locator('[aria-label*="Status" i]'),
      (p) => p.locator('[data-testid*="status" i]'),
      (p) => p.locator('button[class*="status"], button[class*="badge"]'),
      (p) => p.locator('[role="button"]:has-text("Todo")'),
      (p) => p.locator('[role="button"]:has-text("In Progress")'),
      (p) => p.locator('[role="button"]:has-text("Done")'),
      (p) => p.locator('[role="button"]:has-text("Backlog")'),
      (p) => p.locator('button:has-text("Status")'),
    ];
  }

}
