import Anthropic from '@anthropic-ai/sdk';
import { Thought, Action, Observation, TaggerElement, TabInfo, AssistanceRequest, ChatMessage, ModelResponse, ModelType, ParameterValidationRules, ParameterValidator, LastActionResults } from '@/types';
import { BrowserManager } from '@/automation/BrowserManager';
import { ElementTagger } from '@/automation/ElementTagger';
import { PageActions } from '@/automation/PageActions';
import { RiskEvaluator } from '@/security/RiskEvaluator';
import { ContentAnalyzer } from './ContentAnalyzer';
import { logger } from '@/cli/Logger';
import { getConfig } from '@/utils/config';
import { RateLimiterManager } from '@/utils/rateLimiter';

export class WebAgent {
  private anthropic: Anthropic;
  private browserManager: BrowserManager;
  private elementTagger: ElementTagger;
  private pageActions: PageActions;
  private riskEvaluator: RiskEvaluator;
  private currentPageId: number | null = null;
  private chatMessages: ChatMessage[] = [];
  private running: boolean = false;
  private userAssistanceCallback?: (request: AssistanceRequest) => Promise<boolean>;
  private maxMessages: number = 50; // Keep conversation history manageable
  private simpleLoopDetection: {
    lastActions: string[]; // Track recent actions
    lastUrls: string[]; // Track URL changes
  } = {
      lastActions: [],
      lastUrls: []
    };
  private websiteReliability: Map<string, { successRate: number; attempts: number; failures: number }> = new Map();
  private currentContentGoal?: 'email' | 'form' | 'data' | 'text';
  private lastActionResults: LastActionResults = {};
  private rateLimiterManager: RateLimiterManager;

  constructor() {
    const config = getConfig();
    this.anthropic = new Anthropic({
      apiKey: config.anthropicApiKey
    });

    this.browserManager = new BrowserManager({
      headless: config.headless,
      userDataDir: config.userDataDir,
      timeout: config.browserTimeout
    });

    this.elementTagger = new ElementTagger();
    this.pageActions = new PageActions(this.browserManager, this.elementTagger);
    this.riskEvaluator = new RiskEvaluator();
    this.rateLimiterManager = RateLimiterManager.getInstance(config.rateLimits);
  }

  /**
   * Validate and sanitize AI-generated parameters
   */
  private validateParameters(action: string, parameters: Record<string, unknown>): Record<string, unknown> {
    const validated: Record<string, unknown> = {};

    // Define validation rules for each parameter type
    const validationRules: ParameterValidationRules = {
      // ID parameters must be positive integers
      id: (value: unknown): number | null => {
        const num = Number(value);
        return Number.isInteger(num) && num > 0 && num <= 10000 ? num : null;
      },
      page_id: (value: unknown): number | null => {
        const num = Number(value);
        return Number.isInteger(num) && num > 0 && num <= 10000 ? num : null;
      },

      // Text parameters with length limits and content validation
      text: (value: unknown): string | null => {
        if (typeof value !== 'string') return null;

        // Remove potentially dangerous characters
        const sanitized = value
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Control characters
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Script tags
          .substring(0, 1000); // Length limit

        return sanitized.length > 0 ? sanitized : null;
      },

      // URL validation
      url: (value: unknown): string | null => {
        if (typeof value !== 'string') return null;

        try {
          const url = new URL(value);
          // Allow only http/https protocols
          if (!['http:', 'https:'].includes(url.protocol)) {
            return null;
          }
          // Prevent access to localhost/private networks
          const hostname = url.hostname.toLowerCase();
          if (hostname === 'localhost' ||
              hostname.startsWith('127.') ||
              hostname.startsWith('192.168.') ||
              hostname.startsWith('10.') ||
              hostname.endsWith('.local')) {
            return null;
          }
          return url.toString();
        } catch {
          return null;
        }
      },

      // Direction validation
      direction: (value: unknown): 'up' | 'down' | null => {
        const validDirections: ('up' | 'down')[] = ['up', 'down'];
        return validDirections.includes(value as 'up' | 'down') ? (value as 'up' | 'down') : null;
      },

      // Duration validation (wait time in milliseconds)
      duration: (value: unknown): number | null => {
        const num = Number(value);
        return Number.isInteger(num) && num >= 0 && num <= 60000 ? num : null; // Max 60 seconds
      },

      // Boolean parameters
      new_tab: (value: unknown): boolean | null => {
        return typeof value === 'boolean' ? value : null;
      },

      // Filename validation for screenshots
      filename: (value: unknown): string | null => {
        if (typeof value !== 'string') return null;

        // Allow only safe characters and limit length
        const sanitized = value
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .substring(0, 50);

        // Ensure proper extension
        if (!sanitized.match(/\.(png|jpg|jpeg|bmp|gif)$/i)) {
          return sanitized + '.png';
        }

        return sanitized;
      },

      // Summary validation
      summary: (value: unknown): string | null => {
        if (typeof value !== 'string') return null;

        const sanitized = value
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
          .substring(0, 200);

        return sanitized.length > 0 ? sanitized : null;
      },

      // Reason validation for assistance requests
      reason: (value: unknown): string | null => {
        if (typeof value !== 'string') return null;

        const sanitized = value
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
          .substring(0, 500);

        return sanitized.length > 0 ? sanitized : null;
      },

      // CSS selector validation (with security restrictions)
      selector: (value: unknown): string | null => {
        if (typeof value !== 'string') return null;

        // Disallow dangerous CSS selectors
        const dangerousPatterns = [
          /javascript:/i,
          /data:/i,
          /vbscript:/i,
          /expression\(/i,
          /@import/i,
          /behavior:/i,
          /binding:/i,
          /<!--/,
          /-->/,
          /\\[0-9a-fA-F]{1,6}/g // Unicode escapes
        ];

        const sanitized = value.trim();

        for (const pattern of dangerousPatterns) {
          if (pattern.test(sanitized)) {
            return null;
          }
        }

        // Allow only basic CSS selectors
        if (sanitized.length <= 200 && /^[a-zA-Z0-9_\-\s.#\[\]="'():>*+,]+$/.test(sanitized)) {
          return sanitized;
        }

        return null;
      },

      // Boolean critical flag for assistance requests
      is_critical: (value: unknown): boolean | null => {
        return typeof value === 'boolean' ? value : null;
      }
    };

    // Validate each parameter based on action requirements
    for (const [key, value] of Object.entries(parameters)) {
      const validator = validationRules[key as keyof typeof validationRules];

      if (validator) {
        const validatedValue = validator(value);
        if (validatedValue !== null) {
          validated[key] = validatedValue;
        } else {
          logger.warning(`Invalid parameter ${key} for action ${action}: ${value}`);
          throw new Error(`Invalid parameter ${key} with value: ${value}`);
        }
      } else {
        // Unknown parameter - reject for security
        logger.warning(`Unknown parameter ${key} for action ${action}`);
        throw new Error(`Unknown parameter: ${key}`);
      }
    }

    // Validate required parameters per action
    const requiredParams = {
      click_element: ['id'], // Работает с активной вкладкой (currentPageId)
      type_text: ['id', 'text'], // Работает с активной вкладкой
            navigate_to: ['url'], // new_tab опциональный
      wait: [], // duration или selector опциональные
      scroll_page: ['direction'], // Работает с активной вкладкой (currentPageId)
      switch_to_page: [], // Принимает page_id или id, проверяется в executeAction
      screenshot: [], // filename опциональный, работает с активной вкладкой
      request_user_assistance: ['reason'], // is_critical опциональный
      goal_achieved: ['summary']
    };

    const required = requiredParams[action as keyof typeof requiredParams] || [];
    for (const param of required) {
      if (!(param in validated)) {
        throw new Error(`Required parameter missing: ${param} for action ${action}`);
      }
    }

    return validated;
  }

  /**
   * Initialize the agent and browser
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing WebAgent...');
      await this.browserManager.initialize();

      // Check if we already have tabs before creating a new one
      const existingPageCount = await this.browserManager.getPageCount();
      logger.debug(`Browser has ${existingPageCount} existing pages after initialization`);

      // Create initial tab only if needed
      this.currentPageId = await this.browserManager.createTab();
      logger.info(`Using/created initial tab with ID: ${this.currentPageId}`);

      // Log current tab state
      const tabsInfo = await this.browserManager.getTabsInfo();
      logger.info(`Total tabs after initialization: ${tabsInfo.length}`);
      tabsInfo.forEach(tab => {
        logger.debug(`  Tab ${tab.id}: ${tab.is_active ? 'ACTIVE' : 'inactive'} - ${tab.url}`);
      });

      logger.info('WebAgent initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize WebAgent:', error);
      throw error;
    }
  }


  /**
   * Set user assistance callback
   */
  setUserAssistanceCallback(callback: (request: AssistanceRequest) => Promise<boolean>): void {
    this.userAssistanceCallback = callback;
  }

  /**
   * Get system prompt for the AI
   */
  private getSystemPrompt(): string {
    return `You are an autonomous web automation agent with a ReAct (Reasoning-Acting-Observing) architecture. Your role is to intelligently interact with web pages to achieve specific goals.

## Your Capabilities
You have access to these tools:
- click_element(id): Click interactive elements by their ID
- type_text(id, text): Type text into input fields
- navigate_to(url, new_tab): Navigate to URLs (set new_tab: true to open in new tab, false for current tab)
- scroll_page(direction): Scroll up or down
- switch_to_page(id): Switch between browser tabs (use tab ID from tabs list)
- wait(duration_or_selector): Wait for time or elements to appear
- screenshot(reason): Take screenshot for visual analysis (use sparingly)
- goal_achieved(summary): Declare when you have successfully completed the goal
- request_user_assistance(reason, is_critical): Ask for human help

## Response Format
Always respond in this exact format (no extra text):

<thought>
Your reasoning about the current situation and what you plan to do next
</thought>

action: "tool_name"
param_name: "parameter_value"

OR if goal is completed:

<thought>
You have successfully completed the goal
</thought>

action: "goal_achieved"
summary: "Description of what was accomplished"

## TOON Format Explanation
You will receive page information in TOON format:
- tabs[{count}]{id,is_active,url,title}: Tab information
- timestamp: Current time
- elements[{count}]{id,role,text,value,input_type,input_group}: Interactive elements

## Parameter Examples:
- click_element: id: 42
- type_text: id: 42, text: "hello world"
- navigate_to: url: "https://example.com"
- wait: duration: 3000
- scroll_page: direction: "down"
- switch_to_page: id: 2
- screenshot: reason: "page not loading correctly"
- goal_achieved: summary: "successfully logged into account"
- request_user_assistance: reason: "CAPTCHA verification required", is_critical: true
- request_user_assistance: reason: "DDoS-Guard protection blocking access", is_critical: true

## Important Guidelines
- Each element has a unique data-agent-id number for interaction
- Prefer click_element over navigate_to when possible
- Use screenshot only when text information is insufficient
- Call goal_achieved when you've completed the objective
- Learn from failures and try alternative approaches
- Manage multiple tabs efficiently when needed
- Be cautious with security and sensitive information

## When to Request User Assistance
Use request_user_assistance when you encounter:
- **CAPTCHA challenges**: "CAPTCHA verification required"
- **Anti-bot protections**: "DDoS-Guard protection blocking access"
- **Human verification**: "2FA authentication code needed"
- **Security checkpoints**: "Security verification required to proceed"
- **Interactive challenges**: "Requires human interaction to complete"
- **Blocked functionality**: "Feature blocked by security measures"

Set is_critical: true for security-related blockers that prevent task completion.

## Element Types
- Elements with IDs are interactive: buttons, inputs, links, forms
- Use type_text only on input/textarea elements, not buttons or labels
- Check if elements are visible before interaction

You see the full history of your previous thoughts and actions. Use this context to avoid repeating mistakes and build on successful strategies.`;
  }

  /**
   * Parse model response to extract thought and action
   */
  private parseModelResponse(response: string): ModelResponse {
    logger.debug(`Parsing model response:\n${response}`);

    const thoughtMatch = response.match(/<thought>([\s\S]*?)<\/thought>/);
    const thought = thoughtMatch ? thoughtMatch[1].trim() : '';

    const actionMatch = response.match(/action:\s*"([^"]+)"/);
    const action = actionMatch ? actionMatch[1] : '';

    logger.debug(`Extracted thought: "${thought}"`);
    logger.debug(`Extracted action: "${action}"`);

    const result: ModelResponse = { thought };

    if (action) {
      // Extract parameters based on action type
      const parameters: Record<string, unknown> = {};
      logger.debug(`Starting parameter extraction for action: ${action}`);

      if (action === 'goal_achieved') {
        const summaryMatch = response.match(/summary:\s*"([^"]+)"/);
        if (summaryMatch) {
          result.goal_achieved = { summary: summaryMatch[1] };
          logger.debug(`Goal achieved with summary: "${summaryMatch[1]}"`);
        }
      } else {
        // Extract generic parameters - improved regex
        const paramMatches = response.matchAll(/(?:id|duration|direction|url|text|new_tab|summary|filename|reason|page_id|selector):\s*(\d+|"[^"]+"|true|false)/g);
        if (paramMatches) {
          for (const match of paramMatches) {
            const fullMatch = match[0];
            const value = match[1];
            const key = fullMatch.split(/:\s*/)[0].trim();
            const cleanValue = value.replace(/"/g, '');

            // Convert true/false strings to boolean values
            if (cleanValue === 'true') {
              parameters[key] = true;
            } else if (cleanValue === 'false') {
              parameters[key] = false;
            } else if (isNaN(Number(cleanValue))) {
              parameters[key] = cleanValue;
            } else {
              parameters[key] = Number(cleanValue);
            }
            logger.debug(`Extracted parameter: ${key} = ${parameters[key]}`);
          }
        }

        // Screenshot parameters are now handled by generic regex above,
        // but we keep this for backward compatibility
        if (action === 'screenshot' && !parameters.reason) {
          const reasonMatch = response.match(/reason:\s*"([^"]+)"/);
          if (reasonMatch) {
            parameters.reason = reasonMatch[1];
            logger.debug(`Screenshot reason: "${reasonMatch[1]}"`);
          }
        }
      }

      // Validate and sanitize parameters before using them
      const validatedParameters = this.validateParameters(action, parameters);

      result.action = { tool: action, parameters: validatedParameters };
      logger.debug(`Final action: ${action} with validated parameters:`, validatedParameters);
    } else {
      logger.debug('No action detected in response');
    }

    return result;
  }

  /**
   * Execute action with new TaggerElement structure
   */
  private async executeAction(action: Action): Promise<Observation> {
    if (!this.currentPageId) {
      throw new Error('No active page');
    }

    // Validate action parameters before proceeding
    this.validateParameters(action.tool, action.parameters);

    // Security evaluation
    const securityContext = await this.riskEvaluator.buildSecurityContext(
      action,
      (await this.getCurrentPageInfo()).url,
      action.parameters.id as number | undefined,
      (id) => this.elementTagger.getElementDetails(this.browserManager.getPage(this.currentPageId!)!, id)
    );

    // Check if action should be blocked
    if (this.riskEvaluator.shouldBlockAction(action, securityContext)) {
      throw new Error(`Action blocked by security policy: ${action.tool}`);
    }

    // Evaluate risk
    const riskAssessment = await this.riskEvaluator.evaluateRisk(securityContext);

    // If high risk and requires confirmation, request user assistance
    if (riskAssessment.requires_confirmation && riskAssessment.risk_level === 'HIGH') {
      const assistanceGranted = await this.requestUserAssistance(
        `High risk action detected: ${action.tool}. Reason: ${riskAssessment.reasoning}`,
        true
      );

      if (!assistanceGranted) {
        throw new Error('User denied high-risk action execution');
      }
    }

    // Execute the action with rate limiting
    try {
      // Wait for action rate limit slot
      await this.rateLimiterManager.executeWithLimit('actions', async () => {
        // This ensures we don't exceed action rate limits
      });

      switch (action.tool) {
        case 'click_element':
          await this.pageActions.clickElement(this.currentPageId, action.parameters.id as number);
          break;

        case 'type_text':
          await this.pageActions.typeText(this.currentPageId, action.parameters.id as number, action.parameters.text as string);
          break;

        case 'navigate_to':
          // Navigation has its own rate limiting
          const result = await this.rateLimiterManager.executeWithLimit('navigation', async () => {
            if (!this.currentPageId) {
              throw new Error('No active page for navigation');
            }
            return this.pageActions.navigateTo(this.currentPageId, action.parameters.url as string, action.parameters.new_tab as boolean);
          });
          // If a new tab was created, update current page
          if (typeof result === 'number') {
            this.currentPageId = result;
            logger.info(`Navigated in new tab ${this.currentPageId}`);
          }
          break;

        case 'scroll_page':
          await this.pageActions.scrollPage(this.currentPageId, action.parameters.direction as 'up' | 'down');
          break;

        case 'switch_to_page':
          // Support both id and page_id parameters for flexibility
          const pageId = (action.parameters.page_id || action.parameters.id) as number;
          if (!pageId) {
            throw new Error('switch_to_page requires either page_id or id parameter');
          }
          await this.pageActions.switchToPage(pageId);
          this.currentPageId = pageId;
          break;

        
        case 'wait':
          await this.pageActions.wait(this.currentPageId, (action.parameters.duration as number) || (action.parameters.selector as string));
          break;

        case 'request_user_assistance':
          const assistanceGranted = await this.requestUserAssistance(
            action.parameters.reason as string,
            (action.parameters.is_critical as boolean) || false
          );
          if (!assistanceGranted) {
            throw new Error('User denied assistance request');
          }
          break;

        case 'screenshot':
          const screenshot = await this.pageActions.takeScreenshot(
            this.currentPageId,
            action.parameters.filename as string
          );
          logger.info(`📸 Screenshot taken (${screenshot.length} bytes) for: ${action.parameters.reason as string || 'visual analysis'}`);
          break;

        case 'goal_achieved':
          // This is a special action - just log the achievement
          logger.info(`🎉 Goal declared as achieved: ${action.parameters.summary as string}`);
          break;

        default:
          throw new Error(`Unknown action tool: ${action.tool}`);
      }

      // Generate observation after action
      const observation = await this.generateObservation();

      // Analyze page health and check for critical failures
      this.analyzePageHealth(observation, action);

      // Update simple loop detection
      await this.updateSimpleLoopDetection(action, observation);

      return observation;

    } catch (error) {
      logger.error(`Failed to execute action ${action.tool}:`, error);

      const errorObservation: Observation = {
        timestamp: new Date(),
        page_info: await this.getCurrentPageInfo(),
        elements: [],
        tabs: await this.browserManager.getTabsInfo(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      await this.updateSimpleLoopDetection(action, errorObservation);
      throw error;
    }
  }

  /**
   * Generate observation after action
   */
  private async generateObservation(): Promise<Observation> {
    try {
      const page = this.browserManager.getPage(this.currentPageId!);
      if (!page) {
        throw new Error('No active page found');
      }

      const pageInfo = await this.getCurrentPageInfo();
      const tabsInfo = await this.browserManager.getTabsInfo();
      const elements = this.currentPageId ? await this.elementTagger.tagInteractiveElements(page) : [];

      return {
        timestamp: new Date(),
        page_info: pageInfo,
        elements,
        tabs: tabsInfo
      };
    } catch (error) {
      logger.error('Failed to generate observation:', error);
      return {
        timestamp: new Date(),
        page_info: { url: 'unknown', title: 'Error loading page info' },
        elements: [],
        tabs: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get model configuration for specific use case
   */
  private getModel(use: 'main' | 'risk' = 'main'): ModelType {
    const config = getConfig();
    return config.models?.[use] || 'claude-sonnet-4-5';
  }

  /**
   * Request user assistance
   */
  private async requestUserAssistance(reason: string, isCritical: boolean = false): Promise<boolean> {
    if (!this.userAssistanceCallback) {
      logger.warning(`User assistance requested but no callback set: ${reason}`);
      return false;
    }

    try {
      const request: AssistanceRequest = {
        reason,
        is_critical: isCritical
      };

      return await this.userAssistanceCallback(request);
    } catch (error) {
      logger.error('Failed to request user assistance:', error);
      return false;
    }
  }

  /**
   * Log rate limiting statistics
   */
  private logRateLimitStats(): void {
    const stats = this.rateLimiterManager.getAllStats();
    if (Object.keys(stats).length > 0) {
      logger.debug('Rate limiting statistics:', stats);
    }
  }

  /**
   * Execute task with ReAct loop
   */
  async executeTask(goal: string, maxIterations: number = 20): Promise<void> {
    this.running = true;
    let iteration = 0;

    // Reset chat messages for new task
    this.chatMessages = [];

    // Reset simple loop detection for new task
    this.resetSimpleLoopDetection();

    // Initialize conversation with system prompt and goal
    this.chatMessages.push({
      role: 'system',
      content: this.getSystemPrompt()
    });

    this.chatMessages.push({
      role: 'user',
      content: `Task: ${goal}\n\nStart by analyzing the current state and taking your first action.`
    });

    logger.info(`Starting task execution: "${goal}"`);
    logger.info(`Maximum iterations: ${maxIterations}`);

    while (this.running && iteration < maxIterations) {
      iteration++;
      logger.info(`--- Iteration ${iteration} ---`);

      try {
        // Get current browser state
        const currentState = await this.getCurrentBrowserState();

        // Add current state as user message
        this.chatMessages.push({
          role: 'user',
          content: `Current browser state:\n${currentState}`
        });

        // Generate response from AI
        const response = await this.generateAIResponse();

        // Parse the response
        const parsedResponse = this.parseModelResponse(response);

        // Add AI response to conversation
        this.chatMessages.push({
          role: 'assistant',
          content: response
        });

        logger.info(`Thought: ${parsedResponse.thought}`);

        // Check if goal is achieved
        if (parsedResponse.goal_achieved) {
          logger.info(`🎉 Goal achieved: ${parsedResponse.goal_achieved.summary}`);
          break;
        }

        // Execute action if provided
        if (parsedResponse.action) {
          logger.info(`Action: ${parsedResponse.action.tool} with parameters:`, parsedResponse.action.parameters);

          const actionToExecute = {
            tool: parsedResponse.action.tool,
            parameters: parsedResponse.action.parameters || {}
          };

          logger.debug(`Executing action:`, actionToExecute);

          // Log rate limiting statistics periodically
          if (iteration % 5 === 0) {
            this.logRateLimitStats();
          }

          const observation = await this.executeAction(actionToExecute);

          // Add observation result to conversation
          this.chatMessages.push({
            role: 'user',
            content: `Action result: ${observation.error ? 'Error: ' + observation.error : 'Action completed successfully'}`
          });

          this.logObservation(observation);
        } else {
          logger.warning('No action detected in response');
        }

        // Limit message history to prevent context overflow (but keep system message)
        if (this.chatMessages.length > this.maxMessages) {
          const systemMessage = this.chatMessages.find(m => m.role === 'system');
          const otherMessages = this.chatMessages.filter(m => m.role !== 'system');
          const recentMessages = otherMessages.slice(-this.maxMessages + 1);

          this.chatMessages = systemMessage ? [systemMessage, ...recentMessages] : recentMessages;
        }

        // Small delay between iterations
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        logger.error(`Error in iteration ${iteration}:`, error);

        // Add error to conversation
        this.chatMessages.push({
          role: 'user',
          content: `Error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`
        });

        // Decide if we should continue or stop
        if (iteration >= maxIterations - 1) {
          logger.error('Max iterations reached, stopping execution');
          break;
        }

        // Wait longer after errors
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    this.running = false;
    logger.info(`Task execution completed after ${iteration} iterations`);
  }

  /**
   * Get current browser state in TOON format
   */
  private async getCurrentBrowserState(): Promise<string> {
    try {
      const page = this.browserManager.getPage(this.currentPageId!);
      if (!page) {
        return 'Error: No active page';
      }

      const tabsInfo = await this.browserManager.getTabsInfo();
      const elements = this.currentPageId ? await this.elementTagger.tagInteractiveElements(page) : [];

      let state = '';

      // Add tabs information in TOON format
      state += `tabs[${tabsInfo.length}]{id,is_active,url,title}:\n`;
      tabsInfo.forEach(tab => {
        state += `${tab.id},${tab.is_active},${tab.url},${this.escapeValue(tab.title)}\n`;
      });
      state += '\n';

      // Add timestamp
      state += `timestamp: ${new Date().toISOString()}\n\n`;

      // Add elements information in TOON format
      state += `elements[${elements.length}]{id,role,text,value,input_type,input_group}:\n`;
      elements.forEach(element => {
        const id = element.id;
        const role = element.role;
        const text = this.escapeValue(element.text);
        const value = this.escapeValue(String(element.value));
        const input_type = element.input_type || '';
        const input_group = element.input_group || '';

        state += `${id},${role},${text},${value},${input_type},${input_group}\n`;
      });

      return state;
    } catch (error) {
      logger.error('Failed to get browser state:', error);
      return 'Error: Unable to get browser state';
    }
  }

  /**
   * Escape value for TOON format (handle quotes and commas)
   */
  private escapeValue(value: string): string {
    if (!value) return '';

    // Replace quotes with escaped quotes
    let escaped = value.replace(/"/g, '""');

    // If contains comma or quote, wrap in quotes
    if (escaped.includes(',') || escaped.includes('"')) {
      return `"${escaped}"`;
    }

    return escaped;
  }

  /**
   * Generate AI response using chat session
   */
  private async generateAIResponse(): Promise<string> {
    try {
      const config = getConfig();
      const model = this.getModel('main');
      const maxTokens = config.models?.maxTokens || 4000;

      // Extract system prompt from chat messages and filter it out from messages array
      const systemMessage = this.chatMessages.find(msg => msg.role === 'system');
      const messages = this.chatMessages
        .filter(msg => msg.role !== 'system')
        .map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        }));

      const response = await this.rateLimiterManager.executeWithLimit('api', async () => {
        return this.anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          system: systemMessage?.content,
          messages
        });
      });

      const content = response.content[0];
      return content.type === 'text' ? content.text : '';
    } catch (error) {
      logger.error('Failed to generate AI response:', error);
      return `<thought>Error generating response: ${error instanceof Error ? error.message : 'Unknown error'}</thought>`;
    }
  }

  
  /**
   * Get current page information
   */
  private async getCurrentPageInfo(): Promise<{ url: string; title: string }> {
    if (!this.currentPageId) {
      return { url: 'about:blank', title: 'No page loaded' };
    }

    try {
      return await this.pageActions.getPageInfo(this.currentPageId);
    } catch (error) {
      logger.error('Failed to get page info:', error);
      return { url: 'unknown', title: 'Error loading page info' };
    }
  }

  private logObservation(observation: Observation): void {
    const summary = `Page: ${observation.page_info.title} | Elements: ${observation.elements.length} | Tabs: ${observation.tabs.length}`;

    // Format observation as TOON for logging
    const toonFormat = this.observationToToon(observation);
    logger.observation(summary, toonFormat);
  }

  /**
   * Convert Observation object to TOON format for logging
   */
  private observationToToon(observation: Observation): string {
    let state = '';

    // Add timestamp
    state += `timestamp(${observation.timestamp.toISOString()})\n`;

    // Add tabs information
    state += `tabs[${observation.tabs.length}]{id,url,title}:\n`;
    observation.tabs.forEach(tab => {
      state += `  {id:${tab.id},url:"${tab.url}",title:"${tab.title}"},\n`;
    });

    // Add elements information
    state += `elements[${observation.elements.length}]{id,role,text,value,input_type,input_group}:\n`;
    observation.elements.forEach(element => {
      state += `  {id:${element.id},role:"${element.role}",text:"${element.text}",value:${typeof element.value === 'string' ? `"${element.value}"` : element.value}`;
      if (element.input_type) state += `,input_type:"${element.input_type}"`;
      if (element.input_group) state += `,input_group:"${element.input_group}"`;
      state += '},\n';
    });

    return state;
  }

  /**
   * Analyze page health and detect critical failures
   */
  private analyzePageHealth(observation: Observation, action: Action): void {
    const health = ContentAnalyzer.analyzePageHealth(observation);
    const domain = this.extractDomain(observation.page_info.url);

    // Update website reliability
    if (!this.websiteReliability.has(domain)) {
      this.websiteReliability.set(domain, { successRate: 0, attempts: 0, failures: 0 });
    }

    const reliability = this.websiteReliability.get(domain)!;
    reliability.attempts++;

    // Check for critical failures that require immediate intervention
    if (health.loadState === 'empty' || health.loadState === 'error') {
      logger.warning(`Critical page health issue detected: ${health.loadState} - ${health.issues.join(', ')}`);

      // Update reliability
      reliability.failures++;
      reliability.successRate = (reliability.attempts - reliability.failures) / reliability.attempts;

      // Critical failure - this should trigger strong anti-loop response
      logger.error(`CRITICAL: Page ${observation.page_info.url} is ${health.loadState}. Recommend alternative website immediately.`);
    } else {
      // Page is healthy, update reliability positively
      reliability.successRate = (reliability.attempts - reliability.failures) / reliability.attempts;
    }
  }

  /**
   * Reset simple loop detection for new task
   */
  private resetSimpleLoopDetection(): void {
    this.simpleLoopDetection.lastActions = [];
    this.simpleLoopDetection.lastUrls = [];
    this.lastActionResults = {};
  }

  /**
   * Update simple loop detection
   */
  private async updateSimpleLoopDetection(action: Action, observation: Observation): Promise<void> {
    // Track last 5 actions
    this.simpleLoopDetection.lastActions.push(action.tool);
    if (this.simpleLoopDetection.lastActions.length > 5) {
      this.simpleLoopDetection.lastActions.shift();
    }

    // Track last 5 URLs
    if (observation.page_info?.url) {
      this.simpleLoopDetection.lastUrls.push(observation.page_info.url);
      if (this.simpleLoopDetection.lastUrls.length > 5) {
        this.simpleLoopDetection.lastUrls.shift();
      }
    }

    // Check for simple loops and log warnings
    const uniqueActions = new Set(this.simpleLoopDetection.lastActions);
    if (uniqueActions.size === 1 && this.simpleLoopDetection.lastActions.length >= 3) {
      logger.warning(`⚠️  Potential action loop detected: repeating "${action.tool}" action`);
    }

    const uniqueUrls = new Set(this.simpleLoopDetection.lastUrls);
    const tabsInfo = await this.browserManager.getTabsInfo();

    // Only detect URL loops if working with multiple tabs
    if (tabsInfo.length > 1 && uniqueUrls.size <= 2 && this.simpleLoopDetection.lastUrls.length >= 4) {
      logger.warning(`⚠️  Potential URL loop detected: cycling between ${Array.from(uniqueUrls).join(', ')}`);
    }
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return 'unknown';
    }
  }


  /**
   * Stop the agent
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Check if agent is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get current page ID
   */
  getCurrentPageId(): number | null {
    return this.currentPageId;
  }

  /**
   * Get chat history
   */
  getHistory(): ChatMessage[] {
    return [...this.chatMessages];
  }

  /**
   * Get history summary for CLI
   */
  getHistorySummary(): string {
    if (this.chatMessages.length === 0) {
      return 'No previous actions';
    }

    const assistantMessages = this.chatMessages.filter(msg => msg.role === 'assistant');
    const recent = assistantMessages.slice(-5);

    return recent.map((entry, index) => {
      const thoughtMatch = entry.content.match(/<thought>([\s\S]*?)<\/thought>/);
      const actionMatch = entry.content.match(/action:\s*"([^"]+)"/);

      let summary = `${index + 1}. `;
      if (thoughtMatch) {
        summary += `Thought: ${thoughtMatch[1].substring(0, 60)}...`;
      }
      if (actionMatch) {
        summary += ` | Action: ${actionMatch[1]}`;
      }
      summary += '\n';
      return summary;
    }).join('');
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    try {
      this.stop();
      await this.browserManager.close();
      logger.info('WebAgent cleanup completed');
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }
}