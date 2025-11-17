/**
 * SubAgent handles specific tasks with error recovery
 */
export class SubAgent {
  constructor(name, claudeClient, browserManager) {
    this.name = name;
    this.claudeClient = claudeClient;
    this.browserManager = browserManager;
    this.maxRetries = 3;
    this.errors = [];
  }

  /**
   * Execute a specific task with error handling
   * @param {string} taskDescription - Description of the task
   * @param {object} context - Task context
   * @param {number} retryCount - Current retry attempt
   */
  async executeTask(taskDescription, context = {}, retryCount = 0) {
    console.log(`\n[${this.name}] Executing task: ${taskDescription}`);

    try {
      // Get decision from Claude
      const systemPrompt = this.getSystemPrompt();
      const userPrompt = this.buildUserPrompt(taskDescription, context);

      const response = await this.claudeClient.getDecision(systemPrompt, userPrompt, false);

      if (!response.success) {
        throw new Error(`Claude API error: ${response.error}`);
      }

      const decision = response.decision;
      console.log(`[${this.name}] Decision: ${decision.action}`);
      console.log(`[${this.name}] Thought: ${decision.thought}`);

      // Execute the action
      const result = await this.executeAction(decision);

      // Check if result indicates failure
      if (result.success === false && retryCount < this.maxRetries) {
        console.log(`[${this.name}] Action failed, retrying... (${retryCount + 1}/${this.maxRetries})`);

        // Add error to context for retry
        context.previousError = result.error;
        context.previousAction = decision;

        // Wait before retry
        await this.wait(2);

        return await this.executeTask(taskDescription, context, retryCount + 1);
      }

      return {
        success: result.success !== false,
        result,
        decision,
      };
    } catch (error) {
      console.error(`[${this.name}] Error:`, error.message);
      this.errors.push({
        timestamp: new Date().toISOString(),
        task: taskDescription,
        error: error.message,
      });

      // Retry on error
      if (retryCount < this.maxRetries) {
        console.log(`[${this.name}] Retrying due to error... (${retryCount + 1}/${this.maxRetries})`);
        context.previousError = error.message;

        await this.wait(2);
        return await this.executeTask(taskDescription, context, retryCount + 1);
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute browser action
   */
  async executeAction(decision) {
    const { action, parameters = {} } = decision;

    switch (action) {
      case 'navigate':
        return { success: await this.browserManager.goto(parameters.url) };

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
        return { success: true, screenshot };

      case 'evaluate':
        const result = await this.browserManager.evaluate(parameters.script);
        return { success: true, result };

      case 'get_content':
        const content = await this.browserManager.getPageContent();
        return { success: true, content };

      case 'complete':
        return { success: true, completed: true, summary: decision.summary };

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  /**
   * Build user prompt with context
   */
  buildUserPrompt(taskDescription, context) {
    let prompt = `Task: ${taskDescription}\n\n`;

    if (context.currentUrl) {
      prompt += `Current URL: ${context.currentUrl}\n`;
    }

    if (context.pageContent) {
      prompt += `\nPage Summary:\n`;
      prompt += `Title: ${context.pageContent.title}\n`;
      if (context.pageContent.buttons?.length > 0) {
        prompt += `Buttons: ${context.pageContent.buttons.slice(0, 10).join(', ')}\n`;
      }
      if (context.pageContent.links?.length > 0) {
        prompt += `Links: ${context.pageContent.links.slice(0, 10).map(l => l.text).join(', ')}\n`;
      }
    }

    if (context.previousError) {
      prompt += `\n⚠️ Previous attempt failed with error: ${context.previousError}\n`;
      if (context.previousAction) {
        prompt += `Previous action attempted: ${JSON.stringify(context.previousAction)}\n`;
      }
      prompt += `Please try a different approach.\n`;
    }

    return prompt;
  }

  /**
   * Get system prompt for this agent
   */
  getSystemPrompt() {
    return `You are a specialized browser automation agent named "${this.name}".

Your job is to execute specific tasks autonomously by controlling a web browser.

Available actions:
- navigate: Go to a URL { "action": "navigate", "parameters": { "url": "..." } }
- click: Click an element { "action": "click", "parameters": { "selector": "css selector or text" } }
- type: Type text into input { "action": "type", "parameters": { "selector": "...", "text": "..." } }
- wait: Wait for seconds { "action": "wait", "parameters": { "seconds": 2 } }
- scroll: Scroll page { "action": "scroll", "parameters": { "direction": "up|down" } }
- screenshot: Take screenshot { "action": "screenshot" }
- evaluate: Execute JavaScript { "action": "evaluate", "parameters": { "script": "..." } }
- get_content: Get page content { "action": "get_content" }
- complete: Task finished { "action": "complete", "summary": "..." }

Always respond with valid JSON:
{
  "thought": "your reasoning about what to do",
  "action": "action_name",
  "parameters": { ... }
}

If you encounter an error, analyze what went wrong and try a different approach.
Be specific with selectors - prefer IDs or unique classes.`;
  }

  /**
   * Wait helper
   */
  async wait(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }

  /**
   * Get error history
   */
  getErrors() {
    return this.errors;
  }

  /**
   * Clear error history
   */
  clearErrors() {
    this.errors = [];
  }
}
