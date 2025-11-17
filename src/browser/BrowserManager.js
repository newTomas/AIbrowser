import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs/promises';

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

    console.log(`Browser launched with session: ${sessionName}`);
    return this.page;
  }

  /**
   * Navigate to URL
   */
  async goto(url, options = {}) {
    if (!this.page) throw new Error('Browser not launched');

    try {
      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
        ...options,
      });
      return true;
    } catch (error) {
      console.error(`Navigation error: ${error.message}`);
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

    return await this.page.evaluate(() => {
      // Remove script and style tags
      const clone = document.cloneNode(true);
      clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());

      // Extract text content from main areas
      const title = document.title;
      const body = clone.body?.innerText || '';

      // Get metadata
      const description = document.querySelector('meta[name="description"]')?.content || '';
      const keywords = document.querySelector('meta[name="keywords"]')?.content || '';

      // Get visible links
      const links = Array.from(document.querySelectorAll('a[href]'))
        .filter(a => a.offsetParent !== null) // Only visible links
        .map(a => ({
          text: a.innerText.trim(),
          href: a.href,
        }))
        .filter(l => l.text.length > 0)
        .slice(0, 50); // Limit to 50 links

      // Get forms
      const forms = Array.from(document.querySelectorAll('form')).map(form => ({
        action: form.action,
        method: form.method,
        inputs: Array.from(form.querySelectorAll('input, textarea, select')).map(input => ({
          type: input.type,
          name: input.name,
          id: input.id,
          placeholder: input.placeholder,
          required: input.required,
        })),
      }));

      // Get buttons
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]'))
        .filter(b => b.offsetParent !== null)
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
   * Click element by selector or text
   */
  async click(selector) {
    if (!this.page) throw new Error('Browser not launched');

    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.click(selector);
      return { success: true };
    } catch (error) {
      // Try clicking by text content
      try {
        const element = await this.page.evaluateHandle((text) => {
          const elements = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"]'));
          return elements.find(el => el.innerText.includes(text) || el.value?.includes(text));
        }, selector);

        if (element) {
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
   */
  async type(selector, text, options = {}) {
    if (!this.page) throw new Error('Browser not launched');

    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.type(selector, text, { delay: 50, ...options });
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
    return await this.page.evaluate(script, ...args);
  }

  /**
   * Get raw HTML content from page
   */
  async getHTML() {
    if (!this.page) throw new Error('Browser not launched');

    return await this.page.evaluate(() => {
      return document.documentElement.outerHTML;
    });
  }

  /**
   * Tab Management Methods
   */

  /**
   * Create new tab
   * @param {string} url - Optional URL to navigate to
   * @returns {Promise<string>} Tab ID
   */
  async createTab(url = 'about:blank') {
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
      await newPage.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    }

    console.log(`✓ Created new tab: ${tabId}`);
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
   */
  async gotoInTab(tabId, url) {
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

      return true;
    } catch (error) {
      console.error(`Navigation error in tab ${tabId}:`, error.message);
      return false;
    }
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
}
