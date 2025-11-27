import { Page } from 'playwright';

interface DOMElement {
  tag: string;
  text: string;
  role: string | null;
  ariaLabel: string;
  placeholder: string;
  href: string;
  type: string;
  dataTestId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  inDialog: boolean;
  visible: boolean;
}

export class DOMExtractor {
  async extract(page: Page): Promise<string> {
    try {
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);

      const selector =
        'button, input, textarea, a, [role="button"], [role="link"], [role="listitem"], [role="menuitem"], [role="textbox"], [contenteditable="true"], [contenteditable], [placeholder], [data-testid], [aria-label]';

      const domJson = await page.evaluate(this.createEvaluator(), selector);

      if (!domJson || domJson === '[]' || domJson.length < 10) {
        console.warn('Empty DOM context returned');
        return this.getFallbackDOM(page);
      }

      return domJson;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('DOM extraction failed:', message);
      return this.getFallbackDOM(page);
    }
  }

  private createEvaluator() {
    return (selector: string): string => {
      try {
        // @ts-expect-error - document is available in browser context
        const doc = document;
        // @ts-expect-error - window is available in browser context
        const win = window;
        const elements = Array.from(doc.querySelectorAll(selector))
          .slice(0, 80)
          .map((el: any) => {
            try {
              const rect = el.getBoundingClientRect();

              const inDialog = this.isInDialog(el);
              const visible = this.isElementVisible(el, rect);

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
          .filter((el): el is DOMElement => el !== null)
          .filter(
            (el) =>
              el.text ||
              el.ariaLabel ||
              el.dataTestId ||
              el.tag === 'input' ||
              el.tag === 'textarea' ||
              el.tag === 'button'
          );

        return JSON.stringify(elements);
      } catch (err) {
        console.error('DOM eval error:', err);
        return JSON.stringify([]);
      }
    };
  }

  private isInDialog(element: any): boolean {
    let current: any = element;
    while (current) {
      const role = current.getAttribute('role');
      const tag = current.tagName.toLowerCase();
      if (
        role === 'dialog' ||
        role === 'alertdialog' ||
        tag === 'dialog' ||
        current.getAttribute('aria-modal') === 'true' ||
        current.classList.contains('modal')
      ) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  private isElementVisible(element: any, rect: any): boolean {
    // @ts-expect-error - window is available in browser context
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  private async getFallbackDOM(page: Page): Promise<string> {
    try {
      const title = await page.title().catch(() => 'Unknown');
      const url = page.url();
      return JSON.stringify([{ tag: 'page', text: title, href: url }]);
    } catch {
      return '[]';
    }
  }
}

