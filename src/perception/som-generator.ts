import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface SoMElement {
  id: number;
  type: 'button' | 'input' | 'link' | 'clickable' | 'editable';
  boundingBox: { x: number; y: number; width: number; height: number };
  text: string;
  role: string;
  placeholder?: string;
  ariaLabel?: string;
  selector: string; // Backup selector for element resolution
}

export class SetOfMarksGenerator {
  constructor(private page: Page) {}

  /**
   * Core SoM Generation: Marks all interactive elements
   * NO hardcoded app-specific logic - uses accessibility tree
   */
  async generate(): Promise<{
    elements: SoMElement[];
    annotatedScreenshot: string;
  }> {
    // 1. Extract all interactive elements from accessibility tree
    const interactiveElements = await this.extractInteractiveElements();

    // 2. Generate unique IDs for each element
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

    // 3. Overlay marks on screenshot
    const screenshot = await this.overlayMarks(markedElements);

    return { elements: markedElements, annotatedScreenshot: screenshot };
  }

  private async extractInteractiveElements(): Promise<any[]> {
    return await this.page.evaluate(() => {
      const elements: any[] = [];
      
      // Query ALL potentially interactive elements using accessibility
      const selectors = [
        'button:not([disabled])',
        'a[href]',
        'input:not([type="hidden"]):not([disabled])',
        'textarea:not([disabled])',
        '[contenteditable="true"]',
        '[role="button"]:not([aria-disabled="true"])',
        '[role="link"]',
        '[role="textbox"]',
        '[role="combobox"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="menuitem"]',
        '[tabindex]:not([tabindex="-1"])',
      ];

      const allElements = document.querySelectorAll(selectors.join(','));
      
      allElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        
        // Only include visible elements
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.top > window.innerHeight || rect.bottom < 0) return;
        if (rect.left > window.innerWidth || rect.right < 0) return;

        const computedStyle = window.getComputedStyle(el);
        if (computedStyle.visibility === 'hidden' || computedStyle.display === 'none') return;
        if (parseFloat(computedStyle.opacity) === 0) return;

        // Generate stable selector (prefer ID, then data attrs, then structure)
        let selector = '';
        if (el.id) {
          selector = `#${el.id}`;
        } else if (el.getAttribute('data-testid')) {
          selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
        } else if (el.getAttribute('aria-label')) {
          selector = `[aria-label="${el.getAttribute('aria-label')}"]`;
        } else {
          // Fallback: tag + nth-of-type
          const parent = el.parentElement;
          const siblings = parent ? Array.from(parent.children).filter(c => c.tagName === el.tagName) : [];
          const index = siblings.indexOf(el as Element);
          selector = `${el.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
        }

        elements.push({
          type: this.categorizeElement(el),
          boundingBox: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          text: el.textContent?.trim().substring(0, 50) || '',
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          placeholder: (el as HTMLInputElement).placeholder || el.getAttribute('placeholder') || undefined,
          ariaLabel: el.getAttribute('aria-label') || undefined,
          selector,
        });
      });

      return elements;

      function categorizeElement(el: Element): string {
        const tag = el.tagName.toLowerCase();
        if (tag === 'button' || el.getAttribute('role') === 'button') return 'button';
        if (tag === 'a' || el.getAttribute('role') === 'link') return 'link';
        if (tag === 'input' || tag === 'textarea' || el.getAttribute('contenteditable') === 'true') return 'input';
        return 'clickable';
      }
    });
  }

  private async overlayMarks(elements: SoMElement[]): Promise<string> {
    // Inject overlay canvas and draw bounding boxes with IDs
    await this.page.evaluate((markedElements) => {
      // Create overlay canvas
      const canvas = document.createElement('canvas');
      canvas.id = 'som-overlay';
      canvas.style.position = 'fixed';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '999999';
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      document.body.appendChild(canvas);
      
      const ctx = canvas.getContext('2d')!;
      ctx.strokeStyle = '#00FF00';
      ctx.fillStyle = '#00FF00';
      ctx.lineWidth = 2;
      ctx.font = 'bold 14px Arial';

      markedElements.forEach((el: any) => {
        const { x, y, width, height } = el.boundingBox;
        
        // Draw box
        ctx.strokeRect(x, y, width, height);
        
        // Draw ID label
        const label = `[${el.id}]`;
        const labelWidth = ctx.measureText(label).width;
        ctx.fillRect(x, y - 18, labelWidth + 6, 18);
        ctx.fillStyle = '#000000';
        ctx.fillText(label, x + 3, y - 4);
        ctx.fillStyle = '#00FF00';
      });
    }, elements);

    // Take screenshot with overlays
    const timestamp = Date.now();
    const screenshotDir = path.join(process.cwd(), 'output', 'screenshots', 'som');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const screenshotPath = path.join(screenshotDir, `som_${timestamp}.png`);
    
    await this.page.screenshot({
      path: screenshotPath,
      fullPage: false,
    });

    // Remove overlay
    await this.page.evaluate(() => {
      const overlay = document.getElementById('som-overlay');
      if (overlay) overlay.remove();
    });

    return screenshotPath as string;
  }
}

export type { SoMElement };
