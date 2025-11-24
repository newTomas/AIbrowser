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
  private lastActivatedPageId: number | null = null;

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
   * Register a new page in the manager with enhanced safety
   */
  private registerPage(page: Page): number {
    // Check if this page is already registered (more efficient check)
    for (const [existingId, existingPage] of this.pages) {
      if (existingPage === page) {
        logger.debug(`Page already registered with ID ${existingId}, returning existing ID`);
        return existingId;
      }
    }

    // Generate unique ID atomically
    const pageId = this.nextPageId++;

    // Register the page first, then set up event listeners
    this.pages.set(pageId, page);

    try {
      logger.debug(`Registering new page with ID ${pageId}: ${page.url()}`);

      // Set up event listeners with error handling
      const setupEventListeners = () => {
        try {
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

          // Add event listeners to track when this page becomes active
          page.on('popup', () => {
            this.lastActivatedPageId = pageId;
            logger.debug(`Page ${pageId} triggered popup event`);
          });
        } catch (error) {
          logger.warning(`Failed to set up event listeners for page ${pageId}:`, error);
          // Continue anyway - the page is registered even if listeners fail
        }
      };

      setupEventListeners();
      return pageId;

    } catch (error) {
      // If registration fails, clean up
      this.pages.delete(pageId);
      logger.error(`Failed to register page ${pageId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new tab/page with synchronization to prevent race conditions
   */
  async createTab(): Promise<number> {
    if (!this.context) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }

    // Get all existing pages from context
    const existingPages = this.context.pages();

    // Find pages that are not yet registered
    const unregisteredPages = existingPages.filter(page => {
      return !Array.from(this.pages.values()).includes(page);
    });

    if (unregisteredPages.length > 0) {
      // Use the first unregistered page
      const page = unregisteredPages[0];
      logger.debug(`Using existing page instead of creating new one`);
      return this.registerPage(page);
    } else {
      // Create a new page only if no existing pages are available
      logger.debug('No unregistered pages found, creating new page');
      const page = await this.context.newPage();
      return this.registerPage(page);
    }
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
   * Get active page (determine from actual browser state)
   */
  async getActivePage(): Promise<Page> {
    if (this.pages.size === 0) {
      throw new Error('No pages available. Create a tab first.');
    }

    // First try to find focused page
    for (const [pageId, page] of this.pages) {
      try {
        const isFocused = await page.evaluate(() => {
          return document.hasFocus();
        });

        if (isFocused) {
          this.activePageId = pageId;
          return page;
        }
      } catch (error) {
        // Page might be closed or inaccessible, skip
        logger.debug(`Failed to check focus for page ${pageId}:`, error);
      }
    }

    // If no page has focus, use the most recently used from context
    if (this.context) {
      try {
        const contextPages = this.context.pages();
        for (const contextPage of contextPages) {
          for (const [pageId, mappedPage] of this.pages) {
            if (mappedPage === contextPage) {
              this.activePageId = pageId;
              return mappedPage;
            }
          }
        }
      } catch (error) {
        logger.debug(`Failed to determine active page from context:`, error);
      }
    }

    // Final fallback - first available page
    const firstPage = this.pages.values().next().value;
    if (!firstPage) {
      throw new Error('No active page found');
    }

    // Update internal tracking
    for (const [pageId, page] of this.pages) {
      if (page === firstPage) {
        this.activePageId = pageId;
        break;
      }
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
   * Get all tabs information with smart active tab detection
   */
  async getTabsInfo(): Promise<TabInfo[]> {
    const tabs: TabInfo[] = [];

    // Get all page info first
    for (const [pageId, page] of this.pages) {
      try {
        tabs.push({
          id: pageId,
          title: await page.title() || 'Untitled',
          url: page.url(),
          is_active: false // Will be set below
        });
      } catch (error) {
        logger.warning(`Failed to get info for page ${pageId}:`, error);
      }
    }

    // Determine active page using multiple strategies
    let actualActivePageId: number | null = null;

    // Strategy 1: Use last manually activated page (most reliable)
    if (this.lastActivatedPageId && this.pages.has(this.lastActivatedPageId)) {
      actualActivePageId = this.lastActivatedPageId;
    }

    // Strategy 2: Try to determine which page has focus via JavaScript
    if (actualActivePageId === null) {
      for (const [pageId, page] of this.pages) {
        try {
          const isFocused = await page.evaluate(() => document.hasFocus());
          if (isFocused) {
            actualActivePageId = pageId;
            break;
          }
        } catch (error) {
          // Page might be closed or inaccessible
          logger.debug(`Failed to check focus for page ${pageId}:`, error);
        }
      }
    }

    // Strategy 3: Use page order from Playwright context (fallback)
    if (actualActivePageId === null && this.context) {
      try {
        const contextPages = this.context.pages();
        for (const contextPage of contextPages) {
          for (const [pageId, mappedPage] of this.pages) {
            if (mappedPage === contextPage) {
              actualActivePageId = pageId;
              break;
            }
          }
          if (actualActivePageId !== null) break;
        }
      } catch (error) {
        logger.debug(`Failed to determine active page from context:`, error);
      }
    }

    // Strategy 4: Final fallback - use first page
    if (actualActivePageId === null && this.pages.size > 0) {
      actualActivePageId = this.pages.keys().next().value || null;
    }

    // Set the active flag
    tabs.forEach(tab => {
      tab.is_active = tab.id === actualActivePageId;
    });

    // Update internal tracking
    this.activePageId = actualActivePageId;

    logger.debug(`Found ${tabs.length} tabs, determined active: ${actualActivePageId} (lastActivated: ${this.lastActivatedPageId})`);
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

    // Bring page to front - this will make it the active page
    await page.bringToFront();

    // Track that this page was last activated
    this.lastActivatedPageId = pageId;

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
        // Validate and sanitize file path to prevent path traversal
        const sanitizedPath = this.sanitizeFilePath(path);
        if (!sanitizedPath) {
          throw new Error('Invalid file path for screenshot: path traversal detected');
        }

        require('fs').writeFileSync(sanitizedPath, screenshot);
        logger.debug(`Screenshot saved to ${sanitizedPath}`);
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

  /**
   * Sanitize file path to prevent path traversal attacks
   */
  private sanitizeFilePath(path: string): string | null {
    try {
      // Import path module
      const pathModule = require('path');
      const fs = require('fs');

      // Resolve the absolute path
      const absolutePath = pathModule.resolve(path);

      // Define allowed directories (current working directory and subdirectories)
      const allowedBase = process.cwd();

      // Check if the resolved path is within allowed directories
      if (!absolutePath.startsWith(allowedBase)) {
        logger.warning(`Path traversal detected: ${path} -> ${absolutePath} (outside allowed ${allowedBase})`);
        return null;
      }

      // Ensure the directory exists
      const dir = pathModule.dirname(absolutePath);
      if (!fs.existsSync(dir)) {
        logger.warning(`Directory does not exist: ${dir}`);
        return null;
      }

      // Check file extension to ensure it's a valid image format
      const validExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.gif'];
      const ext = pathModule.extname(absolutePath).toLowerCase();
      if (ext && !validExtensions.includes(ext)) {
        logger.warning(`Invalid file extension for screenshot: ${ext}`);
        return null;
      }

      return absolutePath;
    } catch (error) {
      logger.error('Error sanitizing file path:', error);
      return null;
    }
  }
}