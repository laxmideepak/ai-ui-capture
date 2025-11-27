import { Locator, Page } from 'playwright';
import type { SoMElement } from '../perception/som-generator';

export class UniversalElementResolver {
  constructor(
    private page: Page,
    private somElements: SoMElement[]
  ) {}

  /**
   * Resolve element by SoM ID (from GPT-4V decision)
   * NO app-specific logic - purely ID-based
   */
  async resolveByID(somId: number): Promise<Locator | null> {
    const element = this.somElements.find(el => el.id === somId);
    if (!element) {
      console.error(`SoM element ${somId} not found in map`);
      return null;
    }

    console.log(`Resolving SoM [${somId}]: ${element.text || element.role}`);

    // Strategy 1: Use stored selector (most reliable)
    try {
      const locator = this.page.locator(element.selector);
      if (await this.isVisible(locator)) {
        console.log(`✓ Resolved via selector: ${element.selector}`);
        return locator.first();
      }
    } catch (err) {
      console.warn(`Selector failed: ${element.selector}`);
    }

    // Strategy 2: Coordinate-based click (last resort)
    console.log(`⚠️ Falling back to coordinate click for [${somId}]`);
    const { x, y, width, height } = element.boundingBox;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    
    await this.page.mouse.click(centerX, centerY);
    return this.page.locator('body'); // Return valid locator
  }

  /**
   * Fallback: Natural language resolution using accessibility tree
   */
  async resolveByDescription(description: string): Promise<Locator | null> {
    // Use accessibility tree roles + text content
    const candidates = this.somElements.filter(el => {
      const searchText = `${el.text} ${el.ariaLabel} ${el.placeholder}`.toLowerCase();
      return searchText.includes(description.toLowerCase());
    });

    if (candidates.length === 0) return null;

    // Return first match
    return this.resolveByID(candidates[0].id);
  }

  private async isVisible(locator: Locator): Promise<boolean> {
    try {
      return await locator.first().isVisible({ timeout: 1000 });
    } catch {
      return false;
    }
  }
}

