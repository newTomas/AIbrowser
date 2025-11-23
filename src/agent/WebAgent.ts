import Anthropic from '@anthropic-ai/sdk';
import { Thought, Action, Observation, TaggerElement, TabInfo, AssistanceRequest } from '@/types';
import { BrowserManager } from '@/automation/BrowserManager';
import { ElementTagger } from '@/automation/ElementTagger';
import { PageActions } from '@/automation/PageActions';
import { RiskEvaluator } from '@/security/RiskEvaluator';
import { logger } from '@/cli/Logger';
import { getConfig } from '@/utils/config';

export class WebAgent {
  private anthropic: Anthropic;
  private browserManager: BrowserManager;
  private elementTagger: ElementTagger;
  private pageActions: PageActions;
  private riskEvaluator: RiskEvaluator;
  private currentPageId: number | null = null;
  private reactHistory: { thought: Thought; action?: Action; observation?: Observation; timestamp: Date }[] = [];
  private maxHistoryLength: number = 10;
  private running: boolean = false;
  private userAssistanceCallback?: (request: AssistanceRequest) => Promise<boolean>;

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
  }

  /**
   * Initialize the agent and browser
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing WebAgent...');
      await this.browserManager.initialize();

      // Create initial tab
      this.currentPageId = await this.browserManager.createTab();
      logger.info(`Created initial tab with ID: ${this.currentPageId}`);

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
   * Execute task with ReAct loop
   */
  async executeTask(goal: string, maxIterations: number = 20): Promise<void> {
    this.running = true;
    let iteration = 0;

    logger.info(`Starting task execution: "${goal}"`);
    logger.info(`Maximum iterations: ${maxIterations}`);

    while (this.running && iteration < maxIterations) {
      iteration++;
      logger.info(`--- Iteration ${iteration} ---`);

      try {
        // 1. Generate Thought
        const thought = await this.generateThought(goal);
        this.logThought(thought);

        // 2. Decide Action
        const action = await this.decideAction(goal, thought);
        this.logAction(action);

        // 3. Execute Action and get Observation
        const observation = await this.executeAction(action);
        this.logObservation(observation);

        // 4. Add to history
        this.addToHistory(thought, action, observation);

        // 5. Check if goal is achieved
        if (await this.isGoalAchieved(goal, observation)) {
          logger.info('🎉 Goal achieved successfully!');
          break;
        }

        // Small delay between iterations
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        logger.error(`Error in iteration ${iteration}:`, error);

        // Add error to observation for self-correction
        const errorObservation: Observation = {
          timestamp: new Date(),
          page_info: await this.getCurrentPageInfo(),
          elements: [],
          tabs: await this.browserManager.getTabsInfo(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };

        this.addToHistory({ reasoning: `Error occurred: ${error instanceof Error ? error.message : 'Unknown error'}` }, undefined, errorObservation);

        // Decide if we should continue or stop
        if (iteration >= maxIterations - 1) {
          logger.error('Max iterations reached, stopping execution');
          break;
        }
      }
    }

    this.running = false;
    logger.info('Task execution completed');
  }

  /**
   * Generate thought based on current context and goal
   */
  private async generateThought(goal: string): Promise<Thought> {
    const context = await this.buildContext();
    const prompt = this.buildThoughtPrompt(goal, context);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      });

      const content = response.content[0];
      const text = content.type === 'text' ? content.text : '';

      return this.parseThought(text);
    } catch (error) {
      logger.error('Failed to generate thought:', error);
      return {
        reasoning: `Error generating thought: ${error instanceof Error ? error.message : 'Unknown error'}`,
        confidence: 0
      };
    }
  }

  /**
   * Decide action based on thought and goal
   */
  private async decideAction(goal: string, thought: Thought): Promise<Action> {
    const context = await this.buildContext();
    const prompt = this.buildActionPrompt(goal, thought, context);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      });

      const content = response.content[0];
      const text = content.type === 'text' ? content.text : '';

      return this.parseAction(text);
    } catch (error) {
      logger.error('Failed to decide action:', error);
      throw new Error(`Action decision failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Execute action with security check
   */
  private async executeAction(action: Action): Promise<Observation> {
    if (!this.currentPageId) {
      throw new Error('No active page');
    }

    // Security evaluation
    const securityContext = await this.riskEvaluator.buildSecurityContext(
      action,
      (await this.getCurrentPageInfo()).url,
      action.parameters.id,
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

    // Execute the action
    try {
      switch (action.tool) {
        case 'click_element':
          await this.pageActions.clickElement(this.currentPageId, action.parameters.id);
          break;

        case 'type_text':
          await this.pageActions.typeText(this.currentPageId, action.parameters.id, action.parameters.text);
          break;

        case 'navigate_to':
          await this.pageActions.navigateTo(this.currentPageId, action.parameters.url);
          break;

        case 'scroll_page':
          await this.pageActions.scrollPage(this.currentPageId, action.parameters.direction);
          break;

        case 'switch_to_page':
          await this.pageActions.switchToPage(action.parameters.page_id);
          this.currentPageId = action.parameters.page_id;
          break;

        case 'request_user_assistance':
          await this.pageActions.requestUserAssistance(
            action.parameters.reason,
            action.parameters.is_critical || false
          );
          break;

        default:
          throw new Error(`Unknown action tool: ${action.tool}`);
      }

      // Generate observation after action
      return await this.generateObservation();

    } catch (error) {
      logger.error(`Failed to execute action ${action.tool}:`, error);
      throw error;
    }
  }

  /**
   * Generate observation of current state
   */
  private async generateObservation(): Promise<Observation> {
    if (!this.currentPageId) {
      throw new Error('No active page');
    }

    try {
      const pageInfo = await this.getCurrentPageInfo();
      const elements = await this.pageActions.getInteractiveElements(this.currentPageId);
      const tabs = await this.browserManager.getTabsInfo();

      return {
        timestamp: new Date(),
        page_info: pageInfo,
        elements,
        tabs,
        history_summary: this.getHistorySummary()
      };
    } catch (error) {
      logger.error('Failed to generate observation:', error);
      throw error;
    }
  }

  /**
   * Build context for LLM prompts
   */
  private async buildContext(): Promise<string> {
    const pageInfo = await this.getCurrentPageInfo();
    const elements = await this.pageActions.getInteractiveElements(this.currentPageId!);
    const tabs = await this.browserManager.getTabsInfo();
    const historySummary = this.getHistorySummary();

    let context = `Current Page:\n- URL: ${pageInfo.url}\n- Title: ${pageInfo.title}\n\n`;

    context += `Available Tabs (${tabs.length}):\n`;
    tabs.forEach(tab => {
      context += `- Tab ${tab.id}: ${tab.title} (${tab.is_active ? 'ACTIVE' : 'inactive'}) - ${tab.url}\n`;
    });

    context += `\nInteractive Elements (${elements.length}):\n`;
    elements.slice(0, 50).forEach(element => { // Limit to first 50 elements for context length
      context += `- ID ${element.id}: [${element.role}] "${element.text}"\n`;
    });

    if (elements.length > 50) {
      context += `... and ${elements.length - 50} more elements\n`;
    }

    if (historySummary) {
      context += `\nRecent Actions:\n${historySummary}\n`;
    }

    return context;
  }

  /**
   * Build prompt for thought generation
   */
  private buildThoughtPrompt(goal: string, context: string): string {
    return `You are a web automation agent. Your goal is: ${goal}

Current State:
${context}

Based on the current state and your goal, think about what you should do next. Consider:
1. What is the current situation?
2. What have you tried so far?
3. What is the best next step to achieve the goal?
4. What are the potential risks or challenges?

Provide your thought in this JSON format:
{
  "reasoning": "Detailed analysis of current situation and next steps",
  "next_action": "Brief description of what you plan to do next",
  "confidence": 0.8
}

Focus on being strategic and considering the most effective path to achieve the goal.`;
  }

  /**
   * Build prompt for action decision
   */
  private buildActionPrompt(goal: string, thought: Thought, context: string): string {
    return `You are a web automation agent. Your goal is: ${goal}

Your thought process:
${thought.reasoning}

Current State:
${context}

Based on your thought process and the current state, decide on the next action.

Available Actions:
1. click_element(id: number) - Click on an element by its ID
2. type_text(id: number, text: string) - Type text into an input field
3. navigate_to(url: string) - Navigate to a URL
4. scroll_page(direction: 'up'|'down') - Scroll the page
5. switch_to_page(page_id: number) - Switch to a different tab
6. request_user_assistance(reason: string, is_critical: boolean) - Ask for human help

Provide your action in this JSON format:
{
  "tool": "action_name",
  "parameters": {
    "parameter_name": "parameter_value"
  }
}

Choose the most appropriate action to move closer to your goal.`;
  }

  /**
   * Parse thought from LLM response
   */
  private parseThought(text: string): Thought {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in thought response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        reasoning: parsed.reasoning || 'No reasoning provided',
        next_action: parsed.next_action,
        confidence: parsed.confidence || 0.5
      };
    } catch (error) {
      logger.error('Failed to parse thought:', error);
      return {
        reasoning: `Failed to parse thought: ${text.substring(0, 200)}...`,
        confidence: 0
      };
    }
  }

  /**
   * Parse action from LLM response
   */
  private parseAction(text: string): Action {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in action response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        tool: parsed.tool,
        parameters: parsed.parameters || {}
      };
    } catch (error) {
      logger.error('Failed to parse action:', error);
      throw new Error(`Failed to parse action: ${text.substring(0, 200)}...`);
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

  /**
   * Add to ReAct history
   */
  private addToHistory(thought: Thought, action?: Action, observation?: Observation): void {
    this.reactHistory.push({
      thought,
      action,
      observation,
      timestamp: new Date()
    });

    // Keep only recent history
    if (this.reactHistory.length > this.maxHistoryLength) {
      this.reactHistory.shift();
    }
  }

  /**
   * Get summary of recent history
   */
  private getHistorySummary(): string {
    if (this.reactHistory.length === 0) {
      return 'No previous actions';
    }

    const recent = this.reactHistory.slice(-5); // Last 5 actions
    return recent.map((entry, index) => {
      let summary = `${index + 1}. `;
      if (entry.action) {
        summary += `Action: ${entry.action.tool} ${JSON.stringify(entry.action.parameters)}`;
      }
      if (entry.observation?.error) {
        summary += ` (Error: ${entry.observation.error})`;
      }
      return summary;
    }).join('\n');
  }

  /**
   * Check if goal is achieved
   */
  private async isGoalAchieved(goal: string, observation: Observation): Promise<boolean> {
    // Simple heuristic - can be enhanced with LLM evaluation
    const prompt = `Based on the current observation, has this goal been achieved?

Goal: ${goal}

Current Page:
- URL: ${observation.page_info.url}
- Title: ${observation.page_info.title}

Elements on page: ${observation.elements.length}

Respond with only "true" or "false".`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [{ role: 'user', content: prompt }]
      });

      const content = response.content[0];
      const text = content.type === 'text' ? content.text.toLowerCase().trim() : '';

      return text.includes('true');
    } catch (error) {
      logger.error('Failed to check goal achievement:', error);
      return false;
    }
  }

  /**
   * Request user assistance
   */
  private async requestUserAssistance(reason: string, isCritical: boolean): Promise<boolean> {
    if (!this.userAssistanceCallback) {
      logger.warning('No user assistance callback set, auto-denying request');
      return false;
    }

    const request: AssistanceRequest = {
      reason,
      is_critical: isCritical,
      context: `Current page: ${(await this.getCurrentPageInfo()).url}`
    };

    try {
      return await this.userAssistanceCallback(request);
    } catch (error) {
      logger.error('User assistance request failed:', error);
      return false;
    }
  }

  /**
   * Stop the agent execution
   */
  stop(): void {
    this.running = false;
    logger.info('WebAgent execution stopped');
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
   * Get ReAct history
   */
  getHistory(): typeof this.reactHistory {
    return [...this.reactHistory];
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.reactHistory = [];
    logger.debug('ReAct history cleared');
  }

  /**
   * Log methods
   */
  private logThought(thought: Thought): void {
    logger.thought(thought.reasoning, thought.next_action);
  }

  private logAction(action: Action): void {
    logger.action(action.tool, action.parameters);
  }

  private logObservation(observation: Observation): void {
    const summary = `Page: ${observation.page_info.title} | Elements: ${observation.elements.length} | Tabs: ${observation.tabs.length}`;
    logger.observation(summary, observation);
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