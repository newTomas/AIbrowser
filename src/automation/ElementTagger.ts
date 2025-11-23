import { Page } from 'playwright';
import { TaggerElement } from '@/types';
import { logger } from '@/cli/Logger';

export class ElementTagger {
  private nextId: number = 1;

  /**
   * Find and tag all interactive elements on the page
   */
  async tagInteractiveElements(page: Page): Promise<TaggerElement[]> {
    try {
      // Reset ID counter for new page
      if (this.nextId === 1 || (await this.pageWasReloaded(page))) {
        this.nextId = 1;
      }

      // Execute in browser context
      const elements = await page.evaluate(() => {
        const foundElements: any[] = [];
        let idCounter = 1;

        // Find elements using selector that matches interactive elements
        const interactiveElements = document.querySelectorAll(`
          button,
          input[type="button"],
          input[type="submit"],
          input[type="reset"],
          a[href],
          select,
          textarea,
          [onclick],
          [onmousedown],
          [onmouseup],
          [tabindex]:not([tabindex="-1"]),
          [role="button"],
          [role="link"],
          [role="menuitem"],
          [role="option"],
          [role="tab"],
          label,
          details,
          summary
        `);

        // Process each element
        interactiveElements.forEach((element: any) => {
          try {
            // Skip if element is hidden
            const style = (window as any).getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return;
            }

            // Skip if element has no size
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) {
              return;
            }

            // Get element information
            const tagName = element.tagName.toLowerCase();
            const role = element.getAttribute('role') || getElementRole(tagName, element);
            const text = getElementText(element);

            // Skip if no meaningful content
            if (!text.trim() && !role) {
              return;
            }

            // Check for existing agent ID
            const existingId = element.getAttribute('data-agent-id');
            if (!existingId) {
              element.setAttribute('data-agent-id', idCounter.toString());
            }

            foundElements.push({
              id: existingId ? parseInt(existingId) : idCounter,
              role: role || tagName,
              text: text.trim(),
              selector: generateSelector(element),
              tab_index: element.tabIndex,
              onclick: element.getAttribute('onclick') || undefined
            });

            if (!existingId) {
              idCounter++;
            }
          } catch (error) {
            console.warn('Error processing element:', error);
          }
        });

        return foundElements;

        // Helper functions
        function getElementRole(tagName: string, element: any): string {
          if (tagName === 'input') return element.type || 'input';
          if (tagName === 'a') return 'link';
          if (tagName === 'button') return 'button';
          if (tagName === 'select') return 'select';
          if (tagName === 'textarea') return 'textarea';
          if (tagName === 'label') return 'label';
          if (tagName === 'details') return 'details';
          if (tagName === 'summary') return 'summary';
          return tagName;
        }

        function getElementText(element: any): string {
          // Handle different element types
          if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            return element.value || element.placeholder || '';
          }
          if (element.tagName === 'SELECT') {
            const selectedOption = element.options[element.selectedIndex];
            return selectedOption ? selectedOption.text : '';
          }
          if (element.tagName === 'BUTTON') {
            return element.textContent?.trim() || element.value || element.title || '';
          }
          if (element.tagName === 'A') {
            return element.textContent?.trim() || element.href || '';
          }

          // For other elements
          return element.getAttribute('aria-label') ||
                 element.getAttribute('title') ||
                 element.textContent?.trim() ||
                 '';
        }

        function generateSelector(element: any): string {
          if (element.id) return `#${element.id}`;

          if (element.className) {
            const classes = element.className.split(' ').filter((c: any) => c.trim());
            if (classes.length > 0) {
              return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
            }
          }

          const dataId = element.getAttribute('data-agent-id');
          if (dataId) return `[data-agent-id="${dataId}"]`;

          return element.tagName.toLowerCase();
        }
      });

      // Update ID counter
      if (elements.length > 0) {
        const maxId = Math.max(...elements.map((el: any) => el.id));
        this.nextId = maxId + 1;
      }

      logger.debug(`Tagged ${elements.length} interactive elements`);
      return elements as TaggerElement[];
    } catch (error) {
      logger.error('Failed to tag interactive elements:', error);
      throw error;
    }
  }

  /**
   * Find element by agent ID
   */
  async findElementById(page: Page, agentId: number): Promise<any> {
    try {
      return await page.evaluateHandle((id) => {
        return document.querySelector(`[data-agent-id="${id}"]`);
      }, agentId);
    } catch (error) {
      logger.error(`Failed to find element with ID ${agentId}:`, error);
      return null;
    }
  }

  /**
   * Get element details by ID
   */
  async getElementDetails(page: Page, agentId: number): Promise<TaggerElement | null> {
    try {
      const elements = await this.tagInteractiveElements(page);
      return elements.find(el => el.id === agentId) || null;
    } catch (error) {
      logger.error(`Failed to get element details for ID ${agentId}:`, error);
      return null;
    }
  }

  /**
   * Check if element is visible and interactable
   */
  async isElementInteractable(page: Page, agentId: number): Promise<boolean> {
    try {
      return await page.evaluate((id) => {
        const element = document.querySelector(`[data-agent-id="${id}"]`);
        if (!element) return false;

        const rect = (element as any).getBoundingClientRect();
        const style = (window as any).getComputedStyle(element);

        return rect.width > 0 &&
               rect.height > 0 &&
               style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               rect.top >= 0 &&
               rect.left >= 0 &&
               rect.bottom <= (window as any).innerHeight &&
               rect.right <= (window as any).innerWidth;
      }, agentId);
    } catch (error) {
      logger.error(`Failed to check interactability for element ${agentId}:`, error);
      return false;
    }
  }

  /**
   * Scroll element into view
   */
  async scrollElementIntoView(page: Page, agentId: number): Promise<void> {
    try {
      await page.evaluate((id) => {
        const element = document.querySelector(`[data-agent-id="${id}"]`);
        if (element) {
          (element as any).scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, agentId);

      await page.waitForTimeout(500);
    } catch (error) {
      logger.error(`Failed to scroll element ${agentId} into view:`, error);
      throw error;
    }
  }

  /**
   * Remove all agent IDs from page
   */
  async clearTags(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        const elements = document.querySelectorAll('[data-agent-id]');
        elements.forEach((element: any) => {
          element.removeAttribute('data-agent-id');
        });
      });
      logger.debug('Cleared all agent tags from page');
    } catch (error) {
      logger.error('Failed to clear tags:', error);
      throw error;
    }
  }

  /**
   * Check if page was reloaded
   */
  private async pageWasReloaded(page: Page): Promise<boolean> {
    try {
      const taggedCount = await page.evaluate(() => {
        return document.querySelectorAll('[data-agent-id]').length;
      });
      return taggedCount === 0;
    } catch {
      return true;
    }
  }

  /**
   * Reset tagger state
   */
  reset(): void {
    this.nextId = 1;
    logger.debug('Element tagger reset');
  }

  /**
   * Get current tag count
   */
  getTagCount(): number {
    return this.nextId - 1;
  }
}