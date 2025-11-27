import { Page } from 'playwright';

export interface StateChange {
  type: string;
  timestamp: number;
  description: string;
  requiresScreenshot: boolean;
}

export class StateObserver {
  private lastScreenshotHash: string = '';
  private changeBuffer: StateChange[] = [];
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(private page: Page) {}

  async startObserving(
    onStateChange: (change: StateChange) => Promise<void>
  ): Promise<void> {
    // Setup MutationObserver in browser - PURE VANILLA JAVASCRIPT
    await this.page.evaluate(function setupObserver() {
      var win = window as any;
      win.__stateChanges = [];

      var observer = new MutationObserver(function handleMutations(mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var mutation = mutations[i];

          if (mutation.type === 'childList') {
            for (var j = 0; j < mutation.addedNodes.length; j++) {
              var node = mutation.addedNodes[j];

              if (node.nodeType === 1) {
                var el = node;
                var role = el.getAttribute('role');

                // Modal/Dialog opened
                if (
                  role === 'dialog' ||
                  role === 'alertdialog' ||
                  el.tagName === 'DIALOG'
                ) {
                  win.__stateChanges.push({
                    type: 'mutation',
                    description: 'Modal opened',
                    timestamp: Date.now(),
                  });
                }

                // Dropdown/Menu opened
                var className = el.className;
                if (typeof className === 'string') {
                  if (
                    role === 'menu' ||
                    role === 'listbox' ||
                    className.indexOf('dropdown') > -1 ||
                    className.indexOf('menu') > -1
                  ) {
                    win.__stateChanges.push({
                      type: 'mutation',
                      description: 'Dropdown opened',
                      timestamp: Date.now(),
                    });
                  }

                  // Toast/Notification
                  if (
                    role === 'alert' ||
                    role === 'status' ||
                    className.indexOf('toast') > -1 ||
                    className.indexOf('notification') > -1
                  ) {
                    win.__stateChanges.push({
                      type: 'mutation',
                      description: 'Toast shown',
                      timestamp: Date.now(),
                    });
                  }
                }
              }
            }
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false,
      });

      win.__mutationObserver = observer;
    });

    // Start polling
    this.startPolling(onStateChange);
  }

  private startPolling(onStateChange: (change: StateChange) => Promise<void>): void {
    this.pollInterval = setInterval(async () => {
      try {
        const changes = await this.page.evaluate(function getStateChanges() {
          var win = window as any;
          var changes = win.__stateChanges || [];
          win.__stateChanges = [];
          return changes;
        });

        for (let i = 0; i < changes.length; i++) {
          const change = changes[i];
          const stateChange: StateChange = {
            type: change.type,
            timestamp: change.timestamp,
            description: change.description,
            requiresScreenshot: this.shouldCaptureScreenshot(change.description),
          };

          this.changeBuffer.push(stateChange);

          if (stateChange.requiresScreenshot) {
            await onStateChange(stateChange);
          }
        }
      } catch (error) {
        // Silent fail on polling errors
      }
    }, 500);
  }

  async stopObserving(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    try {
      await this.page.evaluate(function cleanupObserver() {
        var win = window as any;
        if (win.__mutationObserver) {
          win.__mutationObserver.disconnect();
        }
      });
    } catch {
      // Silent fail
    }
  }

  private shouldCaptureScreenshot(description: string): boolean {
    var keywords = ['Modal', 'modal', 'dialog', 'Dialog', 'Dropdown', 'dropdown'];
    for (var i = 0; i < keywords.length; i++) {
      if (description.indexOf(keywords[i]) > -1) {
        return true;
      }
    }
    return false;
  }
}
