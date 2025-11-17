import Anthropic from '@anthropic-ai/sdk';

/**
 * Client for interacting with Claude API
 */
export class ClaudeClient {
  constructor(apiKey, model = 'claude-sonnet-4-5-20250929') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.conversationHistory = [];
  }

  /**
   * Send message to Claude and get decision
   * @param {string} systemPrompt - System instructions
   * @param {string} userMessage - User message or context
   * @param {boolean} includeHistory - Whether to include conversation history
   */
  async getDecision(systemPrompt, userMessage, includeHistory = true) {
    try {
      const messages = includeHistory
        ? [...this.conversationHistory, { role: 'user', content: userMessage }]
        : [{ role: 'user', content: userMessage }];

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      });

      const assistantMessage = response.content[0].text;

      // Add to conversation history
      if (includeHistory) {
        this.conversationHistory.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: assistantMessage }
        );

        // Keep history manageable (last 10 exchanges)
        if (this.conversationHistory.length > 20) {
          this.conversationHistory = this.conversationHistory.slice(-20);
        }
      }

      // Try to parse as JSON
      try {
        const decision = JSON.parse(assistantMessage);
        return { success: true, decision };
      } catch (parseError) {
        // If not valid JSON, return as text
        return {
          success: true,
          decision: {
            thought: assistantMessage,
            action: 'unknown',
            requiresHumanInput: true,
          },
        };
      }
    } catch (error) {
      console.error('Claude API error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Stream response from Claude (for long-running tasks)
   */
  async streamDecision(systemPrompt, userMessage, onChunk) {
    try {
      const stream = await this.client.messages.stream({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      let fullResponse = '';

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
          fullResponse += chunk.delta.text;
          if (onChunk) {
            onChunk(chunk.delta.text);
          }
        }
      }

      return { success: true, response: fullResponse };
    } catch (error) {
      console.error('Claude streaming error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Analyze page content and suggest actions
   */
  async analyzePageContent(pageContent, userGoal) {
    const prompt = `Analyze this web page and suggest the best action to accomplish the goal.

Page Information:
- URL: ${pageContent.url}
- Title: ${pageContent.title}
${pageContent.description ? `- Description: ${pageContent.description}` : ''}

Available elements:
${pageContent.buttons?.length > 0 ? `Buttons: ${pageContent.buttons.map(b => b.text).join(', ')}` : ''}
${pageContent.links?.length > 0 ? `\nLinks (showing first 10): ${pageContent.links.slice(0, 10).map(l => l.text).join(', ')}` : ''}
${pageContent.forms?.length > 0 ? `\nForms: ${pageContent.forms.length} form(s) detected` : ''}

User Goal: ${userGoal}

Provide your decision as JSON with format:
{
  "thought": "your reasoning",
  "action": "navigate|click|type|wait|screenshot|evaluate|complete",
  "parameters": { ... },
  "needsConfirmation": false,
  "confidence": 0.95
}`;

    return await this.getDecision('You are a browser automation expert.', prompt, false);
  }

  /**
   * Analyze image with Vision API
   * @param {string} imageBase64 - Base64 encoded image
   * @param {string} prompt - Question or instruction about the image
   * @param {string} systemPrompt - System instructions
   * @returns {Promise<object>} Analysis result
   */
  async analyzeImage(imageBase64, prompt, systemPrompt = 'You are a visual analysis expert.') {
    try {
      const messages = [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ];

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      });

      const assistantMessage = response.content[0].text;

      // Try to parse as JSON
      try {
        const analysis = JSON.parse(assistantMessage);
        return { success: true, analysis };
      } catch (parseError) {
        // Return as text if not JSON
        return {
          success: true,
          analysis: {
            description: assistantMessage,
          },
        };
      }
    } catch (error) {
      console.error('Claude Vision API error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Analyze screenshot for element location and page understanding
   * @param {string} screenshotBase64 - Base64 screenshot
   * @param {string} userGoal - What user wants to do
   * @param {string} context - Additional context
   * @returns {Promise<object>} Analysis with recommendations
   */
  async analyzeScreenshot(screenshotBase64, userGoal, context = '') {
    const prompt = `Analyze this screenshot of a web page to help accomplish the user's goal.

User Goal: ${userGoal}
${context ? `\nContext: ${context}` : ''}

Please identify:
1. What type of page is this? (login, search, article, dashboard, etc.)
2. What are the key interactive elements visible? (buttons, links, forms, inputs)
3. What actions should be taken to accomplish the goal?
4. Are there any obstacles? (CAPTCHA, errors, warnings)

Respond in JSON format:
{
  "pageType": "login|search|article|dashboard|form|other",
  "visibleElements": [
    {"type": "button|link|input|form", "description": "what it looks like", "location": "where it is on screen"}
  ],
  "recommendedActions": [
    {"action": "click|type|navigate", "target": "description of element", "reason": "why"}
  ],
  "obstacles": ["any issues detected"],
  "confidence": 0.95
}`;

    const systemPrompt = 'You are an expert at analyzing web page screenshots to help with browser automation. Be precise about element locations and descriptions.';

    return await this.analyzeImage(screenshotBase64, prompt, systemPrompt);
  }

  /**
   * Find specific element in screenshot
   * @param {string} screenshotBase64 - Base64 screenshot
   * @param {string} elementDescription - What to find
   * @returns {Promise<object>} Element location and how to interact
   */
  async findElementInScreenshot(screenshotBase64, elementDescription) {
    const prompt = `Look at this screenshot and find the following element: "${elementDescription}"

If you find it, describe:
1. Where it is located on the page (top/middle/bottom, left/center/right)
2. What it looks like (color, size, text, icon)
3. How to identify it (visible text, nearby elements, unique features)
4. The best way to interact with it (CSS selector hints, unique identifiers)

Respond in JSON format:
{
  "found": true/false,
  "location": "description of where it is",
  "appearance": "what it looks like",
  "identifiers": ["text on button", "id or class hints", "nearby elements"],
  "recommendedSelector": "suggested CSS selector or text to search",
  "confidence": 0.95
}`;

    return await this.analyzeImage(screenshotBase64, prompt);
  }

  /**
   * Detect issues in screenshot (CAPTCHA, errors, etc.)
   * @param {string} screenshotBase64 - Base64 screenshot
   * @returns {Promise<object>} Detected issues
   */
  async detectIssuesInScreenshot(screenshotBase64) {
    const prompt = `Analyze this screenshot for any issues or obstacles that might prevent automation:

Look for:
1. CAPTCHA challenges (reCAPTCHA, hCaptcha, Cloudflare, etc.)
2. Error messages
3. 2FA / verification prompts
4. Access denied / blocked messages
5. Loading indicators or incomplete page loads
6. Pop-ups or overlays blocking content

Respond in JSON format:
{
  "issues": [
    {"type": "captcha|error|2fa|blocked|loading|popup", "description": "what you see", "severity": "high|medium|low"}
  ],
  "canProceed": true/false,
  "recommendation": "what to do next"
}`;

    return await this.analyzeImage(screenshotBase64, prompt);
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Get conversation history length
   */
  getHistoryLength() {
    return this.conversationHistory.length;
  }
}
