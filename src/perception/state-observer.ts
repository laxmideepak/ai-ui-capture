import { Page } from 'playwright';

interface StateChange {
  type: 'mutation' | 'visual';
  timestamp: number;
  description: string;
  requiresScreenshot: boolean;
}

export class StateObserver {
  private mutationObserver: MutationObserver | null = null;
  private lastScreenshotHash: string = '';
  private changeBuffer: StateChange[] = [];
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor(private page: Page) {}

  /**
   * Setup DOM mutation observer + visual diff checker
   * Triggers screenshot capture on meaningful changes
   */
  async startObserving(onStateChange: (change: StateChange) => Promise<void>): Promise<void> {
    // 1. Setup MutationObserver in browser context
    await this.page.evaluate(() => {
      (window as any).__stateChanges = [];
      
      const observer = new MutationObserver((mutations) => {
        let significantChange = false;
        
        for (const mutation of mutations) {
          // Detect meaningful changes: modals, dialogs, form fields
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1) { // Element node
                const el = node as Element;
                
                // Modal/Dialog appeared
                if (el.getAttribute('role') === 'dialog' || 
                    el.getAttribute('role') === 'alertdialog' ||
                    el.tagName === 'DIALOG') {
                  significantChange = true;
                  (window as any).__stateChanges.push({
                    type: 'mutation',
                    description: 'Modal/Dialog opened',
                    timestamp: Date.now(),
                  });
                }
                
                // Dropdown/Menu appeared
                if (el.getAttribute('role') === 'menu' ||
                    el.getAttribute('role') === 'listbox' ||
                    el.classList.contains('dropdown') ||
                    el.classList.contains('menu')) {
                  significantChange = true;
                  (window as any).__stateChanges.push({
                    type: 'mutation',
                    description: 'Dropdown/Menu opened',
                    timestamp: Date.now(),
                  });
                }

                // Toast/Notification appeared
                if (el.getAttribute('role') === 'alert' ||
                    el.getAttribute('role') === 'status' ||
                    el.classList.contains('toast') ||
                    el.classList.contains('notification')) {
                  significantChange = true;
                  (window as any).__stateChanges.push({
                    type: 'mutation',
                    description: 'Toast/Notification shown',
                    timestamp: Date.now(),
                  });
                }
              }
            });
          }
          
          // Form field value changes (for tracking progress)
          if (mutation.type === 'attributes' && 
              (mutation.attributeName === 'value' || 
               mutation.attributeName === 'aria-checked' ||
               mutation.attributeName === 'aria-selected')) {
            const target = mutation.target as Element;
            if (target.tagName === 'INPUT' || 
                target.tagName === 'TEXTAREA' ||
                target.getAttribute('contenteditable') === 'true') {
              (window as any).__stateChanges.push({
                type: 'mutation',
                description: 'Form field updated',
                timestamp: Date.now(),
              });
            }
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['value', 'aria-checked', 'aria-selected', 'class', 'role'],
      });

      (window as any).__mutationObserver = observer;
    });

    // 2. Poll for changes from browser context
    this.startPolling(onStateChange);
  }

  private async startPolling(onStateChange: (change: StateChange) => Promise<void>): Promise<void> {
    this.pollingInterval = setInterval(async () => {
      const changes = await this.page.evaluate(() => {
        const changes = (window as any).__stateChanges || [];
        (window as any).__stateChanges = []; // Clear buffer
        return changes;
      });

      for (const change of changes) {
        const stateChange: StateChange = {
          ...change,
          requiresScreenshot: this.shouldCaptureScreenshot(change),
        };

        this.changeBuffer.push(stateChange);

        if (stateChange.requiresScreenshot) {
          await onStateChange(stateChange);
        }
      }
    }, 500); // Poll every 500ms
  }

  async stopObserving(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    await this.page.evaluate(() => {
      const observer = (window as any).__mutationObserver;
      if (observer) observer.disconnect();
    });
  }

  private shouldCaptureScreenshot(change: StateChange): boolean {
    // Capture on: modals, dropdowns, toasts, form submissions
    const captureKeywords = ['modal', 'dialog', 'dropdown', 'menu', 'toast', 'notification'];
    return captureKeywords.some(kw => change.description.toLowerCase().includes(kw));
  }

  /**
   * Visual diffing as fallback (expensive, use sparingly)
   */
  async hasVisuallyChanged(): Promise<boolean> {
    const screenshot = await this.page.screenshot({ encoding: 'base64' });
    const hash = this.simpleHash(screenshot as string);
    
    if (hash !== this.lastScreenshotHash) {
      this.lastScreenshotHash = hash;
      return true;
    }
    return false;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }
}

