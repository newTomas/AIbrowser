import { Page, JSHandle } from 'playwright';
import { TaggerElement, DOMElement } from '@/types';
import { logger } from '@/cli/Logger';
import DOMPurify from 'dompurify';

export class ElementTagger {
  private nextId: number = 1;

  /**
   * Sanitize text content on Node.js side to prevent XSS
   */
  private sanitizeNodeText(text: string): string {
    try {
      // Remove HTML tags using a simple regex as fallback
      // This is basic protection since most XSS risks come from DOM manipulation
      return text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<[^>]*>/g, '')
                .trim();
    } catch (error) {
      // Return empty string if sanitization fails
      return '';
    }
  }

  /**
   * Find and tag all interactive elements on the page (including iframes)
   */
  async tagInteractiveElements(page: Page): Promise<TaggerElement[]> {
    try {
      // Always clean up stale IDs and reset for consistent element identification
      this.nextId = 1;
      await this.cleanupStaleIds(page);

      // Start with current ID counter
      const startId = this.nextId;
      logger.debug(`Starting element tagging with ID ${startId}`);

      // Execute comprehensive element tagging including iframe content
      const result = await page.evaluate((startCounter) => {
        // Sanitization function for browser context
        function sanitizeText(text: string): string {
          try {
            // Create a temporary element to extract safe text content
            const tempDiv = document.createElement('div');
            tempDiv.textContent = text; // This automatically escapes HTML
            return tempDiv.innerHTML || '';
          } catch (error) {
            // Fallback to basic HTML tag removal
            return text.replace(/<[^>]*>/g, '').trim();
          }
        }

        // Helper functions for browser context
        function getElementRole(tagName: string, element: DOMElement): string {
          if (tagName === 'input') return 'input';
          if (tagName === 'a') return 'link';
          if (tagName === 'button') return 'button';
          if (tagName === 'select') return 'select';
          if (tagName === 'textarea') return 'textarea';
          if (tagName === 'label') return 'label';
          if (tagName === 'details') return 'details';
          if (tagName === 'summary') return 'summary';
          return tagName;
        }

        function getElementText(element: DOMElement): string {
          // Priority: 1. Element content, 2. Placeholder, 3. Value (for input button), 4. title, 5. aria-label, 6. name, 7. empty string

          // Get text only from visible child nodes
          const getVisibleText = (el: any): string => {
            let text = '';
            for (const child of el.childNodes || []) {
              if (child.nodeType === 3) { // TEXT_NODE
                text += child.textContent || '';
              } else if (child.nodeType === 1) { // ELEMENT_NODE
                const childEl = child;
                const style = window.getComputedStyle(childEl);
                // Only include text from visible elements
                if (style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0' &&
                    !childEl.hasAttribute('hidden')) {
                  text += getVisibleText(childEl);
                }
              }
            }
            return text.trim();
          };

          const textContent = sanitizeText(getVisibleText(element) || '');
          const placeholder = sanitizeText(element.placeholder || '');
          const title = sanitizeText(element.getAttribute('title') || '');
          const ariaLabel = sanitizeText(element.getAttribute('aria-label') || '');
          const name = sanitizeText(element.name || '');

          // Special case for input[type="button"] and input[type="submit"]
          if (element.tagName === 'INPUT' && (element.type === 'button' || element.type === 'submit')) {
            return textContent || sanitizeText(element.value || '') || placeholder || title || ariaLabel || name || '';
          }

          // Special case for button elements - also try innerText and title
          if (element.tagName === 'BUTTON') {
            return textContent || sanitizeText(element.innerText?.trim() || '') || title || ariaLabel || name || '';
          }

          // General case - text content has highest priority
          if (textContent) return textContent;

          // For input/textarea elements, use placeholder, then name as last resort
          if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            return placeholder || title || ariaLabel || name || '';
          }

          // For other elements, try title, aria-label, name then empty string
          return title || ariaLabel || name || '';
        }

        function getElementValue(element: DOMElement): string | number | boolean {
          if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            const inputType = element.type || 'text';

            // For radio and checkbox, return checked status
            if (inputType === 'radio' || inputType === 'checkbox') {
              return element.checked || false;
            }

            // For number input, return number if possible
            if (inputType === 'number' && element.value !== '') {
              const numValue = parseFloat(element.value || '');
              return isNaN(numValue) ? element.value || '' : numValue;
            }

            // For input button, return value attribute
            if (inputType === 'button') {
              return element.value || '';
            }

            // For other inputs, return current value
            return element.value || '';
          }

          if (element.tagName === 'SELECT') {
            if (element.options && element.selectedIndex !== undefined && element.selectedIndex >= 0) {
              const selectedOption = element.options[element.selectedIndex];
              return selectedOption ? selectedOption.value : '';
            }
            return '';
          }

          if (element.tagName === 'A') {
            return element.getAttribute('href') || '';
          }

          return '';
        }

        function getInputType(element: DOMElement): string | undefined {
          if (element.tagName === 'INPUT') {
            // Priority: inputmode attribute over type attribute
            // inputmode provides better semantic meaning for mobile keyboards
            const inputMode = element.getAttribute('inputmode');
            if (inputMode) {
              return inputMode;
            }

            // Fallback to type attribute
            return element.type || 'text';
          }
          if (element.tagName === 'TEXTAREA') {
            return 'textarea';
          }
          if (element.tagName === 'SELECT') {
            return 'select';
          }
          if (element.tagName === 'BUTTON') {
            return 'button';
          }
          return undefined;
        }

        function getInputGroup(element: DOMElement): string | undefined {
          if (element.tagName === 'INPUT' && (element.type === 'radio' || element.type === 'checkbox')) {
            return element.name || undefined;
          }
          return undefined;
        }

        function generateSelector(element: DOMElement): string {
          if (element.id) return `#${element.id}`;
          if (element.className) {
            const classes = element.className.split(' ').filter((c: string) => c.trim());
            if (classes.length > 0) {
              return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
            }
          }
          const dataId = element.getAttribute('data-agent-id');
          if (dataId) return `[data-agent-id="${dataId}"]`;
          return element.tagName.toLowerCase();
        }

        function processElementsInDocument(doc: Document, startingId: number, iframePath: string = ''): { elements: TaggerElement[], nextId: number } {
          const foundElements: TaggerElement[] = [];
          let idCounter = startingId;

          // Find interactive elements - expanded selector for better coverage
          const interactiveElements = doc.querySelectorAll(`
            button,
            input:not([type="hidden"]),
            a[href],
            select,
            textarea,
            [onclick],
            [onmousedown],
            [onmouseup],
            [onchange],
            [oninput],
            [tabindex]:not([tabindex="-1"]),
            [role="button"],
            [role="link"],
            [role="menuitem"],
            [role="option"],
            [role="tab"],
            [role="textbox"],
            [role="combobox"],
            [role="searchbox"],
            label,
            details,
            summary
          `);

          console.log(`[ElementTagger] Found ${interactiveElements.length} elements by selector`);
          const inputCount = doc.querySelectorAll('input:not([type="hidden"])').length;
          console.log(`[ElementTagger] Found ${inputCount} input elements total`);

          // Log details of first few input elements
          const allInputs = doc.querySelectorAll('input:not([type="hidden"])');
          console.log(`[ElementTagger] Input elements details:`);
          for (let i = 0; i < Math.min(5, allInputs.length); i++) {
            const input = allInputs[i] as any;
            const inputType = getInputType(input);
            console.log(`  Input ${i}: type="${input.type}", input_type="${inputType}", name="${input.name || ''}", id="${input.id || ''}", className="${input.className || ''}"`);
          }

          // Process each element
          interactiveElements.forEach((element) => {
          const domElement = element as unknown as DOMElement;
            try {
              // Get element information first
              const tagName = domElement.tagName.toLowerCase();

              // Skip iframes themselves (they're containers, not directly interactive)
              if (tagName === 'iframe') {
                return;
              }

              // Skip if element is hidden
              const style = (window as any).getComputedStyle(element);
              if (style.display === 'none' ||
                  style.visibility === 'hidden' ||
                  style.opacity === '0' ||
                  element.hasAttribute('hidden') ||
                  (element as HTMLElement).offsetParent === null) {
                return;
              }

              // Skip if element has no size (with error handling)
              try {
                const rect = domElement.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) {
                  console.log(`[ElementTagger] Skipping element with no size: ${tagName}, rect: ${rect.width}x${rect.height}`);
                  return;
                }
              } catch (error) {
                console.warn(`[ElementTagger] Error checking element size: ${(error as Error).message}`);
                // Continue processing if we can't check size
              }
              const role = domElement.getAttribute('role') || getElementRole(tagName, domElement);
              const text = getElementText(domElement);

              // Debug log for input elements processing
              if (tagName === 'input') {
                console.log(`[ElementTagger] Processing input element: type="${domElement.type}", name="${domElement.name || ''}", id="${domElement.id || ''}", hasValue="${domElement.value !== ''}", text="${text}"`);
              }

              // Include all interactive elements, even if no text (important for inputs)
              if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
                // Always include form elements
              } else if (!text.trim() && !role) {
                // Skip other elements without content
                console.log(`[ElementTagger] Skipping element without content: ${tagName}, text: "${text}", role: "${role}"`);
                return;
              }

              // Check for existing agent ID
              const existingId = domElement.getAttribute('data-agent-id');
              if (!existingId) {
                domElement.setAttribute('data-agent-id', idCounter.toString());
              }

              const elementData: TaggerElement = {
                id: existingId ? parseInt(existingId) : idCounter,
                role: role || tagName,
                value: getElementValue(domElement),
                input_type: getInputType(domElement),
                input_group: getInputGroup(domElement),
                text: text.trim()
              };

              // Always log all found elements for debugging
              console.log(`[ElementTagger] Found element: ID=${elementData.id}, role="${elementData.role}", text="${elementData.text}", value="${elementData.value}", input_type="${elementData.input_type}"`);

              // Elements without text or value are now normal (e.g., SVG buttons)

              foundElements.push(elementData);

              if (!existingId) {
                idCounter++;
              }
            } catch (error) {
              console.warn('Error processing element:', error);
            }
          });

          // Process iframes in this document
          const iframes = doc.querySelectorAll('iframe');
          iframes.forEach((iframe: HTMLIFrameElement, index: number) => {
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

          // Final statistics
          console.log(`[ElementTagger] Processing complete. Final count: ${foundElements.length} elements`);

          // Count by role in final array
          const finalStats: { [key: string]: number } = {};
          const inputTypeStats: { [key: string]: number } = {};

          foundElements.forEach(el => {
            const key = el.role;
            finalStats[key] = (finalStats[key] || 0) + 1;

            // Detailed input type statistics
            if (el.role === 'input' && el.input_type) {
              const inputKey = `input_${el.input_type}`;
              inputTypeStats[inputKey] = (inputTypeStats[inputKey] || 0) + 1;
            }
          });

          console.log(`[ElementTagger] Final element counts by role:`, finalStats);
          if (Object.keys(inputTypeStats).length > 0) {
            console.log(`[ElementTagger] Input elements by type:`, inputTypeStats);
          }

          return { elements: foundElements, nextId: idCounter };
        }

        // Process the main document and all iframes
        const result = processElementsInDocument(document, startCounter);

        // Debug: Count element types
        const elementCounts: { [key: string]: number } = {};
        result.elements.forEach((el: TaggerElement) => {
          const key = el.role || 'unknown';
          elementCounts[key] = (elementCounts[key] || 0) + 1;
        });
        console.log('[ElementTagger] Element type counts:', elementCounts);
        console.log('[ElementTagger] Total elements found:', result.elements.length);

        return {
          elements: result.elements,
          nextId: result.nextId
        };

      }, startId);

      // Update the global ID counter with the next available ID
      this.nextId = result.nextId;

      // Apply Node.js side sanitization to all elements
      const elements = result.elements.map((el: TaggerElement) => ({
        ...el,
        text: this.sanitizeNodeText(el.text || ''),
        value: typeof el.value === 'string' ? this.sanitizeNodeText(el.value) : el.value
      })) as TaggerElement[];

      // Add detailed logging for element types
      const inputCount = elements.filter(el => el.input_type && el.input_type !== 'button' && el.input_type !== 'submit').length;
      const buttonCount = elements.filter(el => el.role === 'button' || el.input_type === 'button').length;
      const linkCount = elements.filter(el => el.role === 'a' || el.role === 'link').length;

      logger.debug(`Tagged ${elements.length} interactive elements: ${inputCount} inputs, ${buttonCount} buttons, ${linkCount} links. Next ID will be ${this.nextId}`);

      
      return elements;
    } catch (error) {
      logger.error('Failed to tag interactive elements:', error);
      throw error;
    }
  }

  /**
   * Find element by agent ID (including iframe elements)
   */
  async findElementById(page: Page, agentId: number): Promise<JSHandle | null> {
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
        elements.forEach((element) => {
          const domElement = element as unknown as DOMElement;
          domElement.removeAttribute('data-agent-id');
        });

        // Clear tags from all accessible iframes
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach((iframe: HTMLIFrameElement) => {
          try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc) {
              const iframeElements = iframeDoc.querySelectorAll('[data-agent-id]');
              iframeElements.forEach((element) => {
                const domElement = element as unknown as DOMElement;
                domElement.removeAttribute('data-agent-id');
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
   * Clean up stale agent IDs from previous sessions
   */
  private async cleanupStaleIds(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        // Remove all data-agent-id attributes from the page
        const elements = document.querySelectorAll('[data-agent-id]');
        elements.forEach(el => el.removeAttribute('data-agent-id'));
      });
      logger.debug('Cleaned up stale agent IDs');
    } catch (error) {
      logger.warning('Failed to cleanup stale IDs:', error);
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