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

      // NOTE: We inline the evaluator logic directly to avoid serialization issues
      // The code inside evaluate() runs in the browser context
      const domJson = await page.evaluate((sel: string): string => {
        try {
          // @ts-expect-error - Browser context
          const elements = Array.from(document.querySelectorAll(sel))
            .slice(0, 80)
            .map((el: any) => {
              try {
                const rect = el.getBoundingClientRect();
                
                // Check if element is in a dialog/modal
                let inDialog = false;
                let parent: any = el.parentElement;
                while (parent) {
                  const role = parent.getAttribute('role');
                  if (role === 'dialog' || role === 'alertdialog' || parent.getAttribute('aria-modal') === 'true') {
                    inDialog = true;
                    break;
                  }
                  parent = parent.parentElement;
                }

                // @ts-expect-error - Browser context
                const style = window.getComputedStyle(el);
                const visible = rect.width > 0 && rect.height > 0 && 
                               style.display !== 'none' && 
                               style.visibility !== 'hidden';

                if (!visible) return null;

                return {
                  tag: el.tagName.toLowerCase(),
                  text: (el.textContent || '').trim().substring(0, 60),
                  role: el.getAttribute('role'),
                  ariaLabel: el.getAttribute('aria-label') || '',
                  placeholder: el.getAttribute('placeholder') || '',
                  href: el.getAttribute('href') || '',
                  type: el.getAttribute('type') || '',
                  contentEditable: el.getAttribute('contenteditable') || '',
                  inDialog,
                  x: Math.round(rect.left),
                  y: Math.round(rect.top),
                };
              } catch {
                return null;
              }
            })
            .filter((el: any) => el !== null);

          return JSON.stringify(elements);
        } catch (err) {
          console.error('DOM eval error:', err);
          return '[]';
        }
      }, targetSelector);

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
