import { SubAgent } from './SubAgent.js';
import { HTMLAnalyzerAgent } from './HTMLAnalyzerAgent.js';
import { VisionFallbackAgent } from './VisionFallbackAgent.js';
import { HumanAssistanceManager } from '../utils/HumanAssistanceManager.js';
import { detectHumanRequired, shouldRequestHumanHelp } from '../utils/DetectionUtils.js';
import { confirmAction } from '../utils/interactivePrompts.js';

/**
 * Main Agent orchestrates browser automation with autonomous decision-making
 * Now with HTML analysis, Vision fallback, and human assistance
 */
export class MainAgent {
  constructor(browserManager, claudeClient, contextManager) {
    this.browserManager = browserManager;
    this.claudeClient = claudeClient;
    this.contextManager = contextManager;
    this.htmlAnalyzer = new HTMLAnalyzerAgent(claudeClient, browserManager); // NEW v2.2: Pass browserManager for visibility checks
    this.visionFallback = new VisionFallbackAgent(claudeClient, browserManager);
    this.humanAssistance = new HumanAssistanceManager();
    this.subAgents = new Map();
    this.currentGoal = null;
    this.maxSteps = 50;
    this.stepCount = 0;
    this.lastHtmlSummary = null; // Store compact HTML summary
    this.screenshotCount = 0; // Track screenshots to avoid overuse
    this.recentActions = []; // Track recent actions to detect loops
  }

  /**
   * Execute user goal autonomously
   */
  async executeGoal(goal, options = {}) {
    this.currentGoal = goal;
    this.stepCount = 0;

    console.log('\n' + '='.repeat(60));
    console.log('🤖 Starting autonomous browser automation');
    console.log(`Goal: ${goal}`);
    console.log('='.repeat(60));

    try {
      while (this.stepCount < this.maxSteps) {
        this.stepCount++;
        console.log(`\n--- Step ${this.stepCount}/${this.maxSteps} ---`);

        // NEW v2.2: Sync tabs with actual browser state before each step
        // This handles cases where tabs were opened/closed outside of BrowserManager control
        await this.browserManager.syncTabs();

        // Check if user aborted via human assistance
        if (this.humanAssistance.shouldAbort()) {
          console.log('\n❌ Task aborted by user');
          return { success: false, aborted: true };
        }

        // Get current page state
        const currentUrl = await this.browserManager.getCurrentUrl();
        console.log(`Current URL: ${currentUrl || 'No page loaded'}`);
        console.log(`Active Tab: ${this.browserManager.getActiveTabId()}`);

        // Update tabs information in context
        const allTabs = await this.browserManager.getAllTabs();
        this.contextManager.updateTabs(allTabs);

        // Get page content if browser is on a page
        let pageContent = null;
        let htmlAnalysis = null;

        if (currentUrl && currentUrl !== 'about:blank') {
          // Get basic page content
          pageContent = await this.browserManager.getPageContent();
          console.log(`Page: ${pageContent.title}`);

          // Get HTML for analysis
          const html = await this.browserManager.getHTML();

          // Check for situations requiring human help (CAPTCHA, 2FA, etc.)
          // But skip if recently resolved or explicitly skipped
          const shouldCheckHumanRequired =
            !this.humanAssistance.wasRecentlyResolved('captcha', currentUrl) &&
            !this.humanAssistance.wasRecentlyResolved('2fa', currentUrl) &&
            !this.humanAssistance.shouldSkip('human_required', currentUrl);

          if (shouldCheckHumanRequired) {
            const humanRequired = detectHumanRequired(pageContent, html);

            if (humanRequired.humanRequired) {
              console.log('\n⚠️  Human assistance may be required!');
              console.log('Reasons:', humanRequired.reasons.join(', '));

              // IMPROVED: For CAPTCHA, double-check visibility before requesting help
              if (humanRequired.details.captcha) {
                const captchaVisibility = await this.browserManager.checkCaptchaVisibility();

                if (!captchaVisibility.hasVisibleCaptcha) {
                  console.log('ℹ️  CAPTCHA elements detected but NOT visible - likely passive scripts, continuing...');
                  // Mark as resolved to prevent re-detection on next step
                  this.humanAssistance.markResolved('captcha', currentUrl, 2);
                  continue;
                }

                console.log('✓ Visible CAPTCHA confirmed:', captchaVisibility.visibleElements.map(e => e.type).join(', '));
              }

              const assistanceResult = await this.handleHumanRequired(humanRequired, currentUrl);

              if (assistanceResult.aborted) {
                return { success: false, aborted: true };
              }

              if (assistanceResult.skipped) {
                // Add to skip list if user chose to skip
                this.humanAssistance.addToSkipList('human_required', currentUrl, 5);
                continue; // Skip this step
              }

              // Continue after human help
              continue;
            }
          }

          // Perform HTML analysis (DOM parsing + Claude semantic analysis)
          // This runs in SEPARATE context to avoid bloating main conversation
          htmlAnalysis = await this.htmlAnalyzer.analyzePage(html, currentUrl, goal);

          if (htmlAnalysis.success) {
            console.log(`📄 HTML Analysis complete (${htmlAnalysis.semanticAnalysis?.pageType || 'unknown'})`);

            // IMPROVED: Use compact summary instead of full analysis
            const compactSummary = this.htmlAnalyzer.getCompactSummary(htmlAnalysis);

            console.log(`✓ Extracted ${compactSummary.actionableElements?.length || 0} actionable elements (buttons, links, clickable blocks) with selectors`);
            console.log(`✓ Extracted ${compactSummary.forms?.length || 0} forms with input selectors`);

            // Store compact summary for context
            this.lastHtmlSummary = compactSummary;
          } else {
            console.log('⚠️  HTML analysis failed, will use basic content');
            this.lastHtmlSummary = null;
          }

          // Update context with compact analysis (not full HTML!)
          const summary = this.contextManager.summarizePageContent(pageContent);

          // NEW v2.2: Check for active overlays/modals and update context
          const overlayStatus = await this.browserManager.getPageOverlayStatus();
          this.contextManager.updateOverlayStatus(overlayStatus);

          if (overlayStatus.hasActiveOverlays) {
            console.log(`⚠️  Detected ${overlayStatus.modalCount} active overlay(s)/modal(s)`);
          }
          this.contextManager.currentPageSummary = {
            ...summary,
            // Only store compact summary, not full analysis
            compactHtmlSummary: this.lastHtmlSummary,
          };
        }

        // Get next decision from Claude
        const context = this.contextManager.getFullContext(goal);
        const decision = await this.getNextAction(context, pageContent, htmlAnalysis);

        if (!decision.success) {
          console.error('Failed to get decision:', decision.error);
          break;
        }

        const action = decision.decision;
        console.log(`\n💭 Thought: ${action.thought}`);
        console.log(`🎯 Action: ${action.action}`);

        // Check if task is complete
        if (action.action === 'complete') {
          console.log('\n' + '='.repeat(60));
          console.log('✅ Goal completed!');
          console.log(`Summary: ${action.summary || 'Task finished successfully'}`);
          console.log('='.repeat(60));
          return { success: true, summary: action.summary };
        }

        // IMPROVED: Check for infinite loops
        const loopDetected = this.detectLoop(action);
        if (loopDetected) {
          console.log('\n⚠️  Loop detected! Same action repeated multiple times.');
          console.log('Requesting human assistance to break the loop...');

          const helpResult = await this.humanAssistance.requestHelp(
            'AI is stuck in a loop - same action repeated',
            {
              url: currentUrl,
              details: {
                repeatedAction: action.action,
                recentActions: this.recentActions.slice(-5),
              },
            }
          );

          if (helpResult.aborted) {
            return { success: false, aborted: true };
          }

          // Clear recent actions to reset loop detection
          this.recentActions = [];
          continue;
        }

        // Check if action needs confirmation
        if (action.needsConfirmation || this.isDestructiveAction(action)) {
          const confirmed = await confirmAction(action);
          if (!confirmed) {
            console.log('❌ Action cancelled by user');

            // Ask Claude for alternative approach
            this.contextManager.addAction('user_cancelled', {
              action: action.action,
              reason: 'User did not confirm destructive action',
            });
            continue;
          }
          console.log('✓ Action confirmed by user');
        }

        // Execute the action
        const result = await this.executeAction(action);

        // Add to context
        this.contextManager.addAction(action, result);

        // Display result
        if (result.success === false) {
          console.log(`❌ Action failed: ${result.error || 'Unknown error'}`);

          // Check if we should request human help
          if (shouldRequestHumanHelp(result.error || '', 0, 3)) {
            const helpResult = await this.humanAssistance.requestElementHelp(
              action.parameters?.selector || action.parameters?.text || 'unknown',
              pageContent,
              0
            );

            if (helpResult.aborted) {
              return { success: false, aborted: true };
            }

            if (helpResult.resolved && helpResult.newSelector) {
              // Try again with new selector
              action.parameters.selector = helpResult.newSelector;
              const retryResult = await this.executeAction(action);
              if (retryResult.success) {
                console.log('✓ Succeeded with user-provided selector');
                continue;
              }
            }

            if (helpResult.skipped) {
              continue;
            }
          }

          // Try Vision fallback if HTML failed
          if (htmlAnalysis && !htmlAnalysis.success) {
            console.log('\n📸 Trying Vision API fallback...');
            const visionAnalysis = await this.visionFallback.analyzeWithVision(goal, `Failed action: ${action.action}`);

            if (visionAnalysis.success) {
              console.log('✓ Vision analysis successful, retrying...');
              // Use vision insights to retry
              continue;
            }
          }

          // Try to recover with SubAgent
          if (options.useSubAgents !== false) {
            console.log('Attempting recovery with SubAgent...');
            const recovered = await this.recoverWithSubAgent(action, result);
            if (recovered.success) {
              console.log('✓ Recovered successfully');
              continue;
            }
          }
        } else {
          console.log('✓ Action completed successfully');
        }

        // Small delay between actions
        await this.wait(1);
      }

      // Max steps reached
      console.log('\n⚠️ Maximum steps reached without completing goal');
      return {
        success: false,
        error: 'Maximum steps reached',
        stepsCompleted: this.stepCount,
      };
    } catch (error) {
      console.error('\n❌ Fatal error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Handle situations requiring human assistance
   */
  async handleHumanRequired(humanRequired, currentUrl) {
    const { details } = humanRequired;

    if (details.captcha) {
      return await this.humanAssistance.requestCaptchaHelp(details.captcha, currentUrl);
    }

    if (details.twoFA) {
      const result = await this.humanAssistance.request2FAHelp(details.twoFA, currentUrl);

      // If user provided 2FA code, try to enter it
      if (result.code && result.resolved) {
        const pageContent = await this.browserManager.getPageContent();

        // Find code input field
        if (pageContent.forms && pageContent.forms.length > 0) {
          for (const form of pageContent.forms) {
            for (const input of form.inputs) {
              if (input.name?.includes('code') || input.name?.includes('otp') || input.id?.includes('code')) {
                // Type the code
                const selector = input.id ? `#${input.id}` : `[name="${input.name}"]`;
                await this.browserManager.type(selector, result.code);
                console.log('✓ Entered 2FA code');
                await this.wait(2);
                break;
              }
            }
          }
        }
      }

      return result;
    }

    if (details.ambiguity) {
      return await this.humanAssistance.requestAmbiguityHelp(details.ambiguity, currentUrl);
    }

    // Generic human assistance request
    return await this.humanAssistance.requestHelp(
      humanRequired.reasons.join(', '),
      { url: currentUrl, details }
    );
  }

  /**
   * Get next action from Claude
   */
  async getNextAction(context, pageContent, htmlAnalysis) {
    let prompt = context;

    // IMPROVED: Add compact HTML summary if available (instead of full analysis)
    if (this.lastHtmlSummary && this.lastHtmlSummary.available) {
      const summary = this.lastHtmlSummary;

      prompt += `\n\n## Page Analysis Summary (from HTML parsing)\n`;
      prompt += `Page Type: ${summary.pageType}\n`;
      prompt += `Purpose: ${summary.pagePurpose}\n`;

      // Add actionable elements with SELECTORS
      if (summary.actionableElements && summary.actionableElements.length > 0) {
        prompt += `\n### Actionable Elements (buttons, links, clickable blocks):\n`;
        summary.actionableElements.slice(0, 12).forEach((elem, i) => {
          const type = elem.type === 'button' ? 'Button' :
                      elem.type === 'link' ? 'Link' :
                      elem.type === 'clickable-block' ? 'Clickable' : 'Element';

          prompt += `${i + 1}. ${type}: "${elem.displayText}" → selector: \`${elem.cssSelector}\``;
          if (elem.disabled) prompt += ` [DISABLED]`;
          if (elem.clickableBy) prompt += ` [${elem.clickableBy}]`;
          if (elem.href) prompt += ` → ${elem.href}`;
          prompt += '\n';
        });
      }

      // Add forms with input selectors
      if (summary.forms && summary.forms.length > 0) {
        prompt += `\n### Forms (with input selectors):\n`;
        summary.forms.forEach((form, i) => {
          prompt += `Form ${i + 1} (${form.method}): ${form.inputCount} inputs\n`;
          form.inputs.forEach(input => {
            prompt += `  - ${input.type}`;
            if (input.label) prompt += ` "${input.label}"`;
            if (input.selector) prompt += ` → selector: \`${input.selector}\``;
            prompt += '\n';
          });
        });
      }

      // Add recommended actions
      if (summary.keyActions && summary.keyActions.length > 0) {
        prompt += `\n### Recommended Actions:\n`;
        summary.keyActions.forEach(action => {
          prompt += `- ${action}\n`;
        });
      }

      // Add potential issues
      if (summary.potentialIssues && summary.potentialIssues.length > 0) {
        prompt += `\n### Potential Issues:\n`;
        summary.potentialIssues.forEach(issue => {
          prompt += `- ${issue}\n`;
        });
      }

      prompt += `\nIMPORTANT: Use the provided CSS selectors for click() and type() actions. They are optimized for reliability.\n`;
    }

    return await this.claudeClient.getDecision(
      'You are an autonomous browser automation agent with HTML analysis capabilities. Use HTML analysis and provided CSS selectors instead of requesting screenshots when possible.',
      prompt,
      true // Include history for better context
    );
  }

  /**
   * Execute an action
   */
  async executeAction(action) {
    const { action: actionType, parameters = {} } = action;

    try {
      switch (actionType) {
        case 'navigate':
          const navSuccess = await this.browserManager.goto(parameters.url);
          await this.wait(2); // Wait for page load
          return { success: navSuccess };

        case 'click':
          // NEW v2.2.1: Handle different selector formats
          if (typeof parameters.selector === 'object' && parameters.selector !== null) {
            // Object format: { selector: "div.option", text: "Программист" }
            return await this.browserManager.click(parameters.selector);
          } else {
            // String format: "div.option" OR "Программист" (text fallback)
            return await this.browserManager.click(parameters.selector || parameters.text);
          }

        case 'type':
          return await this.browserManager.type(parameters.selector, parameters.text);

        case 'wait':
          await this.wait(parameters.seconds || 2);
          return { success: true };

        case 'scroll':
          await this.browserManager.evaluate((direction) => {
            const distance = direction === 'down' ? 500 : -500;
            window.scrollBy(0, distance);
          }, parameters.direction || 'down');
          return { success: true };

        case 'screenshot':
          this.screenshotCount++;
          if (this.screenshotCount > 3) {
            console.log('⚠️  Warning: Too many screenshots. Prefer HTML analysis for better efficiency.');
          }
          const screenshot = await this.browserManager.screenshot();
          console.log(`📸 Screenshot taken (${this.screenshotCount} total)`);
          return { success: true, screenshot };

        case 'evaluate':
          const result = await this.browserManager.evaluate(parameters.script);
          return { success: true, result };

        case 'press_enter':
          await this.browserManager.page.keyboard.press('Enter');
          return { success: true };

        case 'go_back':
          await this.browserManager.page.goBack();
          await this.wait(2);
          return { success: true };

        // Tab management actions
        case 'create_tab':
          const tabId = await this.browserManager.createTab(parameters.url);
          return { success: true, tabId };

        case 'switch_tab':
          await this.browserManager.switchTab(parameters.tabId);
          return { success: true };

        case 'close_tab':
          const closed = await this.browserManager.closeTab(parameters.tabId);
          return { success: closed };

        case 'list_tabs':
          const tabs = await this.browserManager.getAllTabs();
          console.log('\n📑 Open tabs:');
          tabs.forEach(tab => {
            console.log(`  ${tab.active ? '→' : ' '} ${tab.id}: ${tab.title} (${tab.url})`);
          });
          return { success: true, tabs };

        case 'find_tab':
          const foundTabId = await this.browserManager.findTabByUrl(parameters.urlPattern);
          if (foundTabId) {
            return { success: true, tabId: foundTabId };
          }
          return { success: false, error: 'Tab not found' };

        // NEW v2.2: Dismiss modal/overlay
        case 'dismiss_modal':
          const modals = await this.browserManager.detectModals();
          if (modals.length === 0) {
            return { success: false, error: 'No modals detected' };
          }

          const modalIndex = parameters.modalIndex || 0;
          if (modalIndex >= modals.length) {
            return { success: false, error: `Modal index ${modalIndex} out of range (${modals.length} modals found)` };
          }

          const modal = modals[modalIndex];
          console.log(`🔄 Attempting to dismiss modal: ${modal.type}`);

          const dismissResult = await this.browserManager.dismissModal(modal);

          if (dismissResult.success) {
            console.log(`✅ Modal dismissed successfully using ${dismissResult.method}`);
            return { success: true, method: dismissResult.method };
          } else {
            console.log(`❌ Could not dismiss modal`);
            return { success: false, error: 'Could not dismiss modal', attemptedMethod: dismissResult.method };
          }

        // NEW: AI can explicitly request human help
        case 'request_human_help':
          console.log('\n🤖 AI requested human assistance');
          const reason = parameters.reason || 'AI needs help with current task';
          const currentUrl = await this.browserManager.getCurrentUrl();
          const pageContent = await this.browserManager.getPageContent();

          const helpResult = await this.humanAssistance.requestHelp(reason, {
            url: currentUrl,
            details: parameters.details || {},
            pageInfo: {
              title: pageContent.title,
              buttons: pageContent.buttons?.length || 0,
              forms: pageContent.forms?.length || 0,
            },
          });

          if (helpResult.aborted) {
            return { success: false, aborted: true };
          }

          // Return user-provided data if available
          return {
            success: helpResult.resolved,
            humanHelped: true,
            action: helpResult.method || 'manual',
            userData: helpResult.userData || null, // Include user data if provided
            message: helpResult.userData
              ? `User provided: ${helpResult.userData}`
              : 'User completed manually',
          };

        default:
          return { success: false, error: `Unknown action: ${actionType}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if action is destructive and needs confirmation
   */
  isDestructiveAction(action) {
    const destructiveActions = [
      'submit_form',
      'delete',
      'purchase',
      'send_message',
      'post',
      'payment',
    ];

    // Check action type
    if (destructiveActions.some(da => action.action.includes(da))) {
      return true;
    }

    // Check parameters for sensitive operations
    if (action.parameters) {
      const params = JSON.stringify(action.parameters).toLowerCase();
      if (
        params.includes('delete') ||
        params.includes('buy') ||
        params.includes('purchase') ||
        params.includes('payment') ||
        params.includes('submit')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detect if AI is stuck in a loop
   * @param {object} action - Current action
   * @returns {boolean} True if loop detected
   */
  detectLoop(action) {
    // Track current action
    const actionSignature = `${action.action}:${JSON.stringify(action.parameters || {})}`;
    this.recentActions.push({
      signature: actionSignature,
      action: action.action,
      timestamp: Date.now(),
    });

    // Keep only last 10 actions
    if (this.recentActions.length > 10) {
      this.recentActions = this.recentActions.slice(-10);
    }

    // Check if same action repeated 3+ times in last 5 actions
    const last5 = this.recentActions.slice(-5);
    const actionCounts = {};

    for (const item of last5) {
      actionCounts[item.signature] = (actionCounts[item.signature] || 0) + 1;
    }

    // If any action appears 3+ times in last 5 actions, it's a loop
    for (const count of Object.values(actionCounts)) {
      if (count >= 3) {
        return true;
      }
    }

    return false;
  }

  /**
   * Recover from error using SubAgent
   */
  async recoverWithSubAgent(failedAction, error) {
    const agentName = `Recovery-${this.stepCount}`;
    const subAgent = this.getOrCreateSubAgent(agentName);

    const currentUrl = await this.browserManager.getCurrentUrl();
    const pageContent = await this.browserManager.getPageContent();

    const taskDescription = `Recover from failed action: ${failedAction.action}. Error: ${error.error}. Try an alternative approach to achieve the same goal.`;

    const result = await subAgent.executeTask(taskDescription, {
      currentUrl,
      pageContent,
      previousError: error.error,
      previousAction: failedAction,
    });

    return result;
  }

  /**
   * Get or create SubAgent
   */
  getOrCreateSubAgent(name) {
    if (!this.subAgents.has(name)) {
      const subAgent = new SubAgent(name, this.claudeClient, this.browserManager);
      this.subAgents.set(name, subAgent);
    }
    return this.subAgents.get(name);
  }

  /**
   * Wait helper
   */
  async wait(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }

  /**
   * Get execution statistics
   */
  getStats() {
    return {
      stepCount: this.stepCount,
      maxSteps: this.maxSteps,
      contextSize: this.contextManager.getContext().length,
      historyLength: this.contextManager.getHistoryLength(),
      subAgentsUsed: this.subAgents.size,
      humanAssistanceRequests: this.humanAssistance.getHistory().length,
      visionAPIUsage: this.visionFallback.getStats().usageCount,
      screenshotCount: this.screenshotCount, // IMPROVED: Track screenshots
    };
  }

  /**
   * Reset agent state
   */
  reset() {
    this.currentGoal = null;
    this.stepCount = 0;
    this.screenshotCount = 0; // IMPROVED: Reset screenshot counter
    this.lastHtmlSummary = null; // IMPROVED: Clear HTML summary
    this.recentActions = []; // IMPROVED: Clear loop detection
    this.subAgents.clear();
    this.contextManager.reset();
    this.claudeClient.clearHistory();
    this.humanAssistance.clearHistory();
    this.visionFallback.resetStats();
  }
}
