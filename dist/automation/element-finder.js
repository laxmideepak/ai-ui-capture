"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElementFinder = void 0;
class ElementFinder {
    page;
    manager;
    constructor(page, manager) {
        this.page = page;
        this.manager = manager;
    }
    async findElement(target) {
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
            return this.findStatusWithIssueNavigation(target);
        }
        if (/assignee|assign|unassigned|to yourself/i.test(target)) {
            return this.findAssigneeField();
        }
        if (/status|in progress|todo|done|backlog/i.test(target) && !/status badge|status of/i.test(target)) {
            return this.findStatusField();
        }
        const issueMatch = target.match(/^([A-Z]{2,10}-\d+)/i);
        if (issueMatch) {
            return this.findIssue(issueMatch[1]);
        }
        if (/notification/i.test(target)) {
            const notification = await this.findByPatterns(this.getNotificationPatterns());
            if (notification) {
                console.log('Found notification element');
                return notification;
            }
        }
        const dialogResult = await this.findInDialog(target);
        if (dialogResult) {
            console.log(`Found in dialog: "${target}"`);
            const resolved = await this.resolveLabelToInput(dialogResult);
            return resolved || dialogResult;
        }
        const strategies = this.getGenericStrategies(target);
        for (const strategy of strategies) {
            const result = await strategy();
            if (result) {
                const resolved = await this.resolveLabelToInput(result);
                return resolved || result;
            }
        }
        return null;
    }
    async fallbackFind(target) {
        const lower = target.toLowerCase();
        if (/\.{3}|more|menu|options/.test(lower)) {
            const selectors = [
                '[aria-label*="more" i]',
                '[aria-label*="options" i]',
                'button[aria-haspopup="true"]',
            ];
            for (const selector of selectors) {
                const locator = this.page.locator(selector).first();
                if (await this.isVisible(locator))
                    return locator;
            }
        }
        if (/create|new|add/.test(lower)) {
            const selectors = [
                'button:has-text("Create")',
                'button:has-text("New")',
                '[aria-label*="create" i]',
            ];
            for (const selector of selectors) {
                const locator = this.page.locator(selector).first();
                if (await this.isVisible(locator))
                    return locator;
            }
        }
        if (/submit|post|send|save/.test(lower)) {
            const selectors = [
                'button[type="submit"]',
                'button:has-text("Post")',
                'button:has-text("Send")',
            ];
            for (const selector of selectors) {
                const locator = this.page.locator(selector).first();
                if (await this.isVisible(locator))
                    return locator;
            }
        }
        const modal = this.page.locator('[role="dialog"]').first();
        if (await this.isVisible(modal)) {
            const inModal = modal.getByText(target, { exact: false });
            if (await this.isVisible(inModal))
                return inModal.first();
        }
        return null;
    }
    async findStatusWithIssueNavigation(target) {
        console.log('Status operation detected - trying issue detail approach');
        const issueMatch = target.match(/([A-Z]{2,10}-\d+)/i);
        if (issueMatch) {
            const issueId = issueMatch[1];
            console.log(`Looking for issue ${issueId} to open detail view`);
            const issueLink = await this.findIssue(issueId);
            if (issueLink) {
                console.log(`Found issue ${issueId}, clicking to open detail`);
                await issueLink.click();
                await this.manager.waitForStable(1000);
                const statusButton = this.page
                    .getByRole('button', { name: /status|todo|in progress|done|backlog/i })
                    .first();
                if ((await statusButton.count()) > 0 && await this.isVisible(statusButton)) {
                    console.log('Found status dropdown in detail view');
                    return statusButton;
                }
                const statusField = await this.findStatusField();
                if (statusField)
                    return statusField;
            }
        }
        const statusBtn = this.page.getByRole('button', { name: /status/i }).first();
        if ((await statusBtn.count()) > 0 && await this.isVisible(statusBtn)) {
            return statusBtn;
        }
        return this.findStatusField();
    }
    async findInDialog(target) {
        const dialogSelectors = [
            '[role="dialog"]',
            '[role="alertdialog"]',
            'dialog',
            '[data-testid*="modal"]',
            '[data-testid*="dialog"]',
        ];
        for (const dialogSelector of dialogSelectors) {
            const dialog = this.page.locator(dialogSelector).first();
            if (await this.isVisible(dialog)) {
                const strategies = this.getDialogStrategies(dialog, target);
                for (const strategy of strategies) {
                    const result = await strategy();
                    if (result)
                        return result;
                }
            }
        }
        return null;
    }
    async findTitleField() {
        const selectors = [
            'input[placeholder*="Issue title" i]',
            'input[placeholder*="title" i]:not([type="search"])',
            'div[contenteditable="true"][placeholder*="title" i]',
            '[role="dialog"] input[type="text"]',
        ];
        for (const selector of selectors) {
            const locator = this.page.locator(selector).first();
            if (await this.isVisible(locator)) {
                const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
                if (tag === 'input' || tag === 'div') {
                    console.log(`Found title: ${selector}`);
                    return locator;
                }
            }
        }
        const textboxes = await this.page.getByRole('textbox').all();
        for (const textbox of textboxes) {
            const placeholder = (await textbox.getAttribute('placeholder')) || '';
            if (placeholder.toLowerCase().includes('title') || placeholder === '') {
                console.log('Found title via textbox role');
                return textbox;
            }
        }
        return null;
    }
    async findDescriptionField() {
        const selectors = [
            'div[contenteditable="true"][placeholder*="description" i]',
            'div[contenteditable="true"][data-placeholder*="Add a description" i]',
            'textarea[placeholder*="description" i]',
        ];
        for (const selector of selectors) {
            const locator = this.page.locator(selector).first();
            if (await this.isVisible(locator)) {
                console.log(`Found description: ${selector}`);
                return locator;
            }
        }
        const addButton = this.page.getByText('Add description', { exact: false }).first();
        if (await this.isVisible(addButton)) {
            console.log('Clicking "Add description" button');
            await addButton.click();
            await this.manager.waitForStable(800);
            for (const selector of selectors) {
                const locator = this.page.locator(selector).first();
                if (await this.isVisible(locator))
                    return locator;
            }
        }
        const lastIssueTitle = this.manager.getLastIssueTitle();
        if (lastIssueTitle) {
            console.log(`Opening issue "${lastIssueTitle}" for description`);
            if (await this.openIssueViaSearch(lastIssueTitle)) {
                this.manager.setLastIssueTitle(null);
                await this.manager.waitForStable(1000);
                const button = this.page.getByText('Add description', { exact: false }).first();
                if (await this.isVisible(button)) {
                    await button.click();
                    await this.manager.waitForStable(800);
                }
                for (const selector of selectors) {
                    const locator = this.page.locator(selector).first();
                    if (await this.isVisible(locator))
                        return locator;
                }
            }
        }
        return null;
    }
    async findCommentField() {
        const selectors = [
            '[contenteditable="true"][placeholder*="comment" i]',
            'textarea[placeholder*="comment" i]',
            'div[contenteditable="true"][role="textbox"]',
        ];
        for (const selector of selectors) {
            const locator = this.page.locator(selector).first();
            if (await this.isVisible(locator)) {
                const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
                if (tag !== 'button') {
                    console.log(`Found comment: ${selector}`);
                    return locator;
                }
            }
        }
        return null;
    }
    async findAssigneeField() {
        return this.findByPatterns(this.getAssigneePatterns());
    }
    async findStatusField() {
        const patterns = this.getStatusPatterns();
        for (const pattern of patterns) {
            try {
                const locator = pattern(this.page);
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
            }
            catch {
                continue;
            }
        }
        return null;
    }
    async findSaveButton() {
        return this.findByPatterns(this.getSaveButtonPatterns());
    }
    async findIssue(issueId) {
        console.log(`Finding issue: ${issueId}`);
        const id = issueId.toUpperCase();
        const idLower = id.toLowerCase();
        const byText = this.page.getByText(id, { exact: true });
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
        const byData = this.page.locator(`[data-issue-id="${id}"], [data-issue-id="${idLower}"]`);
        if (await this.isVisible(byData)) {
            console.log(`Found issue via data-issue-id: ${id}`);
            return byData.first();
        }
        const allLinks = this.page.locator('a[href*="/issue/"]');
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
        const byTextCI = this.page.getByText(new RegExp(`^${id}$`, 'i'));
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
            return this.page.locator('body');
        }
        return null;
    }
    async openIssueViaSearch(title) {
        try {
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(300);
            await this.page.keyboard.press('Meta+KeyK');
            await this.page.waitForTimeout(600);
            const search = this.page.locator('[role="combobox"], [placeholder*="command" i]').first();
            if (await this.isVisible(search)) {
                console.log('Search opened');
                await this.page.keyboard.type(title, { delay: 30 });
                await this.page.waitForTimeout(800);
                await this.page.keyboard.press('Enter');
                await this.page.waitForTimeout(1500);
                if (this.page.url().includes('/issue/')) {
                    console.log(`Opened: ${this.page.url()}`);
                    return true;
                }
                await this.page.keyboard.press('ArrowDown');
                await this.page.keyboard.press('Enter');
                await this.page.waitForTimeout(1500);
                if (this.page.url().includes('/issue/')) {
                    return true;
                }
                await this.page.keyboard.press('Escape');
            }
        }
        catch {
            // Search failed silently
        }
        return false;
    }
    async findByPatterns(patterns) {
        for (const pattern of patterns) {
            try {
                const locator = pattern(this.page);
                const count = await locator.count();
                if (count > 0) {
                    const first = locator.first();
                    if (await this.isVisible(first)) {
                        return first;
                    }
                }
            }
            catch {
                continue;
            }
        }
        return null;
    }
    async isVisible(locator) {
        try {
            const count = await locator.count();
            if (count === 0)
                return false;
            return await locator.first().isVisible({ timeout: 1000 });
        }
        catch {
            return false;
        }
    }
    async resolveLabelToInput(locator) {
        try {
            const tag = await locator.first().evaluate((el) => el.tagName.toLowerCase());
            if (tag !== 'label')
                return null;
            const forAttr = await locator.first().getAttribute('for');
            if (forAttr) {
                const input = this.page.locator(`#${forAttr}`);
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
        catch {
            // Resolution failed
        }
        return null;
    }
    async tryLocator(locator) {
        try {
            if (await this.isVisible(locator)) {
                return locator.first();
            }
        }
        catch {
            // Locator failed
        }
        return null;
    }
    getGenericStrategies(target) {
        return [
            () => this.tryLocator(this.page.getByRole('button', { name: target, exact: true })),
            () => this.tryLocator(this.page.getByRole('button', { name: new RegExp(target, 'i') })),
            () => this.tryLocator(this.page.getByRole('link', { name: target, exact: true })),
            () => this.tryLocator(this.page.getByRole('link', { name: new RegExp(target, 'i') })),
            () => this.tryLocator(this.page.getByText(target, { exact: true })),
            () => this.tryLocator(this.page.getByPlaceholder(target)),
            () => this.tryLocator(this.page.getByLabel(target)),
            () => this.tryLocator(this.page.getByRole('textbox', { name: new RegExp(target, 'i') })),
            () => this.tryLocator(this.page.getByText(new RegExp(target, 'i'))),
            () => this.tryLocator(this.page.locator(`[aria-label*="${target}" i]`)),
        ];
    }
    getDialogStrategies(dialog, target) {
        return [
            () => this.tryLocator(dialog.getByRole('button', { name: target, exact: true })),
            () => this.tryLocator(dialog.getByRole('button', { name: new RegExp(target, 'i') })),
            () => this.tryLocator(dialog.getByRole('link', { name: target, exact: true })),
            () => this.tryLocator(dialog.getByText(target, { exact: true })),
            () => this.tryLocator(dialog.getByPlaceholder(target)),
            () => this.tryLocator(dialog.getByLabel(target)),
            () => this.tryLocator(dialog.getByRole('textbox', { name: new RegExp(target, 'i') })),
            () => this.tryLocator(dialog.locator(`[aria-label*="${target}" i]`)),
        ];
    }
    getAssigneePatterns() {
        return [
            (page) => page.getByRole('button', { name: /assign/i }),
            (page) => page.getByRole('button', { name: /assignee/i }),
            (page) => page.getByText(/No assignee/i),
            (page) => page.getByText(/Unassigned/i),
            (page) => page.locator('[aria-label*="Assignee" i]'),
            (page) => page.locator('[aria-label*="assign" i]'),
            (page) => page.locator('[data-testid*="assignee" i]'),
            (page) => page.locator('button:has-text("Assign")'),
            (page) => page.locator('button:has-text("Unassigned")'),
        ];
    }
    getStatusPatterns() {
        return [
            (page) => page.getByRole('button', { name: /status/i }),
            (page) => page.locator('[aria-label*="Status" i]'),
            (page) => page.locator('[data-testid*="status" i]'),
            (page) => page.locator('button[class*="status"], button[class*="badge"]'),
            (page) => page.locator('[role="button"]:has-text("Todo")'),
            (page) => page.locator('[role="button"]:has-text("In Progress")'),
            (page) => page.locator('[role="button"]:has-text("Done")'),
            (page) => page.locator('[role="button"]:has-text("Backlog")'),
            (page) => page.locator('button:has-text("Status")'),
        ];
    }
    getNotificationPatterns() {
        return [
            (page) => page.getByRole('button', { name: /notification/i }),
            (page) => page.locator('[aria-label*="notification" i]'),
            (page) => page.locator('[data-testid*="notification" i]'),
            (page) => page.locator('button[class*="notification"], button[class*="bell"]'),
            (page) => page.locator('svg[class*="bell"], svg[class*="notification"]').locator('xpath=ancestor::button[1]'),
            (page) => page.locator('button:has(svg[class*="bell"])'),
            (page) => page.locator('button:has(svg[class*="notification"])'),
            (page) => page.locator('[role="button"]:has-text("notification")'),
        ];
    }
    getSaveButtonPatterns() {
        return [
            (page) => page.getByRole('button', { name: /save|update|apply|confirm/i }),
            (page) => page.locator('button[type="submit"]'),
            (page) => page.locator('button:has-text("Save")'),
            (page) => page.locator('button:has-text("Update")'),
            (page) => page.locator('[aria-label*="save" i]'),
            (page) => page.locator('[data-testid*="save" i]'),
        ];
    }
}
exports.ElementFinder = ElementFinder;
