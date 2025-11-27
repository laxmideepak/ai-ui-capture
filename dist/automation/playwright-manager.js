"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaywrightManager = void 0;
const playwright_1 = require("playwright");
const config_1 = require("../utils/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const element_finder_1 = require("./element-finder");
const action_executor_1 = require("./action-executor");
const session_manager_1 = require("./session-manager");
const dom_extractor_1 = require("./dom-extractor");
class PlaywrightManager {
    browser = null;
    context = null;
    page = null;
    lastIssueTitle = null;
    isClosing = false;
    elementFinder;
    actionExecutor;
    sessionManager;
    domExtractor;
    async initialize() {
        const authPath = path_1.default.resolve(process.cwd(), config_1.config.paths.auth);
        const hasAuth = fs_1.default.existsSync(authPath) && fs_1.default.readFileSync(authPath, 'utf-8').trim().length > 0;
        if (hasAuth) {
            console.log('Loading saved session...');
        }
        this.browser = await playwright_1.chromium.launch({
            headless: config_1.config.browser.headless,
            slowMo: config_1.config.browser.slowMo,
        });
        this.context = await this.browser.newContext({
            viewport: config_1.config.browser.viewport,
            storageState: hasAuth ? authPath : undefined,
        });
        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(config_1.config.browser.timeout);
        this.setupEventHandlers();
        this.initializeHelpers();
        return this.page;
    }
    setupEventHandlers() {
        if (!this.page)
            return;
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
    initializeHelpers() {
        this.elementFinder = new element_finder_1.ElementFinder(this.page, this);
        this.actionExecutor = new action_executor_1.ActionExecutor(this.page, this.elementFinder, this);
        this.sessionManager = new session_manager_1.SessionManager();
        this.domExtractor = new dom_extractor_1.DOMExtractor();
    }
    getCurrentUrl() {
        return this.page?.url() || '';
    }
    async navigate(url) {
        this.ensurePage();
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        await this.waitForStable();
        const hasAuthError = await this.page
            .locator('text=/authentication error|don\'t have access|workspace admin/i')
            .isVisible()
            .catch(() => false);
        if (hasAuthError) {
            const errorText = await this.page
                .locator('text=/authentication error|don\'t have access/i')
                .first()
                .textContent()
                .catch(() => '');
            console.error(`Authentication error: ${errorText}`);
            console.error('You don\'t have access to this workspace. Please use a workspace you have access to.');
            throw new Error(`Authentication error: ${errorText}`);
        }
    }
    async isLoggedIn() {
        this.ensurePage();
        return this.sessionManager.isLoggedIn(this.page);
    }
    async saveSession() {
        if (!this.context)
            return;
        await this.sessionManager.saveSession(this.context);
    }
    async close() {
        this.isClosing = true;
        try {
            await this.saveSession();
            await this.page?.close();
            await this.context?.close();
            await this.browser?.close();
            console.log('Browser closed');
        }
        catch {
            // Suppress errors during cleanup
        }
    }
    async screenshot(filepath) {
        this.ensurePage();
        try {
            await this.page.waitForTimeout(400);
            await this.page.screenshot({
                path: filepath,
                fullPage: false,
                animations: 'disabled',
            });
            console.log(`Screenshot: ${filepath}`);
        }
        catch {
            console.error('Screenshot failed');
        }
    }
    async getSimplifiedDOM() {
        this.ensurePage();
        return this.domExtractor.extract(this.page);
    }
    async captureStateWithMetadata(step, taskName) {
        this.ensurePage();
        const dir = `output/screenshots/${taskName}`;
        const screenshotPath = `${dir}/step_${String(step).padStart(3, '0')}.png`;
        const metadataPath = screenshotPath.replace('.png', '_meta.json');
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        await this.screenshot(screenshotPath);
        try {
            const metadata = {
                step,
                url: this.page.url(),
                timestamp: new Date().toISOString(),
                title: await this.page.title(),
            };
            fs_1.default.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        }
        catch {
            // Metadata save is non-critical
        }
    }
    async executeAction(action, retries = 2) {
        this.ensurePage();
        return this.actionExecutor.execute(action, retries);
    }
    async waitForStable(ms = 3000) {
        if (!this.page)
            return;
        try {
            await this.page.waitForLoadState('networkidle', { timeout: ms });
        }
        catch {
            // SPAs often don't reach networkidle - not an error
        }
        await this.page.waitForTimeout(600);
    }
    getLastIssueTitle() {
        return this.lastIssueTitle;
    }
    setLastIssueTitle(title) {
        this.lastIssueTitle = title;
    }
    ensurePage() {
        if (!this.page || this.page.isClosed()) {
            throw new Error('Page not initialized');
        }
    }
}
exports.PlaywrightManager = PlaywrightManager;
