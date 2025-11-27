import { Page } from 'playwright';

interface DOMElement {
  tag: string;
  text: string;
  role: string | null;
  ariaLabel: string;
  placeholder: string;
  href: string;
  type: string;
  contentEditable: string;
  inDialog: boolean;
  x: number;
  y: number;
}

export class DOMExtractor {
  async extract(page: Page): Promise<string> {
    try {
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);

      const selector = 'button, input, textarea, a, [role="button"], [role="link"], [contenteditable="true"], [contenteditable], [placeholder], [data-testid], [aria-label]';

      const domJson = await page.evaluate((sel) => {
        try {
          const elements = Array.from(document.querySelectorAll(sel))
            .slice(0, 80)
            .map((el) => {
              try {
                const rect = el.getBoundingClientRect();
                
                // Check if element is in a dialog/modal
                let inDialog = false;
                let parent: Element | null = el.parentElement;
                while (parent) {
                  const role = parent.getAttribute('role');
                  if (role === 'dialog' || role === 'alertdialog' || parent.getAttribute('aria-modal') === 'true') {
                    inDialog = true;
                    break;
                  }
                  parent = parent.parentElement;
                }

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
            .filter((el): el is DOMElement => el !== null);

          return JSON.stringify(elements);
        } catch (err) {
          console.error('DOM eval error:', err);
          return '[]';
        }
      }, selector);

      if (!domJson || domJson === '[]' || domJson.length < 10) {
        console.warn('Empty DOM context - page may not be loaded');
        const title = await page.title().catch(() => 'Unknown');
        const url = page.url();
        return JSON.stringify([{ tag: 'page', text: title, href: url }]);
      }

      return domJson;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('DOM extraction failed:', message);
      return '[]';
    }
  }
}
