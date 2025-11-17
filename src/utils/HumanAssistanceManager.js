import { askForInput, askYesNo } from './confirmAction.js';

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
   * Request help for CAPTCHA challenge
   * @param {object} captchaInfo - Information about the CAPTCHA
   * @param {string} currentUrl - Current page URL
   * @returns {Promise<object>} Result with user action
   */
  async requestCaptchaHelp(captchaInfo, currentUrl) {
    console.log('\n' + '⚠️ '.repeat(25));
    console.log('🤖 CAPTCHA DETECTED - Human Assistance Required');
    console.log('━'.repeat(60));
    console.log(`Current URL: ${currentUrl}`);
    console.log(`CAPTCHA Type: ${captchaInfo.type || 'Unknown'}`);
    console.log(`Confidence: ${(captchaInfo.confidence * 100).toFixed(0)}%`);

    if (captchaInfo.indicators?.length > 0) {
      console.log('\nIndicators:');
      captchaInfo.indicators.forEach(indicator => {
        console.log(`  • ${indicator}`);
      });
    }

    console.log('\n📋 Actions available:');
    console.log('  1. Solve the CAPTCHA manually in the browser');
    console.log('  2. Wait for automatic resolution (if supported)');
    console.log('  3. Skip this step and continue');
    console.log('  4. Abort the task');

    const action = await askForInput('\nChoose action (1-4)');

    const result = {
      type: 'captcha',
      action,
      timestamp: new Date().toISOString(),
      url: currentUrl,
    };

    switch (action) {
      case '1':
        console.log('\n👉 Please solve the CAPTCHA in the browser window.');
        await askForInput('Press Enter when done...');
        result.resolved = true;
        result.method = 'manual';
        // Mark as resolved to prevent re-detection
        this.markResolved('captcha', currentUrl, 5);
        break;

      case '2':
        console.log('\n⏳ Waiting 30 seconds for automatic resolution...');
        await this.wait(30);
        result.resolved = 'auto_attempt';
        // Mark as resolved with shorter cooldown
        this.markResolved('captcha', currentUrl, 3);
        break;

      case '3':
        console.log('\n⏭️  Skipping CAPTCHA step...');
        result.resolved = false;
        result.skipped = true;
        // Add to skip list for next 5 steps
        this.addToSkipList('captcha', currentUrl, 5);
        break;

      case '4':
        console.log('\n❌ Aborting task...');
        result.resolved = false;
        result.aborted = true;
        break;

      default:
        console.log('\n❓ Invalid choice, defaulting to manual resolution.');
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
    console.log('\n' + '🔐 '.repeat(25));
    console.log('Two-Factor Authentication Required');
    console.log('━'.repeat(60));
    console.log(`Current URL: ${currentUrl}`);
    console.log(`Confidence: ${(twoFAInfo.confidence * 100).toFixed(0)}%`);

    if (twoFAInfo.indicators?.length > 0) {
      console.log('\nIndicators:');
      twoFAInfo.indicators.forEach(indicator => {
        console.log(`  • ${indicator}`);
      });
    }

    console.log('\n📋 Options:');
    console.log('  1. Enter the verification code');
    console.log('  2. Complete 2FA manually in browser');
    console.log('  3. Skip this step');
    console.log('  4. Abort the task');

    const action = await askForInput('\nChoose action (1-4)');

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
        break;

      case '2':
        console.log('\n👉 Please complete 2FA in the browser window.');
        await askForInput('Press Enter when authentication is complete...');
        result.resolved = true;
        result.method = 'manual';
        break;

      case '3':
        console.log('\n⏭️  Skipping 2FA step...');
        result.resolved = false;
        result.skipped = true;
        break;

      case '4':
        console.log('\n❌ Aborting task...');
        result.resolved = false;
        result.aborted = true;
        break;

      default:
        console.log('\n❓ Invalid choice, defaulting to manual completion.');
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
    console.log('\n' + '🔍 '.repeat(25));
    console.log('Element Not Found - Human Assistance Required');
    console.log('━'.repeat(60));
    console.log(`Failed selector: ${failedSelector}`);
    console.log(`Retry attempts: ${retryCount}`);
    console.log(`Current URL: ${pageContent.url}`);
    console.log(`Page title: ${pageContent.title}`);

    // Show available elements
    if (pageContent.buttons?.length > 0) {
      console.log('\n📌 Available buttons:');
      pageContent.buttons.slice(0, 10).forEach((btn, i) => {
        console.log(`  ${i + 1}. ${btn.text} ${btn.id ? `(id: ${btn.id})` : ''}`);
      });
    }

    if (pageContent.links?.length > 0) {
      console.log('\n🔗 Available links (first 10):');
      pageContent.links.slice(0, 10).forEach((link, i) => {
        console.log(`  ${i + 1}. ${link.text}`);
      });
    }

    console.log('\n📋 Options:');
    console.log('  1. Provide a different CSS selector');
    console.log('  2. Provide element text to search for');
    console.log('  3. Complete this action manually');
    console.log('  4. Skip this step');
    console.log('  5. Abort the task');

    const action = await askForInput('\nChoose action (1-5)');

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
        break;

      case '2':
        const text = await askForInput('Enter text to search for');
        result.searchText = text;
        result.resolved = true;
        break;

      case '3':
        console.log('\n👉 Please complete this action manually in the browser.');
        await askForInput('Press Enter when done...');
        result.resolved = true;
        result.method = 'manual';
        break;

      case '4':
        console.log('\n⏭️  Skipping this step...');
        result.resolved = false;
        result.skipped = true;
        break;

      case '5':
        console.log('\n❌ Aborting task...');
        result.resolved = false;
        result.aborted = true;
        break;

      default:
        console.log('\n❓ Invalid choice, skipping step.');
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
    console.log('\n' + '❓ '.repeat(25));
    console.log('Ambiguous Situation - Human Decision Required');
    console.log('━'.repeat(60));
    console.log(`Current URL: ${currentUrl}`);
    console.log(`Type: ${ambiguityInfo.type}`);
    console.log(`Confidence: ${(ambiguityInfo.confidence * 100).toFixed(0)}%`);

    if (ambiguityInfo.options?.length > 0) {
      console.log('\n📌 Available options:');
      ambiguityInfo.options.forEach((option, i) => {
        console.log(`  ${i + 1}. ${option.type}: ${option.text || option.action || 'Option ' + (i + 1)}`);
        if (option.count) {
          console.log(`     (Found ${option.count} similar items)`);
        }
      });
    }

    console.log('\n📋 Actions:');
    console.log('  • Enter the number of the option to select');
    console.log('  • Type "manual" to handle manually');
    console.log('  • Type "skip" to skip this decision');
    console.log('  • Type "abort" to abort the task');

    const choice = await askForInput('\nYour choice');

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
    } else if (choice.toLowerCase() === 'manual') {
      console.log('\n👉 Please complete this manually in the browser.');
      await askForInput('Press Enter when done...');
      result.resolved = true;
      result.method = 'manual';
    } else if (choice.toLowerCase() === 'skip') {
      console.log('\n⏭️  Skipping this decision...');
      result.resolved = false;
      result.skipped = true;
    } else if (choice.toLowerCase() === 'abort') {
      console.log('\n❌ Aborting task...');
      result.resolved = false;
      result.aborted = true;
    } else {
      console.log('\n❓ Invalid choice, skipping.');
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
    console.log('\n' + '🆘 '.repeat(25));
    console.log('Human Assistance Required');
    console.log('━'.repeat(60));
    console.log(`Reason: ${reason}`);

    if (context.url) {
      console.log(`Current URL: ${context.url}`);
    }

    if (context.details) {
      console.log('\nDetails:');
      console.log(JSON.stringify(context.details, null, 2));
    }

    console.log('\n📋 Options:');
    console.log('  1. Complete manually in browser');
    console.log('  2. Skip this step');
    console.log('  3. Abort the task');

    const action = await askForInput('\nChoose action (1-3)');

    const result = {
      type: 'generic',
      reason,
      action,
      timestamp: new Date().toISOString(),
      context,
    };

    switch (action) {
      case '1':
        console.log('\n👉 Please handle this manually in the browser.');
        await askForInput('Press Enter when done...');
        result.resolved = true;
        result.method = 'manual';
        break;

      case '2':
        console.log('\n⏭️  Skipping this step...');
        result.resolved = false;
        result.skipped = true;
        break;

      case '3':
        console.log('\n❌ Aborting task...');
        result.resolved = false;
        result.aborted = true;
        break;

      default:
        console.log('\n❓ Invalid choice, defaulting to manual completion.');
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

    const resolution = {
      type,
      url,
      timestamp: Date.now(),
      expiresAt: Date.now() + (cooldownMinutes * 60 * 1000),
    };

    this.resolvedIssues.push(resolution);

    console.log(`✓ [HumanAssistance] ${type} marked as resolved for ${cooldownMinutes} minutes`);
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

    const resolved = this.resolvedIssues.some(issue => {
      // Check if same type
      if (issue.type !== type) return false;

      // Check if same URL (exact match or starts with)
      const sameUrl = issue.url === url || url.startsWith(issue.url);

      // Check if still within cooldown
      const withinCooldown = now < issue.expiresAt;

      return sameUrl && withinCooldown;
    });

    if (resolved) {
      console.log(`ℹ️  [HumanAssistance] ${type} detection skipped - recently resolved`);
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
    const skipEntry = {
      type,
      url,
      stepsRemaining: steps,
    };

    this.skipList.push(skipEntry);

    console.log(`ℹ️  [HumanAssistance] ${type} added to skip list for ${steps} steps`);
  }

  /**
   * Check if issue should be skipped
   * @param {string} type - Issue type
   * @param {string} url - Current URL
   * @returns {boolean} True if should skip detection
   */
  shouldSkip(type, url) {
    const index = this.skipList.findIndex(entry => {
      return entry.type === type && (entry.url === url || url.startsWith(entry.url));
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
