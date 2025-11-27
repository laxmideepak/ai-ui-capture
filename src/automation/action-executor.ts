import { Locator, Page } from 'playwright';
import { ActionPayload, PlaywrightManager } from './playwright-manager';
import { ElementFinder } from './element-finder';

export class ActionExecutor {
  constructor(
    private page: Page,
    private finder: ElementFinder,
    private manager: PlaywrightManager
  ) {}

  async execute(action: ActionPayload, retries = 2): Promise<void> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`Retry ${attempt}/${retries} for ${action.type}...`);
          await this.page.waitForTimeout(1000);
        }

        console.log(`Executing: ${action.type} -> "${action.target}"`);

        // 1. Non-element actions
        if (action.type === 'wait') {
          await this.page.waitForTimeout(2000);
          return;
        }
        if (action.type === 'complete') {
          console.log('Task marked as complete');
          return;
        }
        if (action.type === 'navigate') {
          await this.manager.navigate(action.value || action.target);
          return;
        }
        if (action.type === 'scroll') {
          await this.scroll(action.target);
          return;
        }

        // 2. Element resolution
        let element = await this.finder.findElement(action.target);
        if (!element) {
          element = await this.finder.fallbackFind(action.target);
        }

        // NEW: If looking for description and failing, try more aggressively
        if (!element && /description/i.test(action.target) && action.type === 'type') {
          console.log('Description field not found - trying aggressive search');
          const anyEditable = this.page.locator('[contenteditable="true"]').last();
          if (await this.finder.isVisible(anyEditable)) {
            const role = await anyEditable.getAttribute('role').catch(() => null);
            if (role !== 'button') {
              element = anyEditable;
              console.log('Using last contenteditable as description field');
            }
          }
        }

        if (!element) {
          if (await this.tryShortcut(action)) return;
          
          console.warn(`Element not found: "${action.target}"`);
          if (attempt === retries) return; // Fail gracefully on last attempt
          continue;
        }

        // 3. Interaction
        if (action.type === 'click') {
          await this.click(element, action.target);
        } else if (action.type === 'type') {
          await this.type(element, action);
        }

        await this.manager.waitForStable();
        return;

      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Attempt ${attempt + 1} failed: ${msg}`);
        if (attempt === retries) return;
      }
    }
  }

  private async click(element: Locator, targetName: string): Promise<void> {
    await element.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(300);

    try {
      await element.click({ timeout: 5000 });
    } catch {
      console.warn('Standard click failed, attempting force click');
      await element.click({ force: true });
    }

    console.log(`Clicked: "${targetName}"`);
    await this.page.waitForTimeout(500);

    // Check for auto-opening menus
    const menuOpen = await this.page.locator('[role="menu"], [role="listbox"]').isVisible().catch(() => false);
    if (menuOpen) {
      await this.autoSelectMenuOption(targetName);
    }
  }

  private async type(element: Locator, action: ActionPayload): Promise<void> {
    await element.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(300);

    // Get element details
    let [tag, contentEditable, role, isButton] = await element.evaluate((el) => [
      el.tagName.toLowerCase(),
      el.getAttribute('contenteditable'),
      el.getAttribute('role'),
      el.tagName.toLowerCase() === 'button' || el.getAttribute('role') === 'button',
    ]);

    // CRITICAL: Don't try to type into buttons
    if (isButton) {
      console.error(`Attempted to type into a button - this is wrong: "${action.target}"`);
      throw new Error(`Cannot type into button element: "${action.target}"`);
    }

    // If we found a label, re-resolve to the input
    if (tag === 'label') {
      console.log('Found label, resolving to input field');
      const resolved = await this.finder.resolveLabelToInput(element);
      if (!resolved) throw new Error('Found label but could not resolve to input field');
      
      element = resolved;
      // Re-evaluate props for the actual input
      const newProps = await element.evaluate((el) => [
        el.tagName.toLowerCase(),
        el.getAttribute('contenteditable'),
        el.getAttribute('role'),
      ]);
      tag = newProps[0];
      contentEditable = newProps[1];
      role = newProps[2];
    }

    const isEditable = 
      tag === 'input' || 
      tag === 'textarea' || 
      contentEditable === 'true' || 
      contentEditable === '' || 
      role === 'textbox';

    if (!isEditable) {
      console.error(`Element is not editable: tag=${tag}, role=${role}, contenteditable=${contentEditable}`);
      throw new Error(`Not editable: ${tag}, role=${role}, contenteditable=${contentEditable}`);
    }

    // Check if it's Notion for contenteditable handling
    const isNotion = await element.evaluate((el) => 
      el.closest('[class*="notion"]') !== null || el.getAttribute('data-content-root') !== null
    );

    console.log(`Typing into ${tag} ${isNotion ? '(Notion)' : ''}`);
    await element.click({ force: true });
    await this.page.waitForTimeout(400);

    if (action.value) {
      if (isNotion || (tag === 'div' && contentEditable !== null)) {
        await this.typeInContentEditable(action.value);
      } else {
        await this.typeInInput(element, action.value);
      }
    }

    await this.handlePostTypeActions(action.target);
  }

  private async typeInContentEditable(value: string): Promise<void> {
    // Clear via keyboard to handle rich text editors safe
    await this.page.keyboard.press('Meta+A');
    await this.page.waitForTimeout(100);
    await this.page.keyboard.press('Backspace');
    await this.page.waitForTimeout(200);
    
    await this.page.keyboard.type(value, { delay: 50 });
    console.log(`Typed (simulated): "${value}"`);
    await this.page.waitForTimeout(500);
  }

  private async typeInInput(element: Locator, value: string): Promise<void> {
    try {
      await element.fill('');
    } catch {
      // Fallback if fill fails (e.g. some React inputs)
      await this.page.keyboard.press('Meta+A');
      await this.page.keyboard.press('Backspace');
    }
    
    await element.fill(value);
    console.log(`Typed: "${value}"`);

    // Loose verification
    const currentVal = await element.inputValue().catch(() => element.textContent());
    if (!currentVal?.includes(value)) {
      console.warn('Warning: Input verification failed (value mismatch)');
    }
  }

  private async handlePostTypeActions(target: string): Promise<void> {
    const targetLower = target.toLowerCase();
    const isUrlSettings = this.page.url().includes('/settings/');

    if (/issue title|^title$/.test(targetLower)) {
      console.log('Action: Auto-submit (Cmd+Enter) for issue');
      await this.page.keyboard.press('Meta+Enter');
      await this.page.waitForTimeout(2000);
    } else if (/description/.test(targetLower)) {
      console.log('Action: Auto-save (Cmd+Enter) for description');
      await this.page.keyboard.press('Meta+Enter');
      await this.manager.waitForStable(1500);
    } else if (/comment/.test(targetLower)) {
      console.log('Action: Auto-submit (Cmd+Enter) for comment');
      await this.page.keyboard.press('Meta+Enter');
      await this.manager.waitForStable(1500);
    } else if (/full name|name|username|email|profile/i.test(targetLower) && isUrlSettings) {
      await this.handleSettingsSave();
    }
  }

  private async handleSettingsSave(): Promise<void> {
    console.log('Settings detected - searching for Save action');
    await this.page.waitForTimeout(500);
    
    const saveButton = await this.finder.findSaveButton();
    if (saveButton) {
      await saveButton.click();
      await this.manager.waitForStable(1000);
    } else {
      console.log('No save button found - attempting Tab+Enter');
      await this.page.keyboard.press('Tab');
      await this.page.waitForTimeout(300);
      await this.page.keyboard.press('Enter');
      await this.manager.waitForStable(1000);
    }
  }

  private async scroll(target: string): Promise<void> {
    const lower = target.toLowerCase();
    
    if (lower.includes('down')) await this.page.mouse.wheel(0, 800);
    else if (lower.includes('up')) await this.page.mouse.wheel(0, -800);
    else if (lower.includes('bottom')) await this.page.keyboard.press('End');
    else if (lower.includes('top')) await this.page.keyboard.press('Home');
    else await this.page.mouse.wheel(0, 600); // Default

    await this.page.waitForTimeout(500);
    console.log('Scroll action completed');
  }

  private async tryShortcut(action: ActionPayload): Promise<boolean> {
    const target = action.target.toLowerCase();

    // Mapping intent to shortcuts
    if (/create|new|plus|\+/.test(target)) {
      console.log('Shortcut: Pressing "C" (Create)');
      await this.page.keyboard.press('KeyC');
      await this.page.waitForTimeout(1500);
      
      const modal = this.page.locator('[role="dialog"], [placeholder*="Title" i]');
      if (await this.finder.isVisible(modal)) return true;
    }

    if (/submit|send|post|save/.test(target)) {
      console.log('Shortcut: Pressing Cmd+Enter (Submit)');
      await this.page.keyboard.press('Meta+Enter');
      await this.page.waitForTimeout(1500);
      return true;
    }

    if (/delete|remove/.test(target)) {
      console.log('Shortcut: Cmd+Backspace (Delete)');
      await this.page.keyboard.press('Meta+Backspace');
      await this.page.waitForTimeout(1000);
      await this.page.keyboard.press('Enter');
      return true;
    }

    if (/close|cancel/.test(target)) {
      await this.page.keyboard.press('Escape');
      return true;
    }

    return false;
  }

  private async autoSelectMenuOption(target: string): Promise<void> {
    const lower = target.toLowerCase();
    const match = lower.match(/(?:to|select|set)\s+(done|high|urgent|in progress|todo|low|medium|backlog)/i);
    
    if (match) {
      const option = match[1];
      console.log(`Menu open: Auto-selecting "${option}"`);
      await this.page.waitForTimeout(800);
      
      const optionLocator = this.page.getByText(option, { exact: false }).first();
      if (await this.finder.isVisible(optionLocator)) {
        await optionLocator.click({ timeout: 3000 });
      }
    }
  }
}
