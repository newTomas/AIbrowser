/**
 * VisibilityChecker - Utility for checking element visibility and detecting overlays
 *
 * Solves problems:
 * 1. AI sees invisible CAPTCHAs that are hidden by CSS
 * 2. AI tries to click elements behind popups/modals
 * 3. Poor understanding of what's actually visible on the page
 */

export class VisibilityChecker {
  constructor(page) {
    this.page = page;
  }

  /**
   * Check if an element is truly clickable (not covered by overlays)
   * Uses elementFromPoint to verify what's actually at the element's position
   *
   * @param {string} selector - CSS selector
   * @returns {Promise<{clickable: boolean, reason: string, coveringElement: string|null}>}
   */
  async isElementClickable(selector) {
    try {
      const result = await this.page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) {
          return { clickable: false, reason: 'Element not found', coveringElement: null };
        }

        // IMPROVED: Use native checkVisibility() if available (most reliable)
        if (typeof element.checkVisibility === 'function') {
          try {
            // checkVisibility() checks all CSS properties including parents
            const isVisible = element.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true
            });

            if (!isVisible) {
              return { clickable: false, reason: 'Element not visible (checkVisibility)', coveringElement: null };
            }
          } catch (e) {
            // If checkVisibility fails, fall back to manual checks
          }
        } else {
          // Fallback for older browsers - manual CSS checks
          const style = window.getComputedStyle(element);
          if (style.display === 'none') {
            return { clickable: false, reason: 'display: none', coveringElement: null };
          }
          if (style.visibility === 'hidden') {
            return { clickable: false, reason: 'visibility: hidden', coveringElement: null };
          }
          if (style.opacity === '0') {
            return { clickable: false, reason: 'opacity: 0', coveringElement: null };
          }

          // Check parent visibility manually
          let parent = element.parentElement;
          while (parent && parent !== document.body) {
            const parentStyle = window.getComputedStyle(parent);

            if (parentStyle.display === 'none') {
              return {
                clickable: false,
                reason: 'Parent element hidden (display: none)',
                coveringElement: parent.tagName.toLowerCase() + (parent.id ? `#${parent.id}` : '') + (parent.className ? `.${parent.className.split(' ')[0]}` : '')
              };
            }

            if (parentStyle.visibility === 'hidden') {
              return {
                clickable: false,
                reason: 'Parent element hidden (visibility: hidden)',
                coveringElement: parent.tagName.toLowerCase() + (parent.id ? `#${parent.id}` : '') + (parent.className ? `.${parent.className.split(' ')[0]}` : '')
              };
            }

            if (parentStyle.opacity === '0') {
              return {
                clickable: false,
                reason: 'Parent element hidden (opacity: 0)',
                coveringElement: parent.tagName.toLowerCase() + (parent.id ? `#${parent.id}` : '') + (parent.className ? `.${parent.className.split(' ')[0]}` : '')
              };
            }

            parent = parent.parentElement;
          }
        }

        // Check if element has dimensions
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return { clickable: false, reason: 'Zero dimensions', coveringElement: null };
        }

        // Check if element is in viewport
        if (rect.bottom < 0 || rect.top > window.innerHeight ||
            rect.right < 0 || rect.left > window.innerWidth) {
          return { clickable: false, reason: 'Outside viewport', coveringElement: null };
        }

        // Use elementFromPoint to check what's actually at the element's center
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const topElement = document.elementFromPoint(centerX, centerY);

        // Check if the top element is the target or a descendant of target
        if (topElement === element || element.contains(topElement)) {
          return { clickable: true, reason: 'Fully clickable', coveringElement: null };
        }

        // Something is covering the element
        let coveringInfo = 'unknown';
        if (topElement) {
          // Get identifier for covering element
          const id = topElement.id ? `#${topElement.id}` : '';
          const classes = topElement.className ? `.${topElement.className.split(' ').join('.')}` : '';
          const tag = topElement.tagName.toLowerCase();
          coveringInfo = `${tag}${id}${classes}`;

          // Check z-index to see if it's an overlay
          const coveringStyle = window.getComputedStyle(topElement);
          const zIndex = parseInt(coveringStyle.zIndex);
          if (zIndex > 1000 || coveringStyle.position === 'fixed') {
            return {
              clickable: false,
              reason: 'Covered by overlay/modal',
              coveringElement: coveringInfo,
              isModal: true
            };
          }
        }

        return {
          clickable: false,
          reason: 'Covered by another element',
          coveringElement: coveringInfo
        };
      }, selector);

      return result;
    } catch (error) {
      return {
        clickable: false,
        reason: `Error checking clickability: ${error.message}`,
        coveringElement: null
      };
    }
  }

  /**
   * Detect active modals/overlays on the page
   *
   * @returns {Promise<Array<{selector: string, type: string, zIndex: number, hasCloseButton: boolean}>>}
   */
  async detectModals() {
    try {
      const modals = await this.page.evaluate(() => {
        const results = [];

        // Common modal/overlay patterns
        const modalSelectors = [
          '[role="dialog"]',
          '[role="alertdialog"]',
          '.modal',
          '.popup',
          '.overlay',
          '.dialog',
          '[class*="modal"]',
          '[class*="popup"]',
          '[class*="overlay"]',
          '[class*="dialog"]',
          '[id*="modal"]',
          '[id*="popup"]',
          '[id*="overlay"]'
        ];

        const checkedElements = new Set();

        for (const selector of modalSelectors) {
          const elements = document.querySelectorAll(selector);

          for (const element of elements) {
            // Avoid duplicates
            if (checkedElements.has(element)) continue;
            checkedElements.add(element);

            // IMPROVED: Use native checkVisibility() if available
            let isVisible = false;

            if (typeof element.checkVisibility === 'function') {
              try {
                isVisible = element.checkVisibility({
                  checkOpacity: true,
                  checkVisibilityCSS: true
                });
              } catch (e) {
                // Fallback to manual check if checkVisibility fails
                isVisible = false;
              }
            }

            // Fallback for older browsers or if checkVisibility failed
            if (!isVisible && typeof element.checkVisibility !== 'function') {
              const style = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();

              isVisible =
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0' &&
                rect.width > 0 &&
                rect.height > 0;

              if (isVisible) {
                // Check parent visibility manually
                let parent = element.parentElement;
                while (parent && parent !== document.body) {
                  const parentStyle = window.getComputedStyle(parent);

                  if (parentStyle.display === 'none' ||
                      parentStyle.visibility === 'hidden' ||
                      parentStyle.opacity === '0') {
                    isVisible = false;
                    break;
                  }

                  parent = parent.parentElement;
                }
              }
            }

            if (!isVisible) continue;

            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            const zIndex = parseInt(style.zIndex) || 0;
            const position = style.position;

            // High z-index or fixed position suggests modal/overlay
            const isModal = zIndex > 100 || position === 'fixed' || position === 'absolute';

            if (isModal) {
              // Look for close button
              const closeButtons = element.querySelectorAll(
                'button[aria-label*="close" i], ' +
                'button[aria-label*="dismiss" i], ' +
                'button.close, ' +
                '[class*="close"], ' +
                '[class*="dismiss"], ' +
                'button[title*="close" i]'
              );

              // Get best selector for this modal
              let bestSelector = '';
              if (element.id) {
                bestSelector = `#${element.id}`;
              } else if (element.className) {
                const classes = element.className.split(' ').filter(c => c.trim());
                bestSelector = `.${classes[0]}`;
              } else {
                bestSelector = element.tagName.toLowerCase();
              }

              // Determine type
              let type = 'modal';
              if (element.getAttribute('role') === 'alertdialog') type = 'alert';
              else if (selector.includes('popup')) type = 'popup';
              else if (selector.includes('overlay')) type = 'overlay';

              results.push({
                selector: bestSelector,
                type,
                zIndex,
                position,
                hasCloseButton: closeButtons.length > 0,
                closeButtonSelector: closeButtons.length > 0 ? this.getBestSelector(closeButtons[0]) : null,
                dimensions: {
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                },
                coversViewport: rect.width >= window.innerWidth * 0.8 && rect.height >= window.innerHeight * 0.8
              });
            }
          }
        }

        return results;

        // Helper function to get best selector
        function getBestSelector(element) {
          if (element.id) return `#${element.id}`;

          const classes = element.className?.split(' ').filter(c => c.trim());
          if (classes && classes.length > 0) {
            return `${element.tagName.toLowerCase()}.${classes[0]}`;
          }

          return element.tagName.toLowerCase();
        }
      });

      return modals;
    } catch (error) {
      console.error('Error detecting modals:', error);
      return [];
    }
  }

  /**
   * Try to dismiss/close an active modal
   *
   * @param {Object} modal - Modal object from detectModals()
   * @returns {Promise<{success: boolean, method: string}>}
   */
  async dismissModal(modal) {
    try {
      // Method 1: Click close button if exists
      if (modal.hasCloseButton && modal.closeButtonSelector) {
        try {
          await this.page.click(modal.closeButtonSelector, { timeout: 2000 });

          // Wait a bit and verify modal is gone
          await this.page.waitForTimeout(500);
          const stillExists = await this.page.$(modal.selector);

          if (!stillExists) {
            return { success: true, method: 'close_button' };
          }
        } catch (e) {
          // Close button click failed, try other methods
        }
      }

      // Method 2: Press Escape key
      try {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);

        const stillExists = await this.page.$(modal.selector);
        if (!stillExists) {
          return { success: true, method: 'escape_key' };
        }
      } catch (e) {
        // Escape didn't work
      }

      // Method 3: Click outside modal (on backdrop)
      if (modal.coversViewport === false) {
        try {
          // Click top-left corner (usually outside modal)
          await this.page.mouse.click(10, 10);
          await this.page.waitForTimeout(500);

          const stillExists = await this.page.$(modal.selector);
          if (!stillExists) {
            return { success: true, method: 'backdrop_click' };
          }
        } catch (e) {
          // Backdrop click didn't work
        }
      }

      return { success: false, method: 'none' };
    } catch (error) {
      return { success: false, method: 'error', error: error.message };
    }
  }

  /**
   * Get comprehensive visibility info for a selector
   * This includes CSS visibility, clickability, and covering elements
   *
   * @param {string} selector - CSS selector
   * @returns {Promise<Object>}
   */
  async getVisibilityInfo(selector) {
    const clickabilityInfo = await this.isElementClickable(selector);

    const cssInfo = await this.page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) return null;

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        zIndex: style.zIndex,
        position: style.position,
        dimensions: {
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        inViewport:
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= window.innerHeight &&
          rect.right <= window.innerWidth
      };
    }, selector);

    return {
      selector,
      exists: cssInfo !== null,
      cssVisible: cssInfo ? (
        cssInfo.display !== 'none' &&
        cssInfo.visibility !== 'hidden' &&
        cssInfo.opacity !== '0'
      ) : false,
      ...clickabilityInfo,
      cssInfo
    };
  }

  /**
   * Check multiple elements at once
   * Useful for HTMLAnalyzerAgent to verify all suggested selectors
   *
   * @param {Array<string>} selectors - Array of CSS selectors
   * @returns {Promise<Array<Object>>}
   */
  async checkMultipleElements(selectors) {
    const results = [];

    for (const selector of selectors) {
      const info = await this.getVisibilityInfo(selector);
      results.push(info);
    }

    return results;
  }

  /**
   * Scan page for any active overlays/modals and return summary
   * This is called automatically before AI makes decisions
   *
   * @returns {Promise<Object>}
   */
  async getPageOverlayStatus() {
    const modals = await this.detectModals();

    return {
      hasActiveOverlays: modals.length > 0,
      modalCount: modals.length,
      modals: modals.map(m => ({
        type: m.type,
        dismissible: m.hasCloseButton,
        coversFullScreen: m.coversViewport,
        zIndex: m.zIndex
      })),
      recommendation: modals.length > 0 ?
        'Active overlays detected. Consider dismissing before interacting with page content.' :
        'No active overlays detected.'
    };
  }
}
