import { Page } from 'playwright';
import { TaggerElement } from '@/types';
import { BrowserManager } from './BrowserManager';
import { ElementTagger } from './ElementTagger';
import { logger } from '@/cli/Logger';

export class PageActions {
  private browserManager: BrowserManager;
  private elementTagger: ElementTagger;

  constructor(browserManager: BrowserManager, elementTagger: ElementTagger) {
    this.browserManager = browserManager;
    this.elementTagger = elementTagger;
  }

  /**
   * Click element by agent ID
   */
  async clickElement(pageId: number, elementId: number): Promise<void> {
    try {
      const page = this.browserManager.getPage(pageId);
      if (!page) {
        throw new Error(`Page with ID ${pageId} not found`);
      }

      // Check if element is interactable
      const isInteractable = await this.elementTagger.isElementInteractable(page, elementId);
      if (!isInteractable) {
        // Try to scroll into view first
        await this.elementTagger.scrollElementIntoView(page, elementId);

        // Check again
        const stillInteractable = await this.elementTagger.isElementInteractable(page, elementId);
        if (!stillInteractable) {
          throw new Error(`Element ${elementId} is not interactable`);
        }
      }

      // Click the element
      await page.click(`[data-agent-id="${elementId}"]`, {
        timeout: 10000,
        force: false
      });

      // Wait a bit for any navigation or state change
      await page.waitForTimeout(1000);

      logger.info(`Clicked element ${elementId} on page ${pageId}`);
    } catch (error) {
      logger.error(`Failed to click element ${elementId} on page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Type text into input field by agent ID
   */
  async typeText(pageId: number, elementId: number, text: string): Promise<void> {
    try {
      const page = this.browserManager.getPage(pageId);
      if (!page) {
        throw new Error(`Page with ID ${pageId} not found`);
      }

      // Get element details to validate it's an input
      const elementDetails = await this.elementTagger.getElementDetails(page, elementId);
      if (!elementDetails) {
        throw new Error(`Element ${elementId} not found`);
      }

      // Enhanced validation for text input compatibility
      const unsupportedRoles = ['label', 'button', 'link', 'a', 'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
      const supportedRoles = ['input', 'textarea', 'search', 'email', 'password', 'tel', 'url'];

      // Check if element role is explicitly unsupported
      if (unsupportedRoles.includes(elementDetails.role)) {
        throw new Error(`Cannot type text into element ${elementId}: elements with role '${elementDetails.role}' do not support text input. Use click_element for buttons, copy_text for links, or find the associated input field.`);
      }

      // Check if element role is supported
      if (!supportedRoles.includes(elementDetails.role) &&
          !elementDetails.role.includes('input') &&
          !elementDetails.role.includes('text') &&
          !elementDetails.role.includes('search')) {
        throw new Error(`Element ${elementId} with role '${elementDetails.role}' does not support text input. Supported roles: ${supportedRoles.join(', ')}`);
      }

      // Additional check: If element text suggests it's not an input field
      const text = elementDetails.text.toLowerCase();
      if (text.includes('click') || text.includes('button') || text.includes('submit') || text.includes('copy')) {
        throw new Error(`Element ${elementId} appears to be a button/clickable element based on text "${elementDetails.text}". Use click_element instead of type_text.`);
      }

      logger.debug(`Validated element ${elementId}: role="${elementDetails.role}", text="${elementDetails.text}" - OK for text input`);

      // Scroll element into view and ensure it's interactable
      await this.elementTagger.scrollElementIntoView(page, elementId);
      const isInteractable = await this.elementTagger.isElementInteractable(page, elementId);
      if (!isInteractable) {
        throw new Error(`Element ${elementId} is not interactable`);
      }

      // Focus the element and clear existing content
      await page.focus(`[data-agent-id="${elementId}"]`);
      await page.fill(`[data-agent-id="${elementId}"]`, '', { timeout: 5000 });

      // Type the text
      await page.type(`[data-agent-id="${elementId}"]`, text, {
        delay: 100 // Small delay between keystrokes for more natural typing
      });

      // Wait a bit for any validation or state change
      await page.waitForTimeout(500);

      logger.info(`Typed text into element ${elementId} on page ${pageId}: "${text}"`);
    } catch (error) {
      logger.error(`Failed to type text into element ${elementId} on page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Copy text from element (safe alternative to clipboard access)
   */
  async copyElementText(pageId: number, elementId: number): Promise<string> {
    try {
      const page = this.browserManager.getPage(pageId);
      if (!page) {
        throw new Error(`Page with ID ${pageId} not found`);
      }

      // Get element details first
      const elementDetails = await this.elementTagger.getElementDetails(page, elementId);
      if (!elementDetails) {
        throw new Error(`Element ${elementId} not found`);
      }

      logger.debug(`Copy element ${elementId}: role="${elementDetails.role}", text="${elementDetails.text}"`);

      // First, try to get text before clicking (for elements that already contain the text)
      const preClickText = await page.evaluate((params: { id: any; elementRole: any }) => {
        const { id, elementRole } = params;

        // Search in main document first
        let element = document.querySelector(`[data-agent-id="${id}"]`) as any;

        // If not found in main document, search in iframes
        if (!element) {
          const iframes = document.querySelectorAll('iframe');
          for (let i = 0; i < iframes.length; i++) {
            const iframe = iframes[i];
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (iframeDoc) {
                element = iframeDoc.querySelector(`[data-agent-id="${id}"]`) as any;
                if (element) break;
              }
            } catch (e) {
              // Cross-origin iframe - skip
              continue;
            }
          }
        }

        if (!element) return '';

        // Extract text based on element type and role
        let text = '';

        // Handle input elements
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
          text = (element as HTMLInputElement | HTMLTextAreaElement).value || '';
        }
        // Handle select elements
        else if (element.tagName === 'SELECT') {
          const selectedOption = (element as HTMLSelectElement).options[(element as HTMLSelectElement).selectedIndex];
          text = selectedOption ? selectedOption.text : '';
        }
        // Handle elements with copy functionality (like copy buttons)
        else if (elementRole?.includes('copy') || element.textContent?.toLowerCase().includes('copy')) {
          // Try to get data-copy attribute if exists
          const copyText = element.getAttribute('data-copy') || element.getAttribute('data-clipboard-text');
          if (copyText) {
            text = copyText;
          } else {
            // Fallback to element text content
            text = element.textContent?.trim() || '';
          }
        }
        // Handle link elements
        else if (element.tagName === 'A') {
          text = (element as HTMLAnchorElement).href || element.textContent?.trim() || '';
        }
        // Handle elements with value attribute
        else if (element.hasAttribute('value')) {
          text = element.getAttribute('value') || '';
        }
        // Handle elements with specific data attributes
        else if (element.hasAttribute('data-text')) {
          text = element.getAttribute('data-text') || '';
        }
        // Fallback to text content
        else {
          text = element.textContent?.trim() || '';
        }

        // If we found a copy button, try to trigger the copy action and get the result
        if (elementRole?.includes('copy') || element.onclick?.toString().includes('copy')) {
          // Look for associated data that would be copied
          const parent = element.closest('[data-copy], [data-clipboard-text]');
          if (parent) {
            const parentCopyText = parent.getAttribute('data-copy') || parent.getAttribute('data-clipboard-text');
            if (parentCopyText) text = parentCopyText;
          }

          // Look for nearby input or code elements that might contain the copy target
          const siblings = element.parentElement?.children;
          if (siblings) {
            for (const sibling of siblings) {
              if ((sibling as any).tagName === 'INPUT' || (sibling as any).tagName === 'CODE') {
                const siblingText = (sibling as any).value || (sibling as any).textContent?.trim();
                if (siblingText && siblingText.length > 0) {
                  text = siblingText;
                  break;
                }
              }
            }
          }
        }

        return text;
      }, { id: elementId, elementRole: elementDetails.role || '' });

      let finalText = preClickText.trim();

      // If it's a copy button or contains copy text, try to find the associated data to copy
      if (!finalText && (elementDetails.role?.includes('copy') || elementDetails.text?.toLowerCase().includes('copy'))) {
        // Look for associated data before clicking
        logger.debug(`Looking for associated text for copy element ${elementId}`);
        const associatedText = await page.evaluate((params: { id: any }) => {
          const { id } = params;
          const copyElement = document.querySelector(`[data-agent-id="${id}"]`) as any;

          if (!copyElement) return '';

          // Look for data attributes on the element itself
          let text = copyElement.getAttribute('data-copy') ||
                    copyElement.getAttribute('data-clipboard-text') ||
                    copyElement.getAttribute('data-value') ||
                    copyElement.getAttribute('value');

          if (text) return text;

          // Look for nearby input, textarea, or code elements
          const parent = copyElement.parentElement;
          if (parent) {
            // Check siblings
            const siblings = parent.children;
            for (const sibling of siblings) {
              if (sibling === copyElement) continue;

              if (sibling.tagName === 'INPUT' || sibling.tagName === 'TEXTAREA') {
                return (sibling as any).value || '';
              }
              if (sibling.tagName === 'CODE' || sibling.tagName === 'PRE') {
                return sibling.textContent?.trim() || '';
              }
            }

            // Check for input/code with specific attributes
            const targetInput = parent.querySelector('input[type="text"], input[type="email"], textarea');
            if (targetInput) {
              return (targetInput as any).value || '';
            }

            const targetCode = parent.querySelector('code, pre');
            if (targetCode) {
              return targetCode.textContent?.trim() || '';
            }
          }

          // Check data attributes on parent or grandparent
          let current = copyElement.parentElement;
          for (let i = 0; i < 3 && current; i++) {
            text = current.getAttribute('data-copy') ||
                  current.getAttribute('data-clipboard-text') ||
                  current.getAttribute('data-value');
            if (text) return text;
            current = current.parentElement;
          }

          return '';
        }, { id: elementId });

        finalText = associatedText.trim();
      }

      if (finalText) {
        logger.info(`Copied text from element ${elementId} on page ${pageId}: "${finalText}"`);

        // Log additional context if available
        if (elementDetails.iframe_path) {
          logger.debug(`Element located in iframe path: ${elementDetails.iframe_path}`);
        }
      } else {
        logger.warning(`No text found in element ${elementId} on page ${pageId}`);
      }

      return finalText;
    } catch (error) {
      logger.error(`Failed to copy text from element ${elementId} on page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Navigate to URL
   */
  async navigateTo(pageId: number, url: string): Promise<void> {
    try {
      await this.browserManager.navigate(pageId, url);
      logger.info(`Navigated page ${pageId} to: ${url}`);
    } catch (error) {
      logger.error(`Failed to navigate page ${pageId} to ${url}:`, error);
      throw error;
    }
  }

  /**
   * Wait for specific amount of time or for element to appear
   */
  async wait(pageId: number, durationOrSelector?: number | string): Promise<void> {
    try {
      const page = this.browserManager.getPage(pageId);
      if (!page) {
        throw new Error(`Page with ID ${pageId} not found`);
      }

      if (typeof durationOrSelector === 'number') {
        // Wait for specified duration in milliseconds
        const duration = durationOrSelector;
        logger.info(`Waiting for ${duration}ms on page ${pageId}`);
        await page.waitForTimeout(duration);
      } else if (typeof durationOrSelector === 'string') {
        // Wait for element to appear
        const selector = durationOrSelector;
        logger.info(`Waiting for element "${selector}" to appear on page ${pageId}`);
        await page.waitForSelector(selector, { timeout: 30000 });
      } else {
        // Default wait of 2 seconds
        logger.info(`Waiting for 2000ms on page ${pageId}`);
        await page.waitForTimeout(2000);
      }
    } catch (error) {
      logger.error(`Failed to wait on page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Scroll page up or down
   */
  async scrollPage(pageId: number, direction: 'up' | 'down'): Promise<void> {
    try {
      await this.browserManager.scrollPage(pageId, direction);
      logger.info(`Scrolled page ${pageId} ${direction}`);
    } catch (error) {
      logger.error(`Failed to scroll page ${pageId} ${direction}:`, error);
      throw error;
    }
  }

  /**
   * Switch to specific tab/page
   */
  async switchToPage(pageId: number): Promise<void> {
    try {
      await this.browserManager.switchToTab(pageId);
      logger.info(`Switched to page ${pageId}`);
    } catch (error) {
      logger.error(`Failed to switch to page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Request user assistance (this would be handled by the main agent)
   */
  async requestUserAssistance(reason: string, isCritical: boolean = false): Promise<void> {
    logger.info(`User assistance requested - Reason: ${reason}, Critical: ${isCritical}`);

    // This method will be called by the agent, but the actual user interaction
    // will be handled by the CLI layer. We just log it here.
    const priority = isCritical ? 'CRITICAL' : 'INFO';
    logger.security(`Assistance request [${priority}]: ${reason}`, isCritical ? 'HIGH' : 'MEDIUM');
  }

  /**
   * Get page information
   */
  async getPageInfo(pageId: number): Promise<{ url: string; title: string }> {
    try {
      const page = this.browserManager.getPage(pageId);
      if (!page) {
        throw new Error(`Page with ID ${pageId} not found`);
      }

      const url = page.url();
      const title = await page.title();

      return { url, title };
    } catch (error) {
      logger.error(`Failed to get page info for page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Get all interactive elements on the page
   */
  async getInteractiveElements(pageId: number): Promise<TaggerElement[]> {
    try {
      const page = this.browserManager.getPage(pageId);
      if (!page) {
        throw new Error(`Page with ID ${pageId} not found`);
      }

      return await this.elementTagger.tagInteractiveElements(page);
    } catch (error) {
      logger.error(`Failed to get interactive elements for page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Wait for element to appear
   */
  async waitForElement(pageId: number, selector: string, timeout: number = 10000): Promise<void> {
    try {
      const page = this.browserManager.getPage(pageId);
      if (!page) {
        throw new Error(`Page with ID ${pageId} not found`);
      }

      await page.waitForSelector(selector, { timeout });
      logger.debug(`Element appeared on page ${pageId}: ${selector}`);
    } catch (error) {
      logger.error(`Element did not appear on page ${pageId}: ${selector}`, error);
      throw error;
    }
  }

  /**
   * Wait for page to load completely
   */
  async waitForPageLoad(pageId: number, timeout: number = 30000): Promise<void> {
    try {
      await this.browserManager.waitForPageReady(pageId, timeout);
      logger.info(`Page ${pageId} loaded completely`);
    } catch (error) {
      logger.error(`Page ${pageId} load timeout:`, error);
      throw error;
    }
  }

  /**
   * Take screenshot of current page
   */
  async takeScreenshot(pageId: number, filename?: string): Promise<Buffer> {
    try {
      const screenshot = await this.browserManager.takeScreenshot(pageId, filename);
      logger.info(`Screenshot taken for page ${pageId}${filename ? `: ${filename}` : ''}`);
      return screenshot;
    } catch (error) {
      logger.error(`Failed to take screenshot for page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Clear element selection and reset
   */
  async reset(pageId: number): Promise<void> {
    try {
      const page = this.browserManager.getPage(pageId);
      if (!page) {
        throw new Error(`Page with ID ${pageId} not found`);
      }

      await this.elementTagger.clearTags(page);
      logger.debug(`Reset elements on page ${pageId}`);
    } catch (error) {
      logger.error(`Failed to reset page ${pageId}:`, error);
      throw error;
    }
  }
}