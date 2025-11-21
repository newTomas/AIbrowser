import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs/promises';
import { VisibilityChecker } from '../utils/VisibilityChecker.js';

/**
 * Manages browser instances with persistent session support
 */
export class BrowserManager {
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.page = null;
    this.tabs = new Map(); // Store tabs with IDs
    this.activeTabId = null;
    this.sessionDir = config.sessionDir || './sessions';
    this.visibilityChecker = null; // Will be initialized after launch
  }

  /**
   * Launch browser with persistent session
   * @param {string} sessionName - Name of the session (e.g., 'default', 'user1')
   */
  async launch(sessionName = 'default') {
    const userDataDir = path.join(this.sessionDir, sessionName);

    // Ensure session directory exists
    await fs.mkdir(userDataDir, { recursive: true });

    this.browser = await puppeteer.launch({
      headless: this.config.headless || false,
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security', // For development only
      ],
      defaultViewport: {
        width: 1280,
        height: 800,
      },
    });

    // Get or create a page
    const pages = await this.browser.pages();
    this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();

    // Set user agent to avoid detection
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );

    // Register first tab
    this.activeTabId = 'tab-0';
    this.tabs.set(this.activeTabId, {
      id: this.activeTabId,
      page: this.page,
      title: 'New Tab',
      url: 'about:blank',
    });

    // Initialize VisibilityChecker for current page
    this.visibilityChecker = new VisibilityChecker(this.page);

    console.log(`Browser launched with session: ${sessionName}`);
    return this.page;
  }

  /**
   * Navigate to URL
   */
  async goto(url, options = {}) {
    if (!this.page) throw new Error('Browser not launched');

    try {
      // IMPROVED: Use domcontentloaded by default for faster navigation
      await this.page.goto(url, {
        waitUntil: options.waitUntil || 'domcontentloaded',
        timeout: options.timeout || 15000,
        ...options,
      });

      // Small delay to let page stabilize
      await new Promise(resolve => setTimeout(resolve, 500));

      return true;
    } catch (error) {
      console.log(`⚠️  Navigation error: ${error.message}`);

      // Check if it's a DNS/connection error (cannot be recovered)
      if (error.message.includes('ERR_NAME_NOT_RESOLVED') ||
          error.message.includes('ERR_CONNECTION_REFUSED') ||
          error.message.includes('ERR_INTERNET_DISCONNECTED')) {
        console.log('❌ Navigation failed - invalid URL or connection issue');
        return false; // Cannot continue with this navigation
      }

      // For timeout errors, page may still be partially usable
      if (error.message.includes('timeout')) {
        console.log('⚠️  Navigation timeout - page may be partially loaded');
        return true;
      }

      // For other errors, return false
      return false;
    }
  }

  /**
   * Get current page URL
   */
  async getCurrentUrl() {
    if (!this.page) return null;
    return this.page.url();
  }

  /**
   * Take screenshot
   */
  async screenshot(options = {}) {
    if (!this.page) throw new Error('Browser not launched');
    return await this.page.screenshot({
      encoding: 'base64',
      ...options,
    });
  }

  /**
   * Get page content with smart extraction
   */
  async getPageContent() {
    if (!this.page) throw new Error('Browser not launched');

    try {
      return await this.page.evaluate(() => {
      /**
       * Helper: Check if element is visible using checkVisibility() or fallback
       */
      const isVisible = (element) => {
        if (!element) return false;

        // Use native checkVisibility() if available
        if (typeof element.checkVisibility === 'function') {
          try {
            return element.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true
            });
          } catch (e) {
            // Fall through to fallback
          }
        }

        // Fallback: manual checks
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return element.offsetParent !== null &&
               style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0' &&
               rect.width > 0 &&
               rect.height > 0;
      };

      /**
       * IMPROVED: Extract text only from visible elements
       * Walks the DOM tree and collects text only from visible text nodes
       */
      const extractVisibleText = (rootElement) => {
        const textParts = [];

        const walk = (node) => {
          // Skip if node is not visible
          if (node.nodeType === Node.ELEMENT_NODE && !isVisible(node)) {
            return;
          }

          // If it's a text node with content, add it
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (text.length > 0) {
              textParts.push(text);
            }
          }

          // Recurse into child nodes
          if (node.childNodes) {
            for (const child of node.childNodes) {
              walk(child);
            }
          }
        };

        walk(rootElement);
        return textParts.join(' ');
      };

      // Extract text content from main areas
      const title = document.title;

      // IMPROVED: Get only visible body text
      const body = extractVisibleText(document.body);

      // Get metadata
      const description = document.querySelector('meta[name="description"]')?.content || '';
      const keywords = document.querySelector('meta[name="keywords"]')?.content || '';

      // IMPROVED: Get visible links using checkVisibility()
      const links = Array.from(document.querySelectorAll('a[href]'))
        .filter(a => isVisible(a))
        .map(a => ({
          text: a.innerText.trim(),
          href: a.href,
        }))
        .filter(l => l.text.length > 0)
        .slice(0, 50); // Limit to 50 links

      // IMPROVED: Get only visible forms
      const forms = Array.from(document.querySelectorAll('form'))
        .filter(form => isVisible(form))
        .map(form => ({
          action: form.action,
          method: form.method,
          inputs: Array.from(form.querySelectorAll('input, textarea, select'))
            .filter(input => isVisible(input))
            .map(input => ({
              type: input.type,
              name: input.name,
              id: input.id,
              placeholder: input.placeholder,
              required: input.required,
            })),
        }));

      // IMPROVED: Get visible buttons using checkVisibility()
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]'))
        .filter(b => isVisible(b))
        .map(b => ({
          text: b.innerText || b.value || '',
          type: b.type,
          id: b.id,
          class: b.className,
        }))
        .slice(0, 30);

      return {
        url: window.location.href,
        title,
        description,
        keywords,
        body: body.slice(0, 3000), // Limit body text
        links,
        forms,
        buttons,
      };
    });
    } catch (error) {
      // Handle destroyed execution context or other errors
      if (error.message.includes('Execution context was destroyed')) {
        console.log('⚠️  Page context destroyed - returning minimal content');
        return {
          url: this.page.url() || 'unknown',
          title: 'Error: Page context destroyed',
          description: '',
          keywords: '',
          body: 'The page navigation failed and context was destroyed.',
          links: [],
          forms: [],
          buttons: [],
        };
      }
      throw error; // Re-throw other errors
    }
  }

  /**
   * Click element by selector or text
   */
  async click(selector) {
    if (!this.page) throw new Error('Browser not launched');

    // IMPROVED: Ensure current page is brought to front before interacting
    try {
      await this.page.bringToFront();
    } catch (error) {
      console.log('⚠️  Could not bring page to front:', error.message);
    }

    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });

      // NEW v2.2: Check if element is truly clickable
      if (this.visibilityChecker) {
        const clickabilityInfo = await this.visibilityChecker.isElementClickable(selector);

        if (!clickabilityInfo.clickable) {
          console.log(`⚠️  Element may not be clickable: ${clickabilityInfo.reason}`);

          // If covered by modal, check for active modals
          if (clickabilityInfo.isModal) {
            console.log(`   Covered by: ${clickabilityInfo.coveringElement}`);
            const modals = await this.visibilityChecker.detectModals();
            if (modals.length > 0) {
              console.log(`   Active modals detected: ${modals.length}`);
              console.log(`   Consider dismissing modals before clicking`);
            }
          }

          // Still attempt click with DOM method (may work despite warning)
        }
      }

      // IMPROVED: Use DOM click instead of coordinate click to avoid clicking on overlays/ads
      // Get element handle and click directly on the DOM element
      const element = await this.page.$(selector);

      if (element) {
        // Scroll element into view first
        await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));

        // Wait a bit for scroll and any animations
        await new Promise(resolve => setTimeout(resolve, 300));

        // Click the DOM element directly (bypasses visual overlays)
        await element.click();
        return { success: true };
      } else {
        return { success: false, error: `Element not found: ${selector}` };
      }
    } catch (error) {
      // Try clicking by text content
      try {
        const element = await this.page.evaluateHandle((text) => {
          const elements = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], div[role="button"]'));
          return elements.find(el => el.innerText.includes(text) || el.value?.includes(text));
        }, selector);

        if (element) {
          // Scroll into view and click
          await element.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
          await new Promise(resolve => setTimeout(resolve, 300));
          await element.click();
          return { success: true };
        }
      } catch (innerError) {
        return { success: false, error: `Could not find element: ${selector}` };
      }
    }
  }

  /**
   * Type text into input field
   * IMPROVED: Clears existing content before typing
   */
  async type(selector, text, options = {}) {
    if (!this.page) throw new Error('Browser not launched');

    // IMPROVED: Ensure current page is brought to front before interacting
    try {
      await this.page.bringToFront();
    } catch (error) {
      console.log('⚠️  Could not bring page to front:', error.message);
    }

    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });

      // Get the input element
      const element = await this.page.$(selector);

      if (!element) {
        return { success: false, error: `Element not found: ${selector}` };
      }

      // Clear existing content first
      // Method 1: Select all and delete
      await element.click({ clickCount: 3 }); // Triple-click to select all
      await this.page.keyboard.press('Backspace'); // Delete selected text

      // Small delay to ensure clear completed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Type new text
      await element.type(text, { delay: 50, ...options });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Wait for navigation
   */
  async waitForNavigation(options = {}) {
    if (!this.page) throw new Error('Browser not launched');

    try {
      await this.page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 30000,
        ...options,
      });
      return true;
    } catch (error) {
      console.error(`Navigation wait error: ${error.message}`);
      return false;
    }
  }

  /**
   * Execute custom script on page
   */
  async evaluate(script, ...args) {
    if (!this.page) throw new Error('Browser not launched');

    // If script is a string, handle different script formats
    if (typeof script === 'string') {
      const trimmedScript = script.trim();

      // Check if it's a multi-line script or contains variable declarations
      const isMultiLine = trimmedScript.includes('\n') || trimmedScript.includes(';');
      const hasVariables = /\b(const|let|var)\b/.test(trimmedScript);

      if (isMultiLine || hasVariables) {
        // It's a full script - wrap in IIFE without adding 'return'
        const wrappedScript = `(() => { ${trimmedScript} })()`;
        return await this.page.evaluate(wrappedScript);
      } else {
        // It's a simple expression - can wrap with return
        const cleanScript = trimmedScript.replace(/^return\s+/, '');
        const wrappedScript = `(() => { return ${cleanScript}; })()`;
        return await this.page.evaluate(wrappedScript);
      }
    }

    // If already a function, use directly
    return await this.page.evaluate(script, ...args);
  }

  /**
   * Get raw HTML content from page
   * IMPROVED v2.2: Removes hidden elements before returning HTML
   */
  async getHTML() {
    if (!this.page) throw new Error('Browser not launched');

    try {
      return await this.page.evaluate(() => {
        /**
         * Helper: Check if element is visible using checkVisibility() or fallback
         */
        const isVisible = (element) => {
          if (!element) return false;

          // Use native checkVisibility() if available
          if (typeof element.checkVisibility === 'function') {
            try {
              return element.checkVisibility({
                checkOpacity: true,
                checkVisibilityCSS: true
              });
            } catch (e) {
              // Fall through to fallback
            }
          }

          // Fallback: manual checks
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();

          return element.offsetParent !== null &&
                 style.display !== 'none' &&
                 style.visibility !== 'hidden' &&
                 style.opacity !== '0' &&
                 rect.width > 0 &&
                 rect.height > 0;
        };

        /**
         * IMPROVED: Mark all hidden elements with data attribute, then remove from clone
         * This ensures HTMLAnalyzerAgent (Cheerio) only sees visible content
         */

        // Mark all invisible elements in original document with a data attribute
        const allElements = Array.from(document.querySelectorAll('*'));
        const markerAttr = 'data-hidden-temp-' + Date.now();

        for (const element of allElements) {
          if (!isVisible(element)) {
            element.setAttribute(markerAttr, 'true');
          }
        }

        // Clone document (attributes are cloned too)
        const clone = document.documentElement.cloneNode(true);

        // Remove marked elements from clone
        const markedInClone = clone.querySelectorAll(`[${markerAttr}]`);
        markedInClone.forEach(el => el.remove());

        // Clean up - remove marker from original document
        allElements.forEach(el => {
          if (el.hasAttribute(markerAttr)) {
            el.removeAttribute(markerAttr);
          }
        });

        return clone.outerHTML;
      });
    } catch (error) {
      if (error.message.includes('Execution context was destroyed')) {
        console.log('⚠️  Page context destroyed - returning empty HTML');
        return '<html><body>Error: Page context destroyed</body></html>';
      }
      throw error;
    }
  }

  /**
   * Check if CAPTCHA elements are actually visible on the page
   * Universal approach - works with any CAPTCHA type
   * @returns {Promise<object>} Visibility information
   */
  async checkCaptchaVisibility() {
    if (!this.page) throw new Error('Browser not launched');

    return await this.page.evaluate(() => {
      const results = {
        hasVisibleCaptcha: false,
        visibleElements: [],
        details: {},
      };

      /**
       * Universal visibility check for any element
       * @param {Element} element - DOM element to check
       * @returns {boolean} True if element is actually visible to user
       */
      const isElementVisible = (element) => {
        if (!element) return false;

        // IMPROVED: Use native checkVisibility() if available (most reliable)
        if (typeof element.checkVisibility === 'function') {
          try {
            return element.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true
            });
          } catch (e) {
            // Fall through to manual check
          }
        }

        // Fallback for older browsers - manual checks
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        // Check element itself
        const elementVisible = rect.width > 0 &&
               rect.height > 0 &&
               element.offsetParent !== null &&
               style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0';

        if (!elementVisible) return false;

        // Check parent visibility manually
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
          const parentStyle = window.getComputedStyle(parent);

          if (parentStyle.display === 'none' ||
              parentStyle.visibility === 'hidden' ||
              parentStyle.opacity === '0') {
            return false; // Parent is hidden, so element is not visible
          }

          parent = parent.parentElement;
        }

        return true;
      };

      /**
       * Check if iframe size indicates active challenge (not passive badge)
       * @param {DOMRect} rect - Bounding rectangle
       * @returns {boolean} True if likely an active challenge
       */
      const isActiveChallenge = (rect) => {
        const isLarge = rect.width > 250 || rect.height > 200;
        const isBadge = rect.width < 100 && rect.height < 100;
        return isLarge || !isBadge;
      };

      // Universal selectors for CAPTCHA-related iframes
      const captchaIframeSelectors = [
        'iframe[src*="recaptcha"]',
        'iframe[src*="hcaptcha"]',
        'iframe[src*="captcha"]',
        'iframe[src*="challenge"]',
        'iframe[title*="captcha" i]',
        'iframe[title*="challenge" i]',
      ];

      // Check all CAPTCHA iframes
      const allIframes = document.querySelectorAll(captchaIframeSelectors.join(', '));
      for (const iframe of allIframes) {
        if (isElementVisible(iframe)) {
          const rect = iframe.getBoundingClientRect();

          // Only report if it's likely an active challenge (not a small badge)
          if (isActiveChallenge(rect)) {
            results.hasVisibleCaptcha = true;
            results.visibleElements.push({
              type: 'captcha_iframe',
              size: `${rect.width}x${rect.height}`,
              src: iframe.src?.slice(0, 100) || 'unknown',
            });
          }
        }
      }

      // Universal selectors for CAPTCHA elements (not iframes)
      const captchaElementSelectors = [
        '#cf-challenge-running',
        '.cf-browser-verification',
        '[class*="captcha"]',
        '[id*="captcha"]',
        '[class*="challenge"]',
        '[id*="challenge"]',
        '[role="dialog"][aria-label*="captcha" i]',
        '[role="dialog"][aria-label*="verify" i]',
      ];

      // Check all CAPTCHA elements
      const allElements = document.querySelectorAll(captchaElementSelectors.join(', '));
      for (const element of allElements) {
        if (isElementVisible(element)) {
          results.hasVisibleCaptcha = true;
          results.visibleElements.push({
            type: 'captcha_element',
            tagName: element.tagName.toLowerCase(),
            className: element.className,
            id: element.id,
          });
        }
      }

      // Check page body text for active captcha messages
      const bodyText = document.body?.innerText?.toLowerCase() || '';
      if (bodyText.includes('verify you are human') ||
          bodyText.includes('complete the captcha') ||
          bodyText.includes('checking your browser')) {
        results.details.hasActiveText = true;

        // Only mark as visible if text is prominent (page is short)
        if (bodyText.length < 500) {
          results.hasVisibleCaptcha = true;
          results.visibleElements.push({
            type: 'captcha_interstitial',
          });
        }
      }

      return results;
    });
  }

  /**
   * Tab Management Methods
   */

  /**
   * Create new tab
   * @param {string} url - Optional URL to navigate to
   * @param {boolean} switchToNew - Automatically switch to new tab (default: true)
   * @returns {Promise<string>} Tab ID
   */
  async createTab(url = 'about:blank', switchToNew = true) {
    if (!this.browser) throw new Error('Browser not launched');

    const newPage = await this.browser.newPage();

    // Set user agent
    await newPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );

    const tabId = `tab-${this.tabs.size}`;

    this.tabs.set(tabId, {
      id: tabId,
      page: newPage,
      title: 'New Tab',
      url,
    });

    // Navigate if URL provided
    if (url && url !== 'about:blank') {
      // IMPROVED: Use domcontentloaded instead of networkidle2 for faster loading
      // This allows page to be usable even if some resources are still loading
      try {
        await newPage.goto(url, {
          waitUntil: 'domcontentloaded', // Wait for DOM, not all resources
          timeout: 15000, // Shorter timeout
        });
      } catch (error) {
        // If navigation fails or times out, try to continue anyway
        console.log(`⚠️  Navigation timeout/error in new tab, continuing anyway: ${error.message}`);
      }

      // Wait a bit more for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Update tab info after navigation
      const tab = this.tabs.get(tabId);
      try {
        tab.title = await newPage.title();
        tab.url = newPage.url(); // url() is synchronous, not a Promise
      } catch (error) {
        tab.title = 'New Tab';
        tab.url = url;
      }
    }

    // FIXED: Automatically switch to new tab by default
    if (switchToNew) {
      this.page = newPage;
      this.activeTabId = tabId;
      // FIXED: Update VisibilityChecker for the new tab
      this.visibilityChecker = new VisibilityChecker(newPage);
      await newPage.bringToFront();
      console.log(`✓ Created and switched to new tab: ${tabId} (${url})`);
    } else {
      console.log(`✓ Created new tab: ${tabId} (${url})`);
    }

    return tabId;
  }

  /**
   * Switch to specific tab
   * @param {string} tabId - Tab ID to switch to
   */
  async switchTab(tabId) {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Tab ${tabId} not found`);
    }

    const tab = this.tabs.get(tabId);
    this.page = tab.page;
    this.activeTabId = tabId;

    await tab.page.bringToFront();

    // NEW v2.2: Update VisibilityChecker for the new active tab
    this.visibilityChecker = new VisibilityChecker(this.page);

    console.log(`✓ Switched to tab: ${tabId} (${tab.url})`);
    return true;
  }

  /**
   * Close specific tab
   * @param {string} tabId - Tab ID to close
   */
  async closeTab(tabId) {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Tab ${tabId} not found`);
    }

    // Don't close if it's the only tab
    if (this.tabs.size === 1) {
      console.log('Cannot close the last tab');
      return false;
    }

    const tab = this.tabs.get(tabId);
    await tab.page.close();
    this.tabs.delete(tabId);

    // If we closed the active tab, switch to another
    if (this.activeTabId === tabId) {
      const firstTabId = this.tabs.keys().next().value;
      await this.switchTab(firstTabId);
    }

    console.log(`✓ Closed tab: ${tabId}`);
    return true;
  }

  /**
   * Get all tabs
   * @returns {Array} List of tab info
   */
  async getAllTabs() {
    const tabList = [];

    for (const [tabId, tab] of this.tabs.entries()) {
      try {
        const url = await tab.page.url();
        const title = await tab.page.title();

        tabList.push({
          id: tabId,
          url,
          title,
          active: tabId === this.activeTabId,
        });
      } catch (error) {
        // Tab might be closed
        tabList.push({
          id: tabId,
          url: 'closed',
          title: 'Closed',
          active: false,
        });
      }
    }

    return tabList;
  }

  /**
   * Get active tab ID
   */
  getActiveTabId() {
    return this.activeTabId;
  }

  /**
   * Find tab by URL pattern
   * @param {string} urlPattern - URL pattern to search for
   * @returns {string|null} Tab ID or null
   */
  async findTabByUrl(urlPattern) {
    for (const [tabId, tab] of this.tabs.entries()) {
      try {
        const url = await tab.page.url();
        if (url.includes(urlPattern)) {
          return tabId;
        }
      } catch (error) {
        // Skip closed tabs
      }
    }
    return null;
  }

  /**
   * Navigate in specific tab
   * @param {string} tabId - Tab ID
   * @param {string} url - URL to navigate to
   * @param {boolean} switchToTab - Switch to tab after navigation (default: true)
   */
  async gotoInTab(tabId, url, switchToTab = true) {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Tab ${tabId} not found`);
    }

    const tab = this.tabs.get(tabId);

    try {
      await tab.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Update tab info
      tab.url = url;
      tab.title = await tab.page.title();

      // FIXED: Switch to tab if requested
      if (switchToTab) {
        this.page = tab.page;
        this.activeTabId = tabId;
        await tab.page.bringToFront();
      }

      return true;
    } catch (error) {
      console.error(`Navigation error in tab ${tabId}:`, error.message);
      return false;
    }
  }

  /**
   * Get page content from specific tab (without switching)
   * @param {string} tabId - Tab ID
   * @returns {Promise<object>} Page content
   */
  async getPageContentFromTab(tabId) {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Tab ${tabId} not found`);
    }

    const tab = this.tabs.get(tabId);
    const page = tab.page;

    return await page.evaluate(() => {
      /**
       * Helper: Check if element is visible using checkVisibility() or fallback
       */
      const isVisible = (element) => {
        if (!element) return false;

        // Use native checkVisibility() if available
        if (typeof element.checkVisibility === 'function') {
          try {
            return element.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true
            });
          } catch (e) {
            // Fall through to fallback
          }
        }

        // Fallback: manual checks
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return element.offsetParent !== null &&
               style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0' &&
               rect.width > 0 &&
               rect.height > 0;
      };

      /**
       * IMPROVED: Extract text only from visible elements
       * Walks the DOM tree and collects text only from visible text nodes
       */
      const extractVisibleText = (rootElement) => {
        const textParts = [];

        const walk = (node) => {
          // Skip if node is not visible
          if (node.nodeType === Node.ELEMENT_NODE && !isVisible(node)) {
            return;
          }

          // If it's a text node with content, add it
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (text.length > 0) {
              textParts.push(text);
            }
          }

          // Recurse into child nodes
          if (node.childNodes) {
            for (const child of node.childNodes) {
              walk(child);
            }
          }
        };

        walk(rootElement);
        return textParts.join(' ');
      };

      // Extract text content from main areas
      const title = document.title;

      // IMPROVED: Get only visible body text
      const body = extractVisibleText(document.body);

      // Get metadata
      const description = document.querySelector('meta[name="description"]')?.content || '';
      const keywords = document.querySelector('meta[name="keywords"]')?.content || '';

      // IMPROVED: Get visible links using checkVisibility()
      const links = Array.from(document.querySelectorAll('a[href]'))
        .filter(a => isVisible(a))
        .map(a => ({
          text: a.innerText.trim(),
          href: a.href,
        }))
        .filter(l => l.text.length > 0)
        .slice(0, 50); // Limit to 50 links

      // IMPROVED: Get only visible forms
      const forms = Array.from(document.querySelectorAll('form'))
        .filter(form => isVisible(form))
        .map(form => ({
          action: form.action,
          method: form.method,
          inputs: Array.from(form.querySelectorAll('input, textarea, select'))
            .filter(input => isVisible(input))
            .map(input => ({
              type: input.type,
              name: input.name,
              id: input.id,
              placeholder: input.placeholder,
              required: input.required,
            })),
        }));

      // IMPROVED: Get visible buttons using checkVisibility()
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]'))
        .filter(b => isVisible(b))
        .map(b => ({
          text: b.innerText || b.value || '',
          type: b.type,
          id: b.id,
          class: b.className,
        }))
        .slice(0, 30);

      return {
        url: window.location.href,
        title,
        description,
        keywords,
        body: body.slice(0, 3000), // Limit body text
        links,
        forms,
        buttons,
      };
    });
  }

  /**
   * Get HTML from specific tab
   * IMPROVED v2.2: Removes hidden elements before returning HTML
   * @param {string} tabId - Tab ID (optional, uses active tab if not provided)
   * @returns {Promise<string>} HTML content
   */
  async getHTMLFromTab(tabId = null) {
    const targetTabId = tabId || this.activeTabId;

    if (!this.tabs.has(targetTabId)) {
      throw new Error(`Tab ${targetTabId} not found`);
    }

    const tab = this.tabs.get(targetTabId);
    return await tab.page.evaluate(() => {
      /**
       * Helper: Check if element is visible using checkVisibility() or fallback
       */
      const isVisible = (element) => {
        if (!element) return false;

        // Use native checkVisibility() if available
        if (typeof element.checkVisibility === 'function') {
          try {
            return element.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true
            });
          } catch (e) {
            // Fall through to fallback
          }
        }

        // Fallback: manual checks
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return element.offsetParent !== null &&
               style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0' &&
               rect.width > 0 &&
               rect.height > 0;
      };

      /**
       * IMPROVED: Mark all hidden elements with data attribute, then remove from clone
       */

      // Mark all invisible elements in original document
      const allElements = Array.from(document.querySelectorAll('*'));
      const markerAttr = 'data-hidden-temp-' + Date.now();

      for (const element of allElements) {
        if (!isVisible(element)) {
          element.setAttribute(markerAttr, 'true');
        }
      }

      // Clone document (attributes are cloned too)
      const clone = document.documentElement.cloneNode(true);

      // Remove marked elements from clone
      const markedInClone = clone.querySelectorAll(`[${markerAttr}]`);
      markedInClone.forEach(el => el.remove());

      // Clean up - remove marker from original document
      allElements.forEach(el => {
        if (el.hasAttribute(markerAttr)) {
          el.removeAttribute(markerAttr);
        }
      });

      return clone.outerHTML;
    });
  }

  /**
   * List available sessions
   */
  async listSessions() {
    try {
      const sessions = await fs.readdir(this.sessionDir);
      return sessions.filter(s => s !== '.gitkeep');
    } catch (error) {
      return [];
    }
  }

  /**
   * Close browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.tabs.clear();
      this.activeTabId = null;
      console.log('Browser closed');
    }
  }

  /**
   * Check if browser is running
   */
  isRunning() {
    return this.browser !== null && this.browser.isConnected();
  }

  /**
   * NEW v2.2: Check if element is clickable
   * @param {string} selector - CSS selector
   * @returns {Promise<Object>} Clickability info
   */
  async checkElementClickability(selector) {
    if (!this.visibilityChecker) {
      throw new Error('VisibilityChecker not initialized');
    }
    return await this.visibilityChecker.isElementClickable(selector);
  }

  /**
   * NEW v2.2: Detect active modals/overlays on the page
   * @returns {Promise<Array>} List of detected modals
   */
  async detectModals() {
    if (!this.visibilityChecker) {
      throw new Error('VisibilityChecker not initialized');
    }
    return await this.visibilityChecker.detectModals();
  }

  /**
   * NEW v2.2: Try to dismiss/close a modal
   * @param {Object} modal - Modal object from detectModals()
   * @returns {Promise<Object>} Result with success status
   */
  async dismissModal(modal) {
    if (!this.visibilityChecker) {
      throw new Error('VisibilityChecker not initialized');
    }
    return await this.visibilityChecker.dismissModal(modal);
  }

  /**
   * NEW v2.2: Get page overlay status (for context)
   * @returns {Promise<Object>} Overlay status summary
   */
  async getPageOverlayStatus() {
    if (!this.visibilityChecker) {
      return {
        hasActiveOverlays: false,
        modalCount: 0,
        modals: [],
        recommendation: 'VisibilityChecker not initialized'
      };
    }
    return await this.visibilityChecker.getPageOverlayStatus();
  }

  /**
   * NEW v2.2: Get detailed visibility info for an element
   * @param {string} selector - CSS selector
   * @returns {Promise<Object>} Comprehensive visibility info
   */
  async getElementVisibilityInfo(selector) {
    if (!this.visibilityChecker) {
      throw new Error('VisibilityChecker not initialized');
    }
    return await this.visibilityChecker.getVisibilityInfo(selector);
  }

  /**
   * NEW v2.2: Update VisibilityChecker when switching tabs
   * @param {string} tabId - Tab ID
   */
  async updateVisibilityCheckerForTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab && tab.page) {
      this.visibilityChecker = new VisibilityChecker(tab.page);
    }
  }
}
