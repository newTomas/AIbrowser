import { Browser, BrowserContext, Page } from 'playwright';
import { BrowserConfig, TabInfo } from '@/types';
import { logger } from '@/cli/Logger';

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Map<number, Page> = new Map();
  private nextPageId: number = 1;
  private activePageId: number | null = null;
  private config: BrowserConfig;

  constructor(config: BrowserConfig) {
    this.config = config;
  }

  /**
   * Initialize browser with persistent context
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing browser with persistent context...');

      const { chromium } = await import('playwright');

      this.browser = await chromium.launch({
        headless: this.config.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      });

      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true,
        acceptDownloads: true,
        javaScriptEnabled: true
      });

      // Set up event listeners for new pages
      this.context.on('page', (page) => {
        this.registerPage(page);
      });

      logger.info('Browser initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize browser:', error);
      throw error;
    }
  }

  /**
   * Register a new page in the manager
   */
  private registerPage(page: Page): number {
    const pageId = this.nextPageId++;
    this.pages.set(pageId, page);

    // Set as active if it's the first page
    if (this.activePageId === null) {
      this.activePageId = pageId;
    }

    page.on('close', () => {
      this.pages.delete(pageId);
      // If the closed page was active, set another page as active
      if (this.activePageId === pageId) {
        this.activePageId = this.pages.size > 0 ? this.pages.keys().next().value || null : null;
      }
      logger.debug(`Page ${pageId} closed`);
    });

    page.on('load', () => {
      logger.debug(`Page ${pageId} loaded: ${page.url()}`);
    });

    logger.debug(`Registered new page ${pageId}: ${page.url()}`);
    return pageId;
  }

  /**
   * Create a new tab/page
   */
  async createTab(): Promise<number> {
    if (!this.context) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }

    // Check if there are already pages (Playwright might create a blank page automatically)
    const existingPages = this.context.pages();
    if (existingPages.length > 0) {
      // Use existing pages instead of creating a new one
      for (const page of existingPages) {
        // Find first page that hasn't been registered yet
        let isAlreadyRegistered = false;
        for (const [registeredId, registeredPage] of this.pages) {
          if (registeredPage === page) {
            isAlreadyRegistered = true;
            break;
          }
        }

        if (!isAlreadyRegistered) {
          logger.debug(`Using existing page instead of creating new one`);
          return this.registerPage(page);
        }
      }
    }

    // Create a new page only if no existing pages are available
    const page = await this.context.newPage();
    return this.registerPage(page);
  }

  /**
   * Get existing page count
   */
  async getPageCount(): Promise<number> {
    if (!this.context) {
      return 0;
    }
    return this.context.pages().length;
  }

  /**
   * Get page by ID
   */
  getPage(pageId: number): Page | undefined {
    return this.pages.get(pageId);
  }

  /**
   * Get active page
   */
  getActivePage(): Page {
    if (this.pages.size === 0) {
      throw new Error('No pages available. Create a tab first.');
    }

    if (this.activePageId !== null) {
      const activePage = this.pages.get(this.activePageId);
      if (activePage) {
        return activePage;
      }
    }

    // Fallback to first available page
    const firstPage = this.pages.values().next().value;
    if (!firstPage) {
      throw new Error('No active page found');
    }
    return firstPage;
  }

  /**
   * Get active page ID
   */
  getActivePageId(): number | null {
    return this.activePageId;
  }

  /**
   * Get all tabs information
   */
  async getTabsInfo(): Promise<TabInfo[]> {
    const tabs: TabInfo[] = [];
    const activePageId = this.activePageId;

    for (const [pageId, page] of this.pages) {
      tabs.push({
        id: pageId,
        title: await page.title() || 'Untitled',
        url: page.url(),
        is_active: pageId === activePageId
      });
    }

    return tabs;
  }

  /**
   * Switch to specific tab/page
   */
  async switchToTab(pageId: number): Promise<void> {
    const page = this.getPage(pageId);
    if (!page) {
      throw new Error(`Page with ID ${pageId} not found`);
    }

    // Bring page to front
    await page.bringToFront();

    // Update active page tracking
    this.activePageId = pageId;

    logger.info(`Switched to tab ${pageId}: ${page.url()}`);
  }

  /**
   * Close specific tab/page
   */
  async closeTab(pageId: number): Promise<void> {
    const page = this.getPage(pageId);
    if (!page) {
      throw new Error(`Page with ID ${pageId} not found`);
    }

    await page.close();
    this.pages.delete(pageId);
    logger.debug(`Closed tab ${pageId}`);
  }

  /**
   * Navigate to URL in specific page
   */
  async navigate(pageId: number, url: string): Promise<void> {
    const page = this.getPage(pageId);
    if (!page) {
      throw new Error(`Page with ID ${pageId} not found`);
    }

    try {
      logger.info(`Navigating page ${pageId} to: ${url}`);
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeout
      });

      // Wait a bit for page to settle
      await page.waitForTimeout(1000);
      logger.debug(`Navigation completed for page ${pageId}`);
    } catch (error) {
      logger.error(`Navigation failed for page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Scroll page in specified direction
   */
  async scrollPage(pageId: number, direction: 'up' | 'down', amount: number = 500): Promise<void> {
    const page = this.getPage(pageId);
    if (!page) {
      throw new Error(`Page with ID ${pageId} not found`);
    }

    try {
      const scrollAmount = direction === 'down' ? amount : -amount;
      await page.evaluate((amount) => {
        (window as any).scrollBy(0, amount);
      }, scrollAmount);

      await page.waitForTimeout(500); // Wait for scroll to settle
      logger.debug(`Scrolled page ${pageId} ${direction} by ${amount}px`);
    } catch (error) {
      logger.error(`Scroll failed for page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Wait for page to be ready
   */
  async waitForPageReady(pageId: number, timeout: number = 10000): Promise<void> {
    const page = this.getPage(pageId);
    if (!page) {
      throw new Error(`Page with ID ${pageId} not found`);
    }

    try {
      await page.waitForLoadState('domcontentloaded', { timeout });
      logger.debug(`Page ${pageId} is ready`);
    } catch (error) {
      logger.error(`Page ${pageId} ready timeout:`, error);
      throw error;
    }
  }

  /**
   * Take screenshot of page
   */
  async takeScreenshot(pageId: number, path?: string): Promise<Buffer> {
    const page = this.getPage(pageId);
    if (!page) {
      throw new Error(`Page with ID ${pageId} not found`);
    }

    try {
      const screenshot = await page.screenshot({
        fullPage: true,
        type: 'png'
      });

      if (path) {
        require('fs').writeFileSync(path, screenshot);
        logger.debug(`Screenshot saved to ${path}`);
      }

      return screenshot;
    } catch (error) {
      logger.error(`Screenshot failed for page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Get page content
   */
  async getPageContent(pageId: number): Promise<string> {
    const page = this.getPage(pageId);
    if (!page) {
      throw new Error(`Page with ID ${pageId} not found`);
    }

    try {
      return await page.content();
    } catch (error) {
      logger.error(`Failed to get content for page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Close all pages and browser
   */
  async close(): Promise<void> {
    try {
      logger.info('Closing browser...');

      if (this.context) {
        await this.context.close();
        this.context = null;
      }

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }

      this.pages.clear();
      logger.info('Browser closed successfully');
    } catch (error) {
      logger.error('Error closing browser:', error);
      throw error;
    }
  }

  /**
   * Check if browser is initialized
   */
  isInitialized(): boolean {
    return this.browser !== null && this.context !== null;
  }

  /**
   * Get number of open tabs
   */
  getTabCount(): number {
    return this.pages.size;
  }
}