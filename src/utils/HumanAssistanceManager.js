import { askForInput, selectFromMenu, intro, note } from './interactivePrompts.js';

/**
 * Manages requests for human assistance during automation
 */
export class HumanAssistanceManager {
  constructor() {
    this.assistanceHistory = [];
    this.resolvedIssues = []; // Track resolved issues with cooldown
    this.skipList = []; // Temporary skip list for detection
  }

  /**
   * Extract domain from URL for cooldown matching
   * @param {string} url - Full URL
   * @returns {string} Domain (e.g., 'example.com')
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      return url; // Return original if parsing fails
    }
  }

  /**
   * Request help for CAPTCHA challenge
   * @param {object} captchaInfo - Information about the CAPTCHA
   * @param {string} currentUrl - Current page URL
   * @returns {Promise<object>} Result with user action
   */
  async requestCaptchaHelp(captchaInfo, currentUrl) {
    intro('🤖 CAPTCHA DETECTED - Human Assistance Required');

    let details = `Current URL: ${currentUrl}\n`;
    details += `CAPTCHA Type: ${captchaInfo.type || 'Unknown'}\n`;
    details += `Confidence: ${(captchaInfo.confidence * 100).toFixed(0)}%`;

    if (captchaInfo.indicators?.length > 0) {
      details += '\n\nIndicators:\n';
      captchaInfo.indicators.forEach(indicator => {
        details += `  • ${indicator}\n`;
      });
    }

    note(details, 'warning');

    const action = await selectFromMenu('Choose action', [
      { value: '1', label: 'Solve CAPTCHA manually', hint: 'Pause automation for manual solving' },
      { value: '2', label: 'Wait for automatic resolution', hint: 'Wait 30 seconds' },
      { value: '3', label: 'Skip this step', hint: 'Continue without solving' },
      { value: '4', label: 'Abort task', hint: 'Stop automation completely' },
    ]);

    const result = {
      type: 'captcha',
      action,
      timestamp: new Date().toISOString(),
      url: currentUrl,
    };

    switch (action) {
      case '1':
        note('Please solve the CAPTCHA in the browser window', 'info');
        await askForInput('Press Enter when done...');
        result.resolved = true;
        result.method = 'manual';
        // Mark as resolved to prevent re-detection
        this.markResolved('captcha', currentUrl, 5);
        break;

      case '2':
        note('Waiting 30 seconds for automatic resolution...', 'info');
        await this.wait(30);
        result.resolved = 'auto_attempt';
        // Mark as resolved with shorter cooldown
        this.markResolved('captcha', currentUrl, 3);
        break;

      case '3':
        note('Skipping CAPTCHA step', 'info');
        result.resolved = false;
        result.skipped = true;
        // Add to skip list for next 5 steps
        this.addToSkipList('captcha', currentUrl, 5);
        break;

      case '4':
        note('Aborting task', 'error');
        result.resolved = false;
        result.aborted = true;
        break;

      default:
        note('Invalid choice, defaulting to manual resolution', 'warning');
        await askForInput('Press Enter when you have solved the CAPTCHA...');
        result.resolved = true;
        result.method = 'manual';
        // Mark as resolved
        this.markResolved('captcha', currentUrl, 5);
    }

    this.assistanceHistory.push(result);
    return result;
  }

  /**
   * Request help for 2FA authentication
   * @param {object} twoFAInfo - Information about 2FA prompt
   * @param {string} currentUrl - Current page URL
   * @returns {Promise<object>} Result with code or action
   */
  async request2FAHelp(twoFAInfo, currentUrl) {
    intro('🔐 Two-Factor Authentication Required');

    let details = `Current URL: ${currentUrl}\n`;
    details += `Confidence: ${(twoFAInfo.confidence * 100).toFixed(0)}%`;

    if (twoFAInfo.indicators?.length > 0) {
      details += '\n\nIndicators:\n';
      twoFAInfo.indicators.forEach(indicator => {
        details += `  • ${indicator}\n`;
      });
    }

    note(details, 'info');

    const action = await selectFromMenu('Choose action', [
      { value: '1', label: 'Enter verification code', hint: 'Type the 2FA code' },
      { value: '2', label: 'Complete manually in browser', hint: 'Pause for manual completion' },
      { value: '3', label: 'Skip this step', hint: 'Continue without 2FA' },
      { value: '4', label: 'Abort task', hint: 'Stop automation' },
    ]);

    const result = {
      type: '2fa',
      action,
      timestamp: new Date().toISOString(),
      url: currentUrl,
    };

    switch (action) {
      case '1':
        const code = await askForInput('Enter verification code');
        result.code = code;
        result.resolved = true;
        note('Verification code entered successfully', 'success');
        break;

      case '2':
        note('Please complete 2FA in the browser window', 'info');
        await askForInput('Press Enter when authentication is complete...');
        result.resolved = true;
        result.method = 'manual';
        break;

      case '3':
        note('Skipping 2FA step', 'info');
        result.resolved = false;
        result.skipped = true;
        break;

      case '4':
        note('Aborting task', 'error');
        result.resolved = false;
        result.aborted = true;
        break;

      default:
        note('Invalid choice, defaulting to manual completion', 'warning');
        await askForInput('Press Enter when 2FA is complete...');
        result.resolved = true;
        result.method = 'manual';
    }

    this.assistanceHistory.push(result);
    return result;
  }

  /**
   * Request help when element cannot be found
   * @param {string} failedSelector - Selector that failed
   * @param {object} pageContent - Current page content
   * @param {number} retryCount - Number of retries attempted
   * @returns {Promise<object>} Result with new selector or action
   */
  async requestElementHelp(failedSelector, pageContent, retryCount) {
    intro('🔍 Element Not Found - Human Assistance Required');

    let details = `Failed selector: ${failedSelector}\n`;
    details += `Retry attempts: ${retryCount}\n`;
    details += `Current URL: ${pageContent.url}\n`;
    details += `Page title: ${pageContent.title}`;

    // Show available elements
    if (pageContent.buttons?.length > 0) {
      details += '\n\n📌 Available buttons:\n';
      pageContent.buttons.slice(0, 10).forEach((btn, i) => {
        details += `  ${i + 1}. ${btn.text} ${btn.id ? `(id: ${btn.id})` : ''}\n`;
      });
    }

    if (pageContent.links?.length > 0) {
      details += '\n🔗 Available links (first 10):\n';
      pageContent.links.slice(0, 10).forEach((link, i) => {
        details += `  ${i + 1}. ${link.text}\n`;
      });
    }

    note(details, 'warning');

    const action = await selectFromMenu('Choose action', [
      { value: '1', label: 'Provide different CSS selector', hint: 'Enter custom selector' },
      { value: '2', label: 'Provide element text', hint: 'Search by text content' },
      { value: '3', label: 'Complete manually', hint: 'Handle in browser' },
      { value: '4', label: 'Skip this step', hint: 'Continue without action' },
      { value: '5', label: 'Abort task', hint: 'Stop automation' },
    ]);

    const result = {
      type: 'element_not_found',
      failedSelector,
      action,
      timestamp: new Date().toISOString(),
    };

    switch (action) {
      case '1':
        const newSelector = await askForInput('Enter CSS selector (e.g., #button-id, .class-name)');
        result.newSelector = newSelector;
        result.resolved = true;
        note(`Using selector: ${newSelector}`, 'success');
        break;

      case '2':
        const text = await askForInput('Enter text to search for');
        result.searchText = text;
        result.resolved = true;
        note(`Searching for text: ${text}`, 'success');
        break;

      case '3':
        note('Please complete this action manually in the browser', 'info');
        await askForInput('Press Enter when done...');
        result.resolved = true;
        result.method = 'manual';
        break;

      case '4':
        note('Skipping this step', 'info');
        result.resolved = false;
        result.skipped = true;
        break;

      case '5':
        note('Aborting task', 'error');
        result.resolved = false;
        result.aborted = true;
        break;

      default:
        note('Invalid choice, skipping step', 'warning');
        result.resolved = false;
        result.skipped = true;
    }

    this.assistanceHistory.push(result);
    return result;
  }

  /**
   * Request help for ambiguous situations
   * @param {object} ambiguityInfo - Information about ambiguous situation
   * @param {string} currentUrl - Current page URL
   * @returns {Promise<object>} Result with user choice
   */
  async requestAmbiguityHelp(ambiguityInfo, currentUrl) {
    intro('❓ Ambiguous Situation - Human Decision Required');

    let details = `Current URL: ${currentUrl}\n`;
    details += `Type: ${ambiguityInfo.type}\n`;
    details += `Confidence: ${(ambiguityInfo.confidence * 100).toFixed(0)}%`;

    if (ambiguityInfo.options?.length > 0) {
      details += '\n\n📌 Available options:\n';
      ambiguityInfo.options.forEach((option, i) => {
        details += `  ${i + 1}. ${option.type}: ${option.text || option.action || 'Option ' + (i + 1)}`;
        if (option.count) {
          details += ` (Found ${option.count} similar items)`;
        }
        details += '\n';
      });
    }

    note(details, 'warning');

    // Build menu options from ambiguity options + control actions
    const menuOptions = [];

    if (ambiguityInfo.options?.length > 0) {
      ambiguityInfo.options.forEach((option, i) => {
        menuOptions.push({
          value: `${i + 1}`,
          label: `${option.type}: ${option.text || option.action || 'Option ' + (i + 1)}`,
          hint: option.count ? `${option.count} similar items` : '',
        });
      });
    }

    menuOptions.push(
      { value: 'manual', label: 'Handle manually', hint: 'Complete in browser' },
      { value: 'skip', label: 'Skip this decision', hint: 'Continue without resolving' },
      { value: 'abort', label: 'Abort task', hint: 'Stop automation' }
    );

    const choice = await selectFromMenu('Your choice', menuOptions);

    const result = {
      type: 'ambiguity',
      ambiguityType: ambiguityInfo.type,
      choice,
      timestamp: new Date().toISOString(),
      url: currentUrl,
    };

    const choiceNum = parseInt(choice);
    if (!isNaN(choiceNum) && choiceNum > 0 && choiceNum <= ambiguityInfo.options?.length) {
      result.selectedOption = ambiguityInfo.options[choiceNum - 1];
      result.resolved = true;
    } else if (choice === 'manual') {
      note('Please complete this manually in the browser', 'info');
      await askForInput('Press Enter when done...');
      result.resolved = true;
      result.method = 'manual';
    } else if (choice === 'skip') {
      note('Skipping this decision', 'info');
      result.resolved = false;
      result.skipped = true;
    } else if (choice === 'abort') {
      note('Aborting task', 'error');
      result.resolved = false;
      result.aborted = true;
    } else {
      note('Invalid choice, skipping', 'warning');
      result.resolved = false;
      result.skipped = true;
    }

    this.assistanceHistory.push(result);
    return result;
  }

  /**
   * Generic request for human help
   * @param {string} reason - Reason for assistance
   * @param {object} context - Additional context
   * @returns {Promise<object>} Result
   */
  async requestHelp(reason, context = {}) {
    intro('🆘 Human Assistance Required');

    let details = `Reason: ${reason}`;

    if (context.url) {
      details += `\nCurrent URL: ${context.url}`;
    }

    if (context.details) {
      details += '\n\nDetails:\n';
      details += JSON.stringify(context.details, null, 2);
    }

    note(details, 'warning');

    const action = await selectFromMenu('Choose action', [
      { value: '1', label: 'Complete manually in browser', hint: 'Pause for manual completion' },
      { value: '2', label: 'Provide text/data', hint: 'Enter information for AI' },
      { value: '3', label: 'Skip this step', hint: 'Continue without action' },
      { value: '4', label: 'Abort task', hint: 'Stop automation' },
    ]);

    const result = {
      type: 'generic',
      reason,
      action,
      timestamp: new Date().toISOString(),
      context,
    };

    switch (action) {
      case '1':
        note('Please handle this manually in the browser', 'info');
        await askForInput('Press Enter when done...');
        result.resolved = true;
        result.method = 'manual';
        break;

      case '2':
        note('Please provide the requested information', 'info');
        const userData = await askForInput('Enter text/data');
        result.userData = userData;
        result.resolved = true;
        result.method = 'user_provided_data';
        note(`Data received: ${userData.slice(0, 50)}${userData.length > 50 ? '...' : ''}`, 'success');
        break;

      case '3':
        note('Skipping this step', 'info');
        result.resolved = false;
        result.skipped = true;
        break;

      case '4':
        note('Aborting task', 'error');
        result.resolved = false;
        result.aborted = true;
        break;

      default:
        note('Invalid choice, defaulting to manual completion', 'warning');
        await askForInput('Press Enter when done...');
        result.resolved = true;
        result.method = 'manual';
    }

    this.assistanceHistory.push(result);
    return result;
  }

  /**
   * Wait helper
   */
  async wait(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }

  /**
   * Get assistance history
   */
  getHistory() {
    return this.assistanceHistory;
  }

  /**
   * Check if task should be aborted based on history
   */
  shouldAbort() {
    return this.assistanceHistory.some(item => item.aborted === true);
  }

  /**
   * Mark issue as resolved with cooldown period
   * @param {string} type - Issue type (captcha, 2fa, element_not_found, etc.)
   * @param {string} url - URL where issue was resolved
   * @param {number} cooldownMinutes - Cooldown period in minutes (default: 5)
   */
  markResolved(type, url, cooldownMinutes = 5) {
    // Clean expired resolutions first
    this.clearExpiredResolutions();

    const domain = this.extractDomain(url);

    const resolution = {
      type,
      url,
      domain, // NEW: Store domain for matching
      timestamp: Date.now(),
      expiresAt: Date.now() + (cooldownMinutes * 60 * 1000),
    };

    this.resolvedIssues.push(resolution);

    console.log(`✓ [HumanAssistance] ${type} marked as resolved for ${cooldownMinutes} minutes (domain: ${domain})`);
  }

  /**
   * Check if issue was recently resolved (within cooldown period)
   * @param {string} type - Issue type
   * @param {string} url - Current URL
   * @returns {boolean} True if issue was recently resolved
   */
  wasRecentlyResolved(type, url) {
    this.clearExpiredResolutions();

    const now = Date.now();
    const currentDomain = this.extractDomain(url);

    const resolved = this.resolvedIssues.some(issue => {
      // Check if same type
      if (issue.type !== type) return false;

      // Check if still within cooldown
      const withinCooldown = now < issue.expiresAt;
      if (!withinCooldown) return false;

      // IMPROVED: Check by domain first (handles redirects after captcha solving)
      // If domains match, consider it resolved
      if (issue.domain && currentDomain === issue.domain) {
        return true;
      }

      // Fallback: Check if same URL (exact match or starts with)
      const sameUrl = issue.url === url || url.startsWith(issue.url);

      return sameUrl;
    });

    if (resolved) {
      console.log(`ℹ️  [HumanAssistance] ${type} detection skipped - recently resolved (domain: ${currentDomain})`);
    }

    return resolved;
  }

  /**
   * Add URL/type to skip list (temporary bypass for detection)
   * @param {string} type - Issue type
   * @param {string} url - URL to skip
   * @param {number} steps - Number of steps to skip (default: 5)
   */
  addToSkipList(type, url, steps = 5) {
    const domain = this.extractDomain(url);

    const skipEntry = {
      type,
      url,
      domain, // NEW: Store domain for matching
      stepsRemaining: steps,
    };

    this.skipList.push(skipEntry);

    console.log(`ℹ️  [HumanAssistance] ${type} added to skip list for ${steps} steps (domain: ${domain})`);
  }

  /**
   * Check if issue should be skipped
   * @param {string} type - Issue type
   * @param {string} url - Current URL
   * @returns {boolean} True if should skip detection
   */
  shouldSkip(type, url) {
    const currentDomain = this.extractDomain(url);

    const index = this.skipList.findIndex(entry => {
      if (entry.type !== type) return false;

      // IMPROVED: Check by domain first
      if (entry.domain && currentDomain === entry.domain) {
        return true;
      }

      // Fallback: Check by URL
      return entry.url === url || url.startsWith(entry.url);
    });

    if (index === -1) {
      return false;
    }

    // Decrement steps
    this.skipList[index].stepsRemaining--;

    // Remove if no steps remaining
    if (this.skipList[index].stepsRemaining <= 0) {
      console.log(`ℹ️  [HumanAssistance] ${type} removed from skip list`);
      this.skipList.splice(index, 1);
      return false;
    }

    console.log(`ℹ️  [HumanAssistance] ${type} skipped (${this.skipList[index].stepsRemaining} steps remaining)`);
    return true;
  }

  /**
   * Clear expired resolutions from the list
   */
  clearExpiredResolutions() {
    const now = Date.now();
    const originalLength = this.resolvedIssues.length;

    this.resolvedIssues = this.resolvedIssues.filter(issue => now < issue.expiresAt);

    const removed = originalLength - this.resolvedIssues.length;
    if (removed > 0) {
      console.log(`ℹ️  [HumanAssistance] Cleared ${removed} expired resolution(s)`);
    }
  }

  /**
   * Clear history
   */
  clearHistory() {
    this.assistanceHistory = [];
    this.resolvedIssues = [];
    this.skipList = [];
  }
}
