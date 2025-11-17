/**
 * Manages context for Claude API calls
 * Implements smart summarization to avoid sending entire web pages
 */
export class ContextManager {
  constructor(maxContextSize = 10000) {
    this.maxContextSize = maxContextSize;
    this.history = [];
    this.currentPageSummary = null;
  }

  /**
   * Add action to history
   */
  addAction(action, result) {
    this.history.push({
      timestamp: new Date().toISOString(),
      action,
      result: this.summarizeResult(result),
    });

    // Keep only last 10 actions to manage context size
    if (this.history.length > 10) {
      this.history = this.history.slice(-10);
    }
  }

  /**
   * Summarize page content intelligently
   */
  summarizePageContent(pageContent) {
    if (!pageContent) return null;

    const summary = {
      url: pageContent.url,
      title: pageContent.title,
      description: pageContent.description,
    };

    // Add condensed body (first 500 chars)
    if (pageContent.body) {
      summary.bodyPreview = pageContent.body.slice(0, 500);
      summary.bodyLength = pageContent.body.length;
    }

    // Add important links (max 20)
    if (pageContent.links && pageContent.links.length > 0) {
      summary.importantLinks = pageContent.links
        .slice(0, 20)
        .map(l => `${l.text} -> ${l.href}`);
    }

    // Add form information
    if (pageContent.forms && pageContent.forms.length > 0) {
      summary.forms = pageContent.forms.map(f => ({
        action: f.action,
        method: f.method,
        inputCount: f.inputs.length,
        inputs: f.inputs.map(i => `${i.name || i.id} (${i.type})`),
      }));
    }

    // Add button information
    if (pageContent.buttons && pageContent.buttons.length > 0) {
      summary.buttons = pageContent.buttons
        .filter(b => b.text.length > 0)
        .slice(0, 15)
        .map(b => b.text);
    }

    this.currentPageSummary = summary;
    return summary;
  }

  /**
   * Summarize action result
   */
  summarizeResult(result) {
    if (!result) return null;

    if (typeof result === 'string') {
      return result.length > 200 ? result.slice(0, 200) + '...' : result;
    }

    if (result.success !== undefined) {
      return result;
    }

    // For objects, return a simplified version
    return JSON.stringify(result).slice(0, 200);
  }

  /**
   * Get context for Claude API
   */
  getContext() {
    let context = '';

    // Add current page summary
    if (this.currentPageSummary) {
      context += '## Current Page\n';
      context += `URL: ${this.currentPageSummary.url}\n`;
      context += `Title: ${this.currentPageSummary.title}\n`;

      if (this.currentPageSummary.description) {
        context += `Description: ${this.currentPageSummary.description}\n`;
      }

      if (this.currentPageSummary.bodyPreview) {
        context += `\nPage Content Preview:\n${this.currentPageSummary.bodyPreview}\n`;
      }

      if (this.currentPageSummary.forms && this.currentPageSummary.forms.length > 0) {
        context += '\nForms on page:\n';
        this.currentPageSummary.forms.forEach((form, i) => {
          context += `  Form ${i + 1}: ${form.method} ${form.action}\n`;
          context += `    Inputs: ${form.inputs.join(', ')}\n`;
        });
      }

      if (this.currentPageSummary.buttons && this.currentPageSummary.buttons.length > 0) {
        context += '\nAvailable buttons: ' + this.currentPageSummary.buttons.join(', ') + '\n';
      }

      if (this.currentPageSummary.importantLinks && this.currentPageSummary.importantLinks.length > 0) {
        context += '\nImportant links:\n';
        this.currentPageSummary.importantLinks.slice(0, 10).forEach(link => {
          context += `  - ${link}\n`;
        });
      }

      context += '\n';
    }

    // Add recent action history
    if (this.history.length > 0) {
      context += '## Recent Actions\n';
      this.history.slice(-5).forEach((item, i) => {
        context += `${i + 1}. ${item.action.type || item.action}\n`;
        if (item.result) {
          context += `   Result: ${JSON.stringify(item.result)}\n`;
        }
      });
      context += '\n';
    }

    // Ensure context doesn't exceed max size
    if (context.length > this.maxContextSize) {
      context = context.slice(0, this.maxContextSize) + '\n... (truncated)';
    }

    return context;
  }

  /**
   * Get full context with system instructions
   */
  getFullContext(userGoal) {
    const systemContext = `You are an AI browser automation agent with advanced capabilities. You can control a web browser to accomplish user goals.

Available actions:
- navigate(url): Navigate to a URL in the current tab
- click(selector): Click an element (use text content or CSS selector)
- type(selector, text): Type text into an input field
- scroll(direction): Scroll the page (up/down)
- wait(seconds): Wait for specified seconds
- screenshot(): Take a screenshot
- evaluate(script): Execute JavaScript on the page
- press_enter: Press Enter key
- go_back: Go back to previous page

Tab Management:
- create_tab(url): Create a new tab and optionally navigate to URL
- switch_tab(tabId): Switch to a specific tab by ID
- close_tab(tabId): Close a specific tab
- list_tabs: List all open tabs with their IDs and URLs
- find_tab(urlPattern): Find tab by URL pattern

Example use case: "Open Gmail in one tab and Twitter in another"
1. create_tab("https://gmail.com") -> returns {tabId: "tab-1"}
2. create_tab("https://twitter.com") -> returns {tabId: "tab-2"}
3. switch_tab(tabId: "tab-1") to work with Gmail
4. switch_tab(tabId: "tab-2") to work with Twitter

Current context:
${this.getContext()}

User Goal: ${userGoal}

Respond with your next action as JSON:
{
  "thought": "Your reasoning about what to do next",
  "action": "action_name",
  "parameters": { ... },
  "needsConfirmation": false
}

Set needsConfirmation to true for destructive actions like:
- Submitting forms with sensitive data
- Making purchases or financial transactions
- Deleting or modifying data
- Sending messages or emails

If you've completed the goal, respond with:
{
  "thought": "Task completed successfully",
  "action": "complete",
  "summary": "What was accomplished"
}
`;

    return systemContext;
  }

  /**
   * Reset context
   */
  reset() {
    this.history = [];
    this.currentPageSummary = null;
  }

  /**
   * Get history length
   */
  getHistoryLength() {
    return this.history.length;
  }
}
