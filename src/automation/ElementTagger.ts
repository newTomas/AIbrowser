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

      const elements = await page.evaluate(() => {
        // This function runs in the browser context
        const elements: any[] = [];
        let idCounter = 1;

        // Find interactive elements using various selectors
        const selectors = [
          'button',
          'input[type="button"]',
          'input[type="submit"]',
          'input[type="reset"]',
          'a[href]',
          'select',
          'textarea',
          '[onclick]',
          '[onmousedown]',
          '[onmouseup]',
          '[tabindex]:not([tabindex="-1"])',
          '[role="button"]',
          '[role="link"]',
          '[role="menuitem"]',
          '[role="option"]',
          '[role="tab"]',
          'label',
          'details',
          'summary'
        ];

        const foundElements = new Set<Element>();

        selectors.forEach(selector => {
          try {
            const elementsFromSelector = document.querySelectorAll(selector);
            elementsFromSelector.forEach(el => {
              if (el && !foundElements.has(el)) {
                foundElements.add(el);
              }
            });
          } catch (error) {
            console.warn(`Invalid selector: ${selector}`, error);
          }
        });

        // Process each found element
        foundElements.forEach(element => {
          try {
            // Skip if element is hidden or has display:none
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return;
            }

            // Skip if element is outside viewport
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) {
              return;
            }

            // Get element information
            const tagName = element.tagName.toLowerCase();
            const role = element.getAttribute('role') || this.getElementRole(tagName, element);
            const text = this.getElementText(element);
            const selector = this.generateSelector(element);

            // Skip if no meaningful text or role
            if (!text.trim() && !role) {
              return;
            }

            // Check for existing agent ID
            const existingId = element.getAttribute('data-agent-id');
            if (!existingId) {
              // Inject new ID
              element.setAttribute('data-agent-id', idCounter.toString());
            }

            elements.push({
              id: existingId ? parseInt(existingId) : idCounter,
              role: role || tagName,
              text: text.trim(),
              selector: selector,
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

        return elements;

        // Helper functions for browser context
        function getElementRole(tagName: string, element: Element): string {
          if (tagName === 'input') {
            return (element as HTMLInputElement).type || 'input';
          }
          if (tagName === 'a') return 'link';
          if (tagName === 'button') return 'button';
          if (tagName === 'select') return 'select';
          if (tagName === 'textarea') return 'textarea';
          if (tagName === 'label') return 'label';
          if (tagName === 'details') return 'details';
          if (tagName === 'summary') return 'summary';
          return tagName;
        }

        function getElementText(element: Element): string {
          // Try different methods to get meaningful text
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            return element.value || element.placeholder || '';
          }
          if (element instanceof HTMLSelectElement) {
            const selectedOption = element.options[element.selectedIndex];
            return selectedOption ? selectedOption.text : '';
          }
          if (element instanceof HTMLButtonElement) {
            return element.textContent?.trim() || element.value || element.title || '';
          }
          if (element instanceof HTMLAnchorElement) {
            return element.textContent?.trim() || element.href || '';
          }

          // For other elements, use textContent or aria-label
          return element.getAttribute('aria-label') ||
                 element.getAttribute('title') ||
                 element.textContent?.trim() ||
                 '';
        }

        function generateSelector(element: Element): string {
          // Generate a unique CSS selector for the element
          if (element.id) {
            return `#${element.id}`;
          }
          if (element.className) {
            const classes = element.className.split(' ').filter(c => c.trim());
            if (classes.length > 0) {
              return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
            }
          }

          // Generate selector based on data attributes
          const dataId = element.getAttribute('data-agent-id');
          if (dataId) {
            return `[data-agent-id="${dataId}"]`;
          }

          // Fallback to tag name
          return element.tagName.toLowerCase();
        }
      });

      // Update the next ID counter based on found elements
      if (elements.length > 0) {
        const maxId = Math.max(...elements.map(el => el.id));
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
  async findElementById(page: Page, agentId: number): Promise<Element | null> {
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

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        // Check if element is visible and in viewport
        return rect.width > 0 &&
               rect.height > 0 &&
               style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               rect.top >= 0 &&
               rect.left >= 0 &&
               rect.bottom <= window.innerHeight &&
               rect.right <= window.innerWidth;
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
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, agentId);

      // Wait for scroll to complete
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
        elements.forEach(element => {
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
   * Check if page was reloaded (by looking for existing tags)
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