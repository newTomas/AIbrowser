import { Page } from 'playwright';
import { TaggerElement } from '@/types';
import { logger } from '@/cli/Logger';

export class ElementTagger {
  private nextId: number = 1;

  /**
   * Find and tag all interactive elements on the page (including iframes)
   */
  async tagInteractiveElements(page: Page): Promise<TaggerElement[]> {
    try {
      // Reset ID counter for new page
      if (this.nextId === 1 || (await this.pageWasReloaded(page))) {
        this.nextId = 1;
      }

      // Start with current ID counter
      const startId = this.nextId;
      logger.debug(`Starting element tagging with ID ${startId}`);

      // Execute comprehensive element tagging including iframe content
      const result = await page.evaluate((startCounter) => {
        // Helper functions for browser context
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

        function processElementsInDocument(doc: Document, startingId: number, iframePath: string = ''): { elements: any[], nextId: number } {
          const foundElements: any[] = [];
          let idCounter = startingId;

          // Find interactive elements
          const interactiveElements = doc.querySelectorAll(`
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
              // Skip iframes themselves (they're containers, not directly interactive)
              if (element.tagName.toLowerCase() === 'iframe') {
                return;
              }

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
                onclick: element.getAttribute('onclick') || undefined,
                iframe_path: iframePath
              });

              if (!existingId) {
                idCounter++;
              }
            } catch (error) {
              console.warn('Error processing element:', error);
            }
          });

          // Process iframes in this document
          const iframes = doc.querySelectorAll('iframe');
          iframes.forEach((iframe: any, index: number) => {
            try {
              // Try to access iframe content (may fail due to cross-origin restrictions)
              let iframeDoc = null;
              try {
                iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              } catch (e) {
                // Cross-origin iframe - skip content processing
                console.log(`Skipping cross-origin iframe ${index + 1}`);
                return;
              }

              if (iframeDoc) {
                const currentPath = iframePath ? `${iframePath}>iframe${index + 1}` : `iframe${index + 1}`;
                const iframeResult = processElementsInDocument(iframeDoc, idCounter, currentPath);
                foundElements.push(...iframeResult.elements);
                idCounter = iframeResult.nextId;
              }
            } catch (error) {
              console.warn(`Error processing iframe ${index + 1}:`, error);
            }
          });

          return { elements: foundElements, nextId: idCounter };
        }

        // Process the main document and all iframes
        return processElementsInDocument(document, startCounter);

      }, startId);

      // Update the global ID counter with the next available ID
      this.nextId = result.nextId;

      const elements = result.elements as TaggerElement[];
      logger.debug(`Tagged ${elements.length} interactive elements (including iframe content). Next ID will be ${this.nextId}`);

      return elements;
    } catch (error) {
      logger.error('Failed to tag interactive elements:', error);
      throw error;
    }
  }

  /**
   * Find element by agent ID (including iframe elements)
   */
  async findElementById(page: Page, agentId: number): Promise<any> {
    try {
      return await page.evaluateHandle((id) => {
        // Search in main document first
        let element = document.querySelector(`[data-agent-id="${id}"]`);

        // If not found, search in all accessible iframes
        if (!element) {
          const iframes = document.querySelectorAll('iframe');
          for (let i = 0; i < iframes.length; i++) {
            const iframe = iframes[i];
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (iframeDoc) {
                element = iframeDoc.querySelector(`[data-agent-id="${id}"]`);
                if (element) break;
              }
            } catch (e) {
              // Cross-origin iframe - skip
              continue;
            }
          }
        }

        return element;
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
        // Function to check visibility in a document
        function checkVisibility(doc: Document): boolean {
          const element = doc.querySelector(`[data-agent-id="${id}"]`);
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
        }

        // Check main document first
        if (checkVisibility(document)) {
          return true;
        }

        // Check all accessible iframes
        const iframes = document.querySelectorAll('iframe');
        for (let i = 0; i < iframes.length; i++) {
          const iframe = iframes[i];
          try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc) {
              // Create a temporary checkVisibility function for iframe context
              const result = (function() {
                const element = iframeDoc!.querySelector(`[data-agent-id="${id}"]`);
                if (!element) return false;

                const rect = element.getBoundingClientRect();
                const style = iframe.contentWindow!.getComputedStyle(element);

                return rect.width > 0 &&
                       rect.height > 0 &&
                       style.display !== 'none' &&
                       style.visibility !== 'hidden';
              })();

              if (result) return true;
            }
          } catch (e) {
            // Cross-origin iframe - skip
            continue;
          }
        }

        return false;
      }, agentId);
    } catch (error) {
      logger.error(`Failed to check interactability for element ${agentId}:`, error);
      return false;
    }
  }

  /**
   * Scroll element into view (including iframe elements)
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
   * Remove all agent IDs from page (including iframes)
   */
  async clearTags(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        // Clear tags from main document
        const elements = document.querySelectorAll('[data-agent-id]');
        elements.forEach((element: any) => {
          element.removeAttribute('data-agent-id');
        });

        // Clear tags from all accessible iframes
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach((iframe: any) => {
          try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc) {
              const iframeElements = iframeDoc.querySelectorAll('[data-agent-id]');
              iframeElements.forEach((element: any) => {
                element.removeAttribute('data-agent-id');
              });
            }
          } catch (e) {
            // Cross-origin iframe - skip
          }
        });
      });
      logger.debug('Cleared all agent tags from page and iframes');
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