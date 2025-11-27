import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface SoMElement {
  id: number;
  type: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  text: string;
  role: string;
  placeholder: string;
  ariaLabel: string;
  selector: string;
}

export class SetOfMarksGenerator {
  constructor(private page: Page) {}

  async generate(): Promise<{
    elements: SoMElement[];
    annotatedScreenshot: string;
  }> {
    try {
      const interactiveElements = await this.extractInteractiveElements();
      const markedElements: SoMElement[] = [];

      for (let i = 0; i < interactiveElements.length; i++) {
        const el = interactiveElements[i];
        markedElements.push({
          id: i + 1,
          type: el.type,
          boundingBox: el.boundingBox,
          text: el.text || '',
          role: el.role,
          placeholder: el.placeholder,
          ariaLabel: el.ariaLabel,
          selector: el.selector,
        });
      }

      const timestamp = Date.now();
      const screenshotDir = path.join(process.cwd(), 'output', 'screenshots', 'som');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      const screenshotPath = path.join(screenshotDir, 'som_' + timestamp + '.png');

      await this.page.screenshot({
        path: screenshotPath,
        fullPage: false,
      });

      console.log('✓ SoM generated: ' + markedElements.length + ' elements');
      return { elements: markedElements, annotatedScreenshot: screenshotPath };
    } catch (error) {
      console.warn('⚠️ SoM generation failed, using regular screenshot');
      const timestamp = Date.now();
      const screenshotDir = path.join(process.cwd(), 'output', 'screenshots', 'som');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      const screenshotPath = path.join(screenshotDir, 'fallback_' + timestamp + '.png');

      try {
        await this.page.screenshot({
          path: screenshotPath,
          fullPage: false,
        });
      } catch {
        // Silent fail
      }

      return { elements: [], annotatedScreenshot: screenshotPath };
    }
  }

  private async extractInteractiveElements(): Promise<any[]> {
    // PURE VANILLA JAVASCRIPT - No arrow functions, no template literals
    return await this.page.evaluate(function extractElements() {
      var elements = [];
      var selectors = [
        'button:not([disabled])',
        'a[href]',
        'input:not([type="hidden"]):not([disabled])',
        'textarea:not([disabled])',
        '[contenteditable="true"]',
        '[role="button"]:not([aria-disabled="true"])',
        '[role="link"]',
        '[role="textbox"]',
        '[role="combobox"]',
        '[tabindex]:not([tabindex="-1"])',
      ];

      var selectorString = selectors.join(',');
      var allElements = document.querySelectorAll(selectorString);

      for (var i = 0; i < allElements.length; i++) {
        var el = allElements[i];
        var rect = el.getBoundingClientRect();

        // Visibility checks
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.top > window.innerHeight || rect.bottom < 0) continue;
        if (rect.left > window.innerWidth || rect.right < 0) continue;

        var computedStyle = window.getComputedStyle(el);
        if (computedStyle.visibility === 'hidden' || computedStyle.display === 'none') continue;
        var opacity = parseFloat(computedStyle.opacity);
        if (opacity === 0) continue;

        // Determine element type
        var type = 'clickable';
        var tag = el.tagName.toLowerCase();
        var role = el.getAttribute('role');

        if (tag === 'button' || role === 'button') {
          type = 'button';
        } else if (tag === 'a' || role === 'link') {
          type = 'link';
        } else if (tag === 'input' || tag === 'textarea' || el.getAttribute('contenteditable') === 'true') {
          type = 'input';
        }

        // Generate selector
        var selector = '';
        if (el.id) {
          selector = '#' + el.id;
        } else if (el.getAttribute('data-testid')) {
          selector = '[data-testid="' + el.getAttribute('data-testid') + '"]';
        } else if (el.getAttribute('aria-label')) {
          selector = '[aria-label="' + el.getAttribute('aria-label') + '"]';
        } else {
          selector = tag;
        }

        // Get text content
        var textContent = el.textContent;
        var text = '';
        if (textContent) {
          text = textContent.trim();
          if (text.length > 50) {
            text = text.substring(0, 50);
          }
        }

        // Get placeholder
        var placeholder = '';
        if (el.placeholder) {
          placeholder = el.placeholder;
        } else if (el.getAttribute('placeholder')) {
          placeholder = el.getAttribute('placeholder');
        }

        // Get aria-label
        var ariaLabel = el.getAttribute('aria-label');
        if (!ariaLabel) {
          ariaLabel = '';
        }

        elements.push({
          type: type,
          boundingBox: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          text: text,
          role: role || tag,
          placeholder: placeholder,
          ariaLabel: ariaLabel,
          selector: selector,
        });
      }

      return elements;
    });
  }
}

export type { SoMElement };
