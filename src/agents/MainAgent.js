import { SubAgent } from './SubAgent.js';
import { HTMLAnalyzerAgent } from './HTMLAnalyzerAgent.js';
import { VisionFallbackAgent } from './VisionFallbackAgent.js';
import { HumanAssistanceManager } from '../utils/HumanAssistanceManager.js';
import { detectHumanRequired, shouldRequestHumanHelp } from '../utils/DetectionUtils.js';
import { confirmAction } from '../utils/confirmAction.js';

/**
 * Main Agent orchestrates browser automation with autonomous decision-making
 * Now with HTML analysis, Vision fallback, and human assistance
 */
export class MainAgent {
  constructor(browserManager, claudeClient, contextManager) {
    this.browserManager = browserManager;
    this.claudeClient = claudeClient;
    this.contextManager = contextManager;
    this.htmlAnalyzer = new HTMLAnalyzerAgent(claudeClient);
    this.visionFallback = new VisionFallbackAgent(claudeClient, browserManager);
    this.humanAssistance = new HumanAssistanceManager();
    this.subAgents = new Map();
    this.currentGoal = null;
    this.maxSteps = 50;
    this.stepCount = 0;
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

        // Check if user aborted via human assistance
        if (this.humanAssistance.shouldAbort()) {
          console.log('\n❌ Task aborted by user');
          return { success: false, aborted: true };
        }

        // Get current page state
        const currentUrl = await this.browserManager.getCurrentUrl();
        console.log(`Current URL: ${currentUrl || 'No page loaded'}`);
        console.log(`Active Tab: ${this.browserManager.getActiveTabId()}`);

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
              console.log('\n⚠️  Human assistance required!');
              console.log('Reasons:', humanRequired.reasons.join(', '));

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
          htmlAnalysis = await this.htmlAnalyzer.analyzePage(html, currentUrl, goal);

          if (htmlAnalysis.success) {
            console.log(`📄 HTML Analysis complete (${htmlAnalysis.semanticAnalysis?.pageType || 'unknown'})`);
          } else {
            console.log('⚠️  HTML analysis failed, will use basic content');
          }

          // Update context with analysis
          const summary = this.contextManager.summarizePageContent(pageContent);
          this.contextManager.currentPageSummary = {
            ...summary,
            htmlAnalysis: htmlAnalysis.success ? htmlAnalysis.semanticAnalysis : null,
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
    const prompt = context;

    // Add HTML analysis insights if available
    if (htmlAnalysis?.success && htmlAnalysis.semanticAnalysis) {
      const semantic = htmlAnalysis.semanticAnalysis;

      if (semantic.keyElements && semantic.keyElements.length > 0) {
        prompt += `\n\n## Key Elements (from HTML analysis):\n`;
        semantic.keyElements.forEach(el => {
          prompt += `- ${el.type}: ${el.description} (priority: ${el.priority})\n`;
          if (el.selector) prompt += `  Selector: ${el.selector}\n`;
        });
      }

      if (semantic.recommendedActions && semantic.recommendedActions.length > 0) {
        prompt += `\n## Recommended Actions:\n`;
        semantic.recommendedActions.forEach(action => {
          prompt += `- ${action}\n`;
        });
      }
    }

    return await this.claudeClient.getDecision(
      'You are an autonomous browser automation agent with HTML analysis and Vision fallback capabilities.',
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
          return await this.browserManager.click(parameters.selector || parameters.text);

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
          const screenshot = await this.browserManager.screenshot();
          console.log('📸 Screenshot taken');
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
    };
  }

  /**
   * Reset agent state
   */
  reset() {
    this.currentGoal = null;
    this.stepCount = 0;
    this.subAgents.clear();
    this.contextManager.reset();
    this.claudeClient.clearHistory();
    this.humanAssistance.clearHistory();
    this.visionFallback.resetStats();
  }
}
