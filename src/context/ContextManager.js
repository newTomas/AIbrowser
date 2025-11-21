/**
 * Manages context for Claude API calls
 * Implements smart summarization to avoid sending entire web pages
 */
export class ContextManager {
  constructor(maxContextSize = 10000) {
    this.maxContextSize = maxContextSize;
    this.history = [];
    this.currentPageSummary = null;
    this.openTabs = []; // Track all open tabs
    this.overlayStatus = null; // NEW v2.2: Track active overlays/modals
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
   * Update list of open tabs
   */
  updateTabs(tabs) {
    this.openTabs = tabs;
  }

  /**
   * NEW v2.2: Update overlay/modal status
   * @param {Object} status - Overlay status from BrowserManager.getPageOverlayStatus()
   */
  updateOverlayStatus(status) {
    this.overlayStatus = status;
  }

  /**
   * Get context for Claude API
   */
  getContext() {
    let context = '';

    // Add open tabs information (if multiple tabs exist)
    if (this.openTabs && this.openTabs.length > 1) {
      context += '## Open Tabs\n';
      this.openTabs.forEach((tab, i) => {
        const activeMarker = tab.active ? '→ ' : '  ';
        context += `${activeMarker}${tab.id}: ${tab.title} (${tab.url})\n`;
      });
      context += '\nIMPORTANT: To access content from other tabs, use switch_tab action first!\n\n';
    }

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

    // NEW v2.2: Add overlay/modal status
    if (this.overlayStatus && this.overlayStatus.hasActiveOverlays) {
      context += '## ⚠️ Active Modal/Overlay Detected\n';
      context += `${this.overlayStatus.modalCount} modal(s)/overlay(s) detected on page.\n\n`;

      this.overlayStatus.modals.forEach((modal, i) => {
        context += `Modal ${i + 1}:\n`;
        context += `  Type: ${modal.type}\n`;
        context += `  Dismissible: ${modal.dismissible ? 'Yes (has close button)' : 'No'}\n`;
        context += `  Covers full screen: ${modal.coversFullScreen ? 'Yes' : 'No'}\n`;
        context += `  Z-index: ${modal.zIndex}\n\n`;
      });

      context += '⚠️ IMPORTANT: Determine if this modal is:\n';
      context += '1. **Interactive Modal** - Contains buttons/forms you need to interact with → Click elements INSIDE the modal\n';
      context += '2. **Blocking Modal** - Prevents access to main page content → Use dismiss_modal action first\n\n';
      context += 'If your target element is INSIDE the modal, interact with it directly.\n';
      context += 'If your target element is BEHIND the modal (on main page), dismiss the modal first.\n\n';
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

AVAILABLE ACTIONS (use ONLY these):

Basic Navigation:
- navigate: Navigate to URL
  Parameters: { url: "https://example.com" }

- click: Click an element using CSS selector
  Parameters:
    Option 1 (PREFERRED): { selector: "#id" } or { selector: ".classname" } or { selector: "button.class" }
    Option 2 (for non-unique selectors): { selector: { selector: "div.option", text: "Программист" } }
    Option 3 (fallback): { selector: "Button Text" } - tries to find by text content only

  IMPORTANT: selector must be a CSS selector (starts with # or . or tag name), NOT plain text!
  Examples of CORRECT selectors: "#submit-btn", ".login-button", "button.primary", "a.nav-link", "div[role='button']"
  Examples of WRONG selectors: "Программист" (this is text, not a selector!), "Click me" (text!)

  From HTML analysis, ALWAYS use the "cssSelector" field for clicking, NOT the "displayText" field!
  The "displayText" is just for reference (what the user sees), "cssSelector" is what you use in the action.

  **For non-unique selectors (multiple elements with same class):**
  If HTML analysis shows a selector like "div.option-item" that matches multiple elements,
  use Option 2 with both selector and text: { selector: { selector: "div.option-item", text: "Программист" } }
  This will find the specific element among multiple matches by its text content.

- type: Type text into input field
  Parameters: { selector: "#email", text: "user@example.com" }

- press_enter: Press Enter key
  Parameters: {}

- go_back: Go back to previous page
  Parameters: {}

- scroll: Scroll the page
  Parameters: { direction: "down" } or { direction: "up" }

- wait: Wait for specified seconds
  Parameters: { seconds: 2 }

- evaluate: Execute JavaScript on page to extract data or get element information
  Parameters: { script: "document.querySelector('#email').value" }
  Use this to extract text/data directly from page instead of copying to clipboard

  Simple expressions (NO semicolons, NO const/let/var):
    - Get text: { script: "document.querySelector('.result').textContent" }
    - Get all links: { script: "Array.from(document.querySelectorAll('a')).map(a => a.href)" }
    - Check state: { script: "document.querySelector('#btn').disabled" }

  Multi-line scripts (with variables, must end with return):
    - { script: "const el = document.querySelector('#email'); return el ? el.value : null;" }
    - { script: "const options = Array.from(document.querySelectorAll('select option')); return options.map(o => o.textContent);" }

Tab Management:
- create_tab: Create new tab and navigate to URL (automatically switches to it)
  Parameters: { url: "https://example.com" }
  Returns: { tabId: "tab-1" }

- switch_tab: Switch to a specific tab
  Parameters: { tabId: "tab-1" }

- close_tab: Close specific tab
  Parameters: { tabId: "tab-1" }

- list_tabs: List all open tabs
  Parameters: {}
  Returns: [{ id: "tab-0", title: "...", url: "...", active: true }]

- find_tab: Find tab by URL pattern
  Parameters: { urlPattern: "github.com" }
  Returns: { tabId: "tab-1" }

Modal/Overlay Management:
- dismiss_modal: Try to dismiss/close an active modal or overlay
  Parameters: { modalIndex: 0 } (index from Active Overlays section, defaults to 0)
  The system will try multiple methods: close button, Escape key, backdrop click
  Use when overlays are blocking interaction with page elements

Human Assistance:
- request_human_help: Request help from user when you encounter CAPTCHA, 2FA, or unclear situations
  Parameters: { reason: "CAPTCHA detected on login page", details: {} }
  Use this instead of trying workarounds for human-only tasks

Task Completion:
- complete: Mark task as complete
  Parameters: { summary: "Successfully logged in and sent message" }

IMPORTANT RULES:
1. ALWAYS use CSS selectors from "Page Analysis Summary" section when available
2. Use request_human_help for CAPTCHA, 2FA, or when genuinely stuck
3. Do NOT use actions not listed above (e.g., screenshot - these don't exist)
4. After create_tab, the system automatically switches to it - no need for switch_tab
5. Use HTML analysis data to find precise selectors instead of guessing
6. Use evaluate to extract text/data from page elements directly - DO NOT rely on clipboard or copy buttons
7. When working with multiple tabs:
   - Check "Open Tabs" section to see all available tabs
   - To access content from another tab, use switch_tab FIRST, then perform actions
   - Do NOT navigate to URLs that are already open in other tabs - use switch_tab instead
   - Example: If temp-mail.org is already open in tab-0, do switch_tab to tab-0 instead of navigate
8. **Modal/Overlay Management**:
   - If you see "⚠️ Active Modal/Overlay Detected" section, analyze the situation
   - **Interactive Modal**: If the modal contains buttons/forms you need to interact with, click elements INSIDE the modal
   - **Blocking Modal**: If your target element is on the main page BEHIND the modal, use dismiss_modal FIRST
   - Check the modal content in page analysis - if it has the buttons you need, it's interactive
   - After dismissing a blocking modal, wait 1-2 seconds before clicking main page elements

Current context:
${this.getContext()}

User Goal: ${userGoal}

Respond with ONLY a single JSON object (no markdown, no code blocks, no explanation):
{
  "thought": "Your reasoning about what to do next",
  "action": "action_name",
  "parameters": { ... },
  "needsConfirmation": false
}

Example response for navigating to Google:
{"thought":"I need to navigate to Google to start searching","action":"navigate","parameters":{"url":"https://google.com"},"needsConfirmation":false}

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
