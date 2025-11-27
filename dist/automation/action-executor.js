"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionExecutor = void 0;
class ActionExecutor {
    page;
    finder;
    manager;
    constructor(page, finder, manager) {
        this.page = page;
        this.finder = finder;
        this.manager = manager;
    }
    async execute(action, retries = 2) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`Retry ${attempt}/${retries}`);
                    await this.page.waitForTimeout(1000);
                }
                console.log(`Action: ${action.type} -> "${action.target}"`);
                if (action.type === 'wait') {
                    await this.page.waitForTimeout(2000);
                    return;
                }
                if (action.type === 'complete') {
                    console.log('Task complete');
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
                let element = await this.finder.findElement(action.target);
                if (!element) {
                    element = await this.finder.fallbackFind(action.target);
                }
                if (!element) {
                    if (await this.tryShortcut(action))
                        return;
                    console.warn(`Element not found: "${action.target}"`);
                    if (attempt === retries)
                        return;
                    continue;
                }
                if (action.type === 'click') {
                    await this.click(element, action.target);
                }
                else if (action.type === 'type') {
                    await this.type(element, action);
                }
                await this.manager.waitForStable();
                return;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown';
                console.error(`Attempt ${attempt + 1} failed: ${message}`);
                if (attempt === retries)
                    return;
            }
        }
    }
    async click(element, target) {
        await element.scrollIntoViewIfNeeded();
        await this.page.waitForTimeout(300);
        try {
            await element.click({ timeout: 5000 });
        }
        catch {
            await element.click({ force: true });
        }
        console.log(`Clicked: "${target}"`);
        await this.page.waitForTimeout(500);
        const menuOpen = await this.page
            .locator('[role="menu"], [role="listbox"]')
            .isVisible()
            .catch(() => false);
        if (menuOpen) {
            await this.autoSelectMenuOption(target);
        }
    }
    async type(element, action) {
        await element.scrollIntoViewIfNeeded();
        await this.page.waitForTimeout(300);
        let [tag, contentEditable, role, isNotion] = await element.evaluate((el) => [
            el.tagName.toLowerCase(),
            el.getAttribute('contenteditable'),
            el.getAttribute('role'),
            el.closest('[class*="notion"]') !== null || el.getAttribute('data-content-root') !== null,
        ]);
        if (tag === 'label') {
            console.log('Found label element, resolving to associated input');
            const resolved = await this.finder.resolveLabelToInput(element);
            if (resolved) {
                element = resolved;
                [tag, contentEditable, role, isNotion] = await element.evaluate((el) => [
                    el.tagName.toLowerCase(),
                    el.getAttribute('contenteditable'),
                    el.getAttribute('role'),
                    el.closest('[class*="notion"]') !== null || el.getAttribute('data-content-root') !== null,
                ]);
            }
            else {
                throw new Error('Found label but could not resolve to input field');
            }
        }
        const isEditable = tag === 'input' ||
            tag === 'textarea' ||
            contentEditable === 'true' ||
            contentEditable === '' ||
            role === 'textbox';
        if (!isEditable) {
            throw new Error(`Not editable: ${tag}, role=${role}, contenteditable=${contentEditable}`);
        }
        console.log(`Typing into: ${tag}${isNotion ? ' (Notion)' : ''}`);
        await element.click({ force: true });
        await this.page.waitForTimeout(400);
        if (action.value) {
            if (isNotion || (tag === 'div' && contentEditable !== null)) {
                await this.typeInContentEditable(action.value);
            }
            else {
                await this.typeInInput(element, action.value);
            }
        }
        await this.handlePostTypeActions(action.target, action.value);
    }
    async typeInContentEditable(value) {
        await this.page.keyboard.press('Meta+A');
        await this.page.waitForTimeout(100);
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(200);
        await this.page.keyboard.type(value, { delay: 50 });
        console.log(`Typed (keyboard): "${value}"`);
        await this.page.waitForTimeout(500);
    }
    async typeInInput(element, value) {
        try {
            await element.fill('');
        }
        catch {
            await this.page.keyboard.press('Meta+A');
            await this.page.keyboard.press('Backspace');
        }
        await element.fill(value);
        console.log(`Typed: "${value}"`);
        const current = await element.inputValue().catch(() => element.textContent());
        if (!current?.includes(value)) {
            console.warn('Type verification failed, but continuing');
        }
    }
    async handlePostTypeActions(target, value) {
        const targetLower = target.toLowerCase();
        const currentUrl = this.page.url();
        if (/issue title|^title$/.test(targetLower)) {
            this.manager.setLastIssueTitle(value || null);
            console.log('Auto-submit: Cmd+Enter for issue');
            await this.page.keyboard.press('Meta+Enter');
            await this.page.waitForTimeout(2000);
        }
        if (/description/.test(targetLower)) {
            console.log('Auto-save: Cmd+Enter for description');
            await this.page.keyboard.press('Meta+Enter');
            await this.manager.waitForStable(1500);
        }
        if (/comment/.test(targetLower)) {
            console.log('Auto-submit: Cmd+Enter for comment');
            await this.page.keyboard.press('Meta+Enter');
            await this.manager.waitForStable(1500);
        }
        if (/full name|name|username|email|profile/i.test(targetLower) && currentUrl.includes('/settings/')) {
            await this.handleSettingsSave();
        }
    }
    async handleSettingsSave() {
        console.log('Settings field detected - looking for save button');
        await this.page.waitForTimeout(500);
        const saveButton = await this.finder.findSaveButton();
        if (saveButton) {
            console.log('Clicking save button');
            await saveButton.click();
            await this.manager.waitForStable(1000);
        }
        else {
            console.log('No save button found - trying Tab+Enter to trigger save');
            await this.page.keyboard.press('Tab');
            await this.page.waitForTimeout(300);
            await this.page.keyboard.press('Enter');
            await this.manager.waitForStable(1000);
        }
    }
    async scroll(target) {
        const lower = target.toLowerCase();
        if (lower.includes('down')) {
            await this.page.mouse.wheel(0, 800);
        }
        else if (lower.includes('up')) {
            await this.page.mouse.wheel(0, -800);
        }
        else if (lower.includes('bottom')) {
            await this.page.keyboard.press('End');
        }
        else if (lower.includes('top')) {
            await this.page.keyboard.press('Home');
        }
        else {
            await this.page.mouse.wheel(0, 600);
        }
        await this.page.waitForTimeout(500);
        console.log('Scrolled');
    }
    async tryShortcut(action) {
        const target = action.target.toLowerCase();
        if (/create|new|plus|\+/.test(target)) {
            console.log('Trying "C" key (create)');
            await this.page.keyboard.press('KeyC');
            await this.page.waitForTimeout(1500);
            const modal = this.page.locator('[role="dialog"], [placeholder*="Title" i]');
            if (await this.finder.isVisible(modal)) {
                console.log('Create modal opened');
                return true;
            }
        }
        if (/submit|send|post|save/.test(target)) {
            console.log('Trying Cmd+Enter (submit)');
            await this.page.keyboard.press('Meta+Enter');
            await this.page.waitForTimeout(1500);
            return true;
        }
        if (/delete|remove/.test(target)) {
            console.log('Trying Cmd+Backspace (delete)');
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
    async autoSelectMenuOption(target) {
        const lower = target.toLowerCase();
        const match = lower.match(/(?:to|select|set)\s+(done|high|urgent|in progress|todo|low|medium|backlog)/i);
        if (match) {
            const option = match[1];
            console.log(`Auto-selecting: "${option}"`);
            await this.page.waitForTimeout(800);
            const optionLocator = this.page.getByText(option, { exact: false }).first();
            if (await this.finder.isVisible(optionLocator)) {
                await optionLocator.click({ timeout: 3000 });
                console.log(`Selected: "${option}"`);
            }
        }
    }
}
exports.ActionExecutor = ActionExecutor;
