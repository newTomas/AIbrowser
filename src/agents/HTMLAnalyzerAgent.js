import * as cheerio from 'cheerio';
import { config } from '../../config/config.js';

/**
 * HTMLAnalyzerAgent - Combines DOM parsing with Claude semantic analysis
 *
 * Two-stage approach:
 * 1. DOM Parsing: Extract structured data from HTML using cheerio
 * 2. Claude Analysis: Semantic understanding of what's important for user goal
 * 3. NEW v2.2: Visibility verification for suggested selectors
 */
export class HTMLAnalyzerAgent {
  constructor(claudeClient, browserManager = null) {
    this.claudeClient = claudeClient;
    this.browserManager = browserManager; // NEW v2.2: Optional BrowserManager for visibility checks
  }

  /**
   * Analyze page HTML and provide structured summary
   * @param {string} html - Raw HTML content
   * @param {string} url - Current page URL
   * @param {string} userGoal - User's goal for context
   * @returns {Promise<object>} Structured page analysis
   */
  async analyzePage(html, url, userGoal = '') {
    try {
      // Stage 1: DOM Parsing
      const domData = this.extractDOMStructure(html, url);

      // Stage 2: Claude Semantic Analysis
      const semanticAnalysis = await this.performSemanticAnalysis(domData, userGoal);

      // Stage 3: NEW v2.2: Verify visibility of suggested selectors
      if (this.browserManager && semanticAnalysis.keyActions) {
        semanticAnalysis.keyActions = await this.verifySelectorsVisibility(
          semanticAnalysis.keyActions
        );
      }

      return {
        success: true,
        url,
        domData,
        semanticAnalysis,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[HTMLAnalyzerAgent] Error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Stage 1: Extract structured data from HTML using cheerio
   * @param {string} html - Raw HTML
   * @param {string} url - Page URL
   * @returns {object} Structured DOM data
   */
  extractDOMStructure(html, url) {
    const $ = cheerio.load(html);

    // Remove script and style tags
    $('script, style, noscript').remove();

    const domData = {
      url,
      metadata: this.extractMetadata($),
      headings: this.extractHeadings($),
      text: this.extractMainText($),
      links: this.extractLinks($, url),
      buttons: this.extractButtons($),
      forms: this.extractForms($),
      inputs: this.extractInputs($),
      images: this.extractImages($, url),
      structure: this.analyzeStructure($),
    };

    return domData;
  }

  /**
   * Extract metadata (title, description, keywords, etc.)
   */
  extractMetadata($) {
    return {
      title: $('title').text().trim() || '',
      description: $('meta[name="description"]').attr('content') || '',
      keywords: $('meta[name="keywords"]').attr('content') || '',
      ogTitle: $('meta[property="og:title"]').attr('content') || '',
      ogDescription: $('meta[property="og:description"]').attr('content') || '',
      lang: $('html').attr('lang') || '',
    };
  }

  /**
   * Extract headings hierarchy
   */
  extractHeadings($) {
    const headings = [];

    $('h1, h2, h3, h4, h5, h6').each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 0 && text.length < 200) {
        headings.push({
          level: el.name,
          text,
        });
      }
    });

    return headings.slice(0, 20); // Limit to 20 headings
  }

  /**
   * Extract main text content
   */
  extractMainText($) {
    // Try to find main content areas
    const mainSelectors = [
      'main',
      'article',
      '[role="main"]',
      '#main',
      '#content',
      '.content',
      'body',
    ];

    let mainText = '';

    for (const selector of mainSelectors) {
      const element = $(selector).first();
      if (element.length) {
        // Clone and remove unwanted elements
        const clone = element.clone();
        clone.find('script, style, nav, header, footer, aside').remove();
        mainText = clone.text();
        break;
      }
    }

    // Clean up text
    mainText = mainText
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000); // First 2000 chars

    return mainText;
  }

  /**
   * Extract links with context
   * Now also includes elements with cursor: pointer (clickable blocks)
   */
  extractLinks($, baseUrl) {
    const links = [];

    // Extract regular links
    $('a[href]').each((i, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      const text = $el.text().trim();

      // Skip empty links, anchors, and javascript:
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
        return;
      }

      // Skip if no visible text
      if (!text || text.length === 0) {
        return;
      }

      links.push({
        text: text.slice(0, 100),
        href,
        title: $el.attr('title') || '',
        ariaLabel: $el.attr('aria-label') || '',
        type: 'link',
        selector: this.generateBestSelector($el, el, $),
      });
    });

    // Extract clickable elements with cursor: pointer
    // NEW v2.2.1: Also find clickable parents with text in children
    const allElements = $('*').toArray();

    allElements.forEach((el, index) => {
      // Skip too deep nesting to avoid infinite loops
      if (index > 5000) return;

      const $el = $(el);

      // Check if element is clickable (has cursor/onclick/etc)
      const styleAttr = $el.attr('style') || '';
      const hasStyleCursor = styleAttr.includes('cursor') &&
        (styleAttr.includes('cursor: pointer') || styleAttr.includes('cursor:pointer'));

      const classes = $el.attr('class') || '';
      const hasCursorClass = classes.includes('cursor-pointer') ||
        classes.includes('clickable') ||
        classes.includes('pointer');

      const onclick = $el.attr('onclick') || '';
      const hasEventHandler = onclick.length > 0 ||
        $el.attr('ng-click') ||
        $el.attr('v-on:click') ||
        $el.attr('@click') ||
        $el.attr('data-click');

      // Skip if not clickable
      if (!hasStyleCursor && !hasCursorClass && !hasEventHandler) {
        return;
      }

      // Skip if this is actually a link or button (already captured)
      if ($el.is('a, button, input[type="button"], input[type="submit"]')) {
        return;
      }

      // Get text from element itself OR from first meaningful child
      let $textSource = $el;
      let text = $el.text().trim();

      // If element has no direct text, look for text in children
      if (!text || text.length === 0) {
        $el.children().each((i, child) => {
          const childText = $(child).text().trim();
          if (childText && childText.length > 0) {
            text = childText;
            $textSource = $(child);
            return false; // Stop after finding first text
          }
        });
      }

      // Skip if no text content anywhere
      if (!text || text.length === 0) {
        return;
      }

      // Generate selector for the clickable PARENT (not the text child)
      const selector = this.generateBestSelector($el, el, $);

      // But use the text from wherever we found it
      links.push({
        text: text.slice(0, 100),
        href: '', // No actual href for clickable blocks
        title: $el.attr('title') || '',
        ariaLabel: $el.attr('aria-label') || '',
        type: 'clickable-block',
        selector: selector, // Selector for clickable parent
        clickableBy: hasStyleCursor ? 'style-cursor' :
                   hasCursorClass ? 'cursor-class' :
                   hasEventHandler ? 'event-handler' : 'unknown',
        textSource: $textSource.is($el) ? 'self' : 'child', // Track where text came from
      });
    });

    // Sort by relevance (links first, then clickable blocks)
    links.sort((a, b) => {
      if (a.type === 'link' && b.type !== 'link') return -1;
      if (a.type !== 'link' && b.type === 'link') return 1;
      return 0;
    });

    return links.slice(0, 50); // Limit to 50 links
  }

  /**
   * Extract buttons with context and actionable selectors
   */
  extractButtons($) {
    const buttons = [];

    $('button, input[type="button"], input[type="submit"], [role="button"]').each((i, el) => {
      const $el = $(el);
      const text = $el.text().trim() || $el.attr('value') || '';

      if (text.length === 0) {
        return;
      }

      const id = $el.attr('id') || '';
      const classes = $el.attr('class') || '';
      const ariaLabel = $el.attr('aria-label') || '';

      // Generate best selector for this button
      const selector = this.generateBestSelector($el, el, $);

      buttons.push({
        text: text.slice(0, 100),
        type: el.name === 'input' ? $el.attr('type') : 'button',
        id,
        class: classes,
        ariaLabel,
        disabled: $el.attr('disabled') !== undefined,
        selector, // IMPROVED: Add actionable selector
      });
    });

    return buttons.slice(0, 30); // Limit to 30 buttons
  }

  /**
   * Extract forms with detailed input information
   */
  extractForms($) {
    const forms = [];

    $('form').each((i, el) => {
      const $form = $(el);

      const inputs = [];
      $form.find('input, textarea, select').each((j, input) => {
        const $input = $(input);

        inputs.push({
          type: input.name === 'select' ? 'select' : $input.attr('type') || 'text',
          name: $input.attr('name') || '',
          id: $input.attr('id') || '',
          placeholder: $input.attr('placeholder') || '',
          label: this.findLabel($, $input),
          required: $input.attr('required') !== undefined,
          ariaLabel: $input.attr('aria-label') || '',
        });
      });

      forms.push({
        action: $form.attr('action') || '',
        method: ($form.attr('method') || 'get').toUpperCase(),
        id: $form.attr('id') || '',
        inputs,
      });
    });

    return forms;
  }

  /**
   * Find label for input field
   */
  findLabel($, $input) {
    const id = $input.attr('id');
    if (id) {
      const label = $(`label[for="${id}"]`).text().trim();
      if (label) return label;
    }

    const parentLabel = $input.closest('label').text().trim();
    if (parentLabel) return parentLabel;

    return '';
  }

  /**
   * Extract standalone input fields (not in forms)
   */
  extractInputs($) {
    const inputs = [];

    $('input, textarea, select').each((i, el) => {
      const $el = $(el);

      // Skip if inside a form (already captured)
      if ($el.closest('form').length > 0) {
        return;
      }

      inputs.push({
        type: el.name === 'select' ? 'select' : $el.attr('type') || 'text',
        name: $el.attr('name') || '',
        id: $el.attr('id') || '',
        placeholder: $el.attr('placeholder') || '',
        label: this.findLabel($, $el),
      });
    });

    return inputs.slice(0, 20); // Limit to 20 inputs
  }

  /**
   * Extract images with alt text
   */
  extractImages($, baseUrl) {
    const images = [];

    $('img[src]').each((i, el) => {
      const $el = $(el);
      const alt = $el.attr('alt') || '';
      const src = $el.attr('src') || '';

      // Only include images with alt text or meaningful src
      if (alt || src.includes('logo') || src.includes('icon')) {
        images.push({
          alt,
          src: src.slice(0, 100),
        });
      }
    });

    return images.slice(0, 10); // Limit to 10 images
  }

  /**
   * Analyze page structure
   */
  analyzeStructure($) {
    return {
      hasNav: $('nav').length > 0,
      hasHeader: $('header').length > 0,
      hasFooter: $('footer').length > 0,
      hasMain: $('main, [role="main"]').length > 0,
      hasSidebar: $('aside, .sidebar').length > 0,
      formCount: $('form').length,
      buttonCount: $('button, input[type="button"], input[type="submit"]').length,
      linkCount: $('a[href]').length,
      headingCount: $('h1, h2, h3, h4, h5, h6').length,
    };
  }

  /**
   * Generate best CSS selector for an element
   * Priority: ID > unique attribute > class + text > nth-child
   * @param {Cheerio} $el - Cheerio element
   * @param {Element} el - Raw element
   * @returns {string} Best CSS selector
   */
  generateBestSelector($el, el, $ = null) {
    // Check if Cheerio context is available
    if (!$) {
      console.error('[HTMLAnalyzerAgent] generateBestSelector: Cheerio context ($) not provided');
      return el.name || 'element';
    }

    // 1. Try ID (most reliable)
    const id = $el.attr('id');
    if (id && id.length > 0) {
      return `#${id}`;
    }

    // 2. Try unique attributes (data-testid, name, etc.)
    const testId = $el.attr('data-testid') || $el.attr('data-test-id');
    if (testId) {
      return `[data-testid="${testId}"]`;
    }

    const name = $el.attr('name');
    if (name && name.length > 0) {
      return `${el.name}[name="${name}"]`;
    }

    // 3. Try aria-label
    const ariaLabel = $el.attr('aria-label');
    if (ariaLabel && ariaLabel.length > 0) {
      return `${el.name}[aria-label="${ariaLabel}"]`;
    }

    // 4. Try role attribute (common for div buttons)
    const role = $el.attr('role');
    if (role) {
      return `${el.name}[role="${role}"]`;
    }

    // 5. Try combination with data attributes
    const dataAttrs = Object.keys(el.attribs || {}).filter(attr => attr.startsWith('data-'));
    if (dataAttrs.length > 0) {
      const firstDataAttr = dataAttrs[0];
      const value = $el.attr(firstDataAttr);
      return `${el.name}[${firstDataAttr}="${value}"]`;
    }

    // 6. Try class with uniqueness check
    const classes = $el.attr('class');
    if (classes) {
      const classList = classes.split(' ').filter(c => c.length > 0);

      // Try to find unique class combination
      for (let i = 0; i < Math.min(classList.length, 3); i++) {
        const classSelector = classList.slice(0, i + 1).map(c => `.${c}`).join('');
        const selector = `${el.name}${classSelector}`;

        // Check if this selector is unique enough (not too many matches)
        const matchCount = $(selector).length;
        if (matchCount === 1) {
          return selector; // Unique selector found!
        } else if (matchCount <= 10 && i === classList.length - 1) {
          // Multiple matches but manageable - return with note
          return selector; // Will need text matching in click()
        }
      }
    }

    // 7. Last resort: element type
    return el.name;
  }

  /**
   * Get compact summary for main context (to avoid bloating)
   * Returns only essential information
   * @param {object} analysisResult - Full analysis result
   * @returns {object} Compact summary
   */
  getCompactSummary(analysisResult) {
    if (!analysisResult.success) {
      return { available: false };
    }

    const { semanticAnalysis, domData } = analysisResult;

    // Extract only top priority elements with selectors
    const actionableElements = [];

    // Add clickable links and blocks (max 8)
    if (domData.links) {
      domData.links.slice(0, 8).forEach(link => {
        // Include only links with selectors (clickable elements)
        if (link.selector) {
          actionableElements.push({
            type: link.type === 'clickable-block' ? 'clickable-block' : 'link',
            cssSelector: link.selector,
            displayText: link.text,
            href: link.href,
            clickableBy: link.clickableBy || null,
          });
        }
      });
    }

    // Add top buttons (max 10)
    if (domData.buttons) {
      domData.buttons.slice(0, 10).forEach(btn => {
        actionableElements.push({
          type: 'button',
          cssSelector: btn.selector,  // USE THIS for click action
          displayText: btn.text,       // For reference only (what user sees)
          disabled: btn.disabled,
        });
      });
    }

    // Add forms with input selectors (max 2 forms)
    const forms = [];
    if (domData.forms) {
      domData.forms.slice(0, 2).forEach((form, idx) => {
        const inputs = form.inputs.map(input => ({
          type: input.type,
          name: input.name,
          id: input.id,
          label: input.label,
          selector: input.id ? `#${input.id}` : input.name ? `[name="${input.name}"]` : null,
        }));

        forms.push({
          formIndex: idx,
          method: form.method,
          inputCount: inputs.length,
          inputs: inputs.slice(0, 5), // Max 5 inputs per form
        });
      });
    }

    // NEW v2.2.1: Verbose logging of all clickable elements
    if (config.agent.verboseLogging) {
      console.log('\n🔍 === VERBOSE: All Clickable Elements Found ===');
      console.log(`Total actionable elements: ${actionableElements.length}`);

      // Group by type
      const buttons = actionableElements.filter(el => el.type === 'button');
      const links = actionableElements.filter(el => el.type === 'link');
      const clickableBlocks = actionableElements.filter(el => el.type === 'clickable-block');

      if (buttons.length > 0) {
        console.log(`\n📋 Buttons (${buttons.length}):`);
        buttons.forEach((btn, i) => {
          const status = btn.disabled ? ' [DISABLED]' : '';
          console.log(`  ${i + 1}. "${btn.displayText}" → ${btn.cssSelector}${status}`);
        });
      }

      if (links.length > 0) {
        console.log(`\n🔗 Links (${links.length}):`);
        links.forEach((link, i) => {
          const href = link.href ? ` → ${link.href}` : '';
          console.log(`  ${i + 1}. "${link.displayText}" → ${link.cssSelector}${href}`);
        });
      }

      if (clickableBlocks.length > 0) {
        console.log(`\n🖱️  Clickable Blocks (${clickableBlocks.length}):`);
        clickableBlocks.forEach((block, i) => {
          const method = block.clickableBy ? ` [${block.clickableBy}]` : '';
          console.log(`  ${i + 1}. "${block.displayText}" → ${block.cssSelector}${method}`);
        });
      }

      if (forms.length > 0) {
        console.log(`\n📝 Forms (${forms.length}):`);
        forms.forEach((form, i) => {
          console.log(`  ${i + 1}. Form (${form.method}): ${form.inputCount} inputs`);
          form.inputs.forEach((input, j) => {
            const selector = input.selector ? ` → ${input.selector}` : '';
            console.log(`     - ${input.type}: "${input.label || input.name}"${selector}`);
          });
        });
      }

      console.log('=== END VERBOSE LOG ===\n');
    }

    return {
      available: true,
      pageType: semanticAnalysis?.pageType || 'unknown',
      pagePurpose: semanticAnalysis?.pagePurpose || domData.metadata.title,

      // Key actionable elements with selectors
      actionableElements: actionableElements.slice(0, 15), // Changed from topButtons to be more general
      forms,

      // Semantic insights (compact)
      keyActions: semanticAnalysis?.recommendedActions?.slice(0, 3) || [],
      potentialIssues: semanticAnalysis?.potentialIssues?.slice(0, 2) || [],

      // Structure info
      structure: {
        hasLogin: forms.some(f => f.inputs.some(i => i.type === 'password')),
        hasSearch: forms.some(f => f.inputs.some(i => i.type === 'search')),
        buttonCount: domData.structure.buttonCount,
        formCount: domData.structure.formCount,
      },
    };
  }

  /**
   * Stage 2: Perform semantic analysis using Claude
   * @param {object} domData - Structured DOM data
   * @param {string} userGoal - User's goal
   * @returns {Promise<object>} Semantic analysis
   */
  async performSemanticAnalysis(domData, userGoal) {
    const prompt = this.buildAnalysisPrompt(domData, userGoal);

    const systemPrompt = `You are an expert web page analyzer. Your job is to understand what's important on a web page in the context of a user's goal.

Analyze the structured page data and provide:
1. Page purpose: What is this page for?
2. Key elements: What are the most important elements for the user's goal?
3. Recommended actions: What should the user do next?
4. Potential issues: Any obstacles or challenges?

Respond in JSON format:
{
  "pagePurpose": "Brief description",
  "pageType": "login|search|article|product|dashboard|form|other",
  "keyElements": [
    {"type": "button|link|form|input", "description": "what it does", "selector": "how to find it", "priority": "high|medium|low"}
  ],
  "recommendedActions": ["action 1", "action 2"],
  "potentialIssues": ["issue 1"],
  "confidence": 0.95
}`;

    const response = await this.claudeClient.getDecision(systemPrompt, prompt, false);

    if (response.success && response.decision) {
      return response.decision;
    }

    return {
      error: 'Failed to analyze page semantically',
      fallback: true,
    };
  }

  /**
   * Build analysis prompt from DOM data
   */
  buildAnalysisPrompt(domData, userGoal) {
    let prompt = '# Web Page Analysis Request\n\n';

    if (userGoal) {
      prompt += `## User Goal\n${userGoal}\n\n`;
    }

    prompt += `## Page Information\n`;
    prompt += `URL: ${domData.url}\n`;
    prompt += `Title: ${domData.metadata.title}\n`;

    if (domData.metadata.description) {
      prompt += `Description: ${domData.metadata.description}\n`;
    }

    // Structure summary
    prompt += `\n## Page Structure\n`;
    prompt += `- Forms: ${domData.structure.formCount}\n`;
    prompt += `- Buttons: ${domData.structure.buttonCount}\n`;
    prompt += `- Links: ${domData.structure.linkCount}\n`;
    prompt += `- Headings: ${domData.structure.headingCount}\n`;

    // Headings
    if (domData.headings.length > 0) {
      prompt += `\n## Headings\n`;
      domData.headings.slice(0, 10).forEach(h => {
        prompt += `- ${h.level}: ${h.text}\n`;
      });
    }

    // Main text preview
    if (domData.text) {
      prompt += `\n## Main Content (preview)\n`;
      prompt += `${domData.text.slice(0, 500)}...\n`;
    }

    // Buttons
    if (domData.buttons.length > 0) {
      prompt += `\n## Buttons (${domData.buttons.length})\n`;
      domData.buttons.slice(0, 15).forEach(btn => {
        prompt += `- "${btn.text}"`;
        if (btn.id) prompt += ` (id: ${btn.id})`;
        if (btn.disabled) prompt += ` [DISABLED]`;
        prompt += '\n';
      });
    }

    // Forms
    if (domData.forms.length > 0) {
      prompt += `\n## Forms (${domData.forms.length})\n`;
      domData.forms.forEach((form, i) => {
        prompt += `\nForm ${i + 1}: ${form.method} ${form.action || '(current page)'}\n`;
        prompt += `Inputs: ${form.inputs.length}\n`;
        form.inputs.forEach(input => {
          prompt += `  - ${input.type}`;
          if (input.name) prompt += ` (name: ${input.name})`;
          if (input.label) prompt += ` - ${input.label}`;
          if (input.placeholder) prompt += ` [${input.placeholder}]`;
          if (input.required) prompt += ` *required*`;
          prompt += '\n';
        });
      });
    }

    // Important links
    if (domData.links.length > 0) {
      prompt += `\n## Important Links (showing ${Math.min(20, domData.links.length)} of ${domData.links.length})\n`;
      domData.links.slice(0, 20).forEach(link => {
        prompt += `- ${link.text}\n`;
        if (link.ariaLabel && link.ariaLabel !== link.text) {
          prompt += `  (${link.ariaLabel})\n`;
        }
      });
    }

    prompt += `\n## Analysis Request\n`;
    prompt += `Based on the above information, provide a semantic analysis of this page.`;
    if (userGoal) {
      prompt += ` Focus on elements relevant to the user's goal: "${userGoal}"`;
    }

    return prompt;
  }

  /**
   * Quick analysis for simple pages (no Claude call)
   * @param {object} domData - DOM data
   * @returns {object} Basic analysis
   */
  quickAnalysis(domData) {
    const analysis = {
      pagePurpose: domData.metadata.title || 'Unknown',
      pageType: 'other',
      keyElements: [],
      confidence: 0.5,
      quick: true,
    };

    // Detect page type
    if (domData.forms.some(f => f.inputs.some(i => i.type === 'password'))) {
      analysis.pageType = 'login';
      analysis.pagePurpose = 'Login page';
    } else if (domData.forms.some(f => f.inputs.some(i => i.type === 'search'))) {
      analysis.pageType = 'search';
    } else if (domData.forms.length > 0) {
      analysis.pageType = 'form';
    } else if (domData.headings.length > 5 && domData.text.length > 1000) {
      analysis.pageType = 'article';
    }

    // Add key elements
    domData.buttons.slice(0, 5).forEach(btn => {
      analysis.keyElements.push({
        type: 'button',
        description: btn.text,
        selector: btn.id ? `#${btn.id}` : `.${btn.class.split(' ')[0]}`,
        priority: 'medium',
      });
    });

    return analysis;
  }

  /**
   * NEW v2.2: Verify visibility of selectors
   * Checks if suggested selectors are actually clickable
   *
   * @param {Array} keyActions - Array of suggested actions with selectors
   * @returns {Promise<Array>} Updated actions with visibility info
   */
  async verifySelectorsVisibility(keyActions) {
    if (!this.browserManager) {
      return keyActions; // No browser manager, skip verification
    }

    const verifiedActions = [];

    for (const action of keyActions) {
      if (!action.selector) {
        verifiedActions.push(action);
        continue;
      }

      try {
        // Check if element is clickable
        const visibilityInfo = await this.browserManager.checkElementClickability(action.selector);

        // Add visibility information to action
        const verifiedAction = {
          ...action,
          visibility: {
            clickable: visibilityInfo.clickable,
            reason: visibilityInfo.reason,
            coveredBy: visibilityInfo.coveringElement || null,
            isModal: visibilityInfo.isModal || false
          }
        };

        // If not clickable, add warning
        if (!visibilityInfo.clickable) {
          verifiedAction.warning = `Element may not be clickable: ${visibilityInfo.reason}`;
        }

        verifiedActions.push(verifiedAction);
      } catch (error) {
        // If verification fails, keep original action
        console.log(`⚠️  Could not verify visibility for ${action.selector}: ${error.message}`);
        verifiedActions.push(action);
      }
    }

    return verifiedActions;
  }
}
