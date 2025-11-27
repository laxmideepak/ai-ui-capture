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
      // Ensure page is relatively stable before extraction
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);

      const targetSelector = 'button, input, textarea, a, [role="button"], [role="link"], [role="listitem"], [role="menuitem"], [role="textbox"], [contenteditable="true"], [contenteditable], [placeholder], [data-testid], [aria-label]';

      // NOTE: We pass the evaluator logic as a serialized function.
      const domJson = await page.evaluate(this.getBrowserEvaluator(), targetSelector);

      if (!domJson || domJson === '[]' || domJson.length < 10) {
        console.warn('DOM Extractor: Empty or minimal context returned, using fallback.');
        return this.getFallbackDOM(page);
      }

      return domJson;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('DOM Extraction Failed:', message);
      return this.getFallbackDOM(page);
    }
  }

  /**
   * Returns the function to be executed in the browser context.
   * All helper logic must be defined inside this closure to be serialized correctly.
   */
  private getBrowserEvaluator() {
    return (selector: string): string => {
      // --- Browser-side Helpers ---
      
      const isElementVisible = (element: Element, rect: DOMRect): boolean => {
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        );
      };

      const checkInDialog = (element: Element): boolean => {
        let current: Element | null = element;
        while (current) {
          const role = current.getAttribute('role');
          const tag = current.tagName.toLowerCase();
          const isDialog = 
            role === 'dialog' ||
            role === 'alertdialog' ||
            tag === 'dialog' ||
            current.getAttribute('aria-modal') === 'true' ||
            current.classList.contains('modal');

          if (isDialog) return true;
          current = current.parentElement;
        }
        return false;
      };

      // --- Main Extraction Logic ---
      try {
        const elements = Array.from(document.querySelectorAll(selector))
          .slice(0, 80) // Limit to top 80 elements for performance
          .map((el) => {
            try {
              const rect = el.getBoundingClientRect();
              if (!isElementVisible(el, rect)) return null;

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
                inDialog: checkInDialog(el),
                visible: true,
              };
            } catch {
              return null;
            }
          })
          .filter((el): el is DOMElement => el !== null)
          .filter((el) => 
            // Filter out empty noise elements
            Boolean(el.text || el.ariaLabel || el.dataTestId || 
            ['input', 'textarea', 'button'].includes(el.tag))
          );

        return JSON.stringify(elements);
      } catch (err) {
        console.error('Browser-side DOM evaluation error:', err);
        return JSON.stringify([]);
      }
    };
  }

  private async getFallbackDOM(page: Page): Promise<string> {
    try {
      const title = await page.title().catch(() => 'Unknown Page');
      const url = page.url();
      return JSON.stringify([{ tag: 'page', text: title, href: url }]);
    } catch {
      return '[]';
    }
  }
}
