import Anthropic from '@anthropic-ai/sdk';
import { RiskAssessment, SecurityContext, Action, TaggerElement } from '@/types';
import { getConfig } from '@/utils/config';
import { logger } from '@/cli/Logger';

export class RiskEvaluator {
  private anthropic: Anthropic;
  private enabled: boolean;

  constructor() {
    const config = getConfig();
    this.anthropic = new Anthropic({
      apiKey: config.anthropicApiKey
    });
    this.enabled = config.enableRiskEvaluation;
  }

  /**
   * Evaluate risk of an action before execution
   */
  async evaluateRisk(context: SecurityContext): Promise<RiskAssessment> {
    // If risk evaluation is disabled, return low risk
    if (!this.enabled) {
      return {
        risk_level: 'LOW',
        reasoning: 'Risk evaluation is disabled',
        requires_confirmation: false
      };
    }

    try {
      logger.debug('Evaluating risk for action:', context.action);

      const prompt = this.buildRiskAssessmentPrompt(context);
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const assessment = this.parseRiskAssessment(response.content[0]);

      logger.debug('Risk assessment completed:', assessment);
      logger.security(assessment.reasoning, assessment.risk_level);

      return assessment;
    } catch (error) {
      logger.error('Risk evaluation failed:', error);

      // On error, be conservative and require confirmation
      return {
        risk_level: 'HIGH',
        reasoning: `Risk evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        requires_confirmation: true
      };
    }
  }

  /**
   * Build prompt for risk assessment
   */
  private buildRiskAssessmentPrompt(context: SecurityContext): string {
    const { action, current_url, target_element } = context;

    const elementInfo = target_element
      ? `Target Element:
- ID: ${target_element.id}
- Role: ${target_element.role}
- Text: "${target_element.text}"
- Selector: ${target_element.selector || 'N/A'}
- Has onclick: ${!!target_element.onclick}`
      : 'No specific target element';

    return `You are a security evaluator for a web automation agent. Assess the risk level of the following action.

Current Context:
- URL: ${current_url}
- Domain: ${this.extractDomain(current_url)}

Action to Evaluate:
- Tool: ${action.tool}
- Parameters: ${JSON.stringify(action.parameters, null, 2)}

${elementInfo}

Risk Assessment Criteria:
1. HIGH RISK:
   - Actions that could cause financial transactions
   - Actions that delete or modify important data
   - Actions that submit forms with sensitive information
   - Actions on suspicious or unknown domains
   - Actions that could trigger account changes
   - Actions that download or execute files

2. MEDIUM RISK:
   - Actions that navigate to new domains
   - Actions that submit forms (non-sensitive)
   - Actions that modify page content
   - Actions on external domains

3. LOW RISK:
   - Actions that only read or scroll the page
   - Actions that navigate within the same domain
   - Actions on trusted, well-known domains
   - Actions that interact with standard UI elements

Provide your assessment in the following JSON format:
{
  "risk_level": "HIGH|MEDIUM|LOW",
  "reasoning": "Detailed explanation of your decision",
  "requires_confirmation": true/false
}

Be conservative - if unsure, classify as higher risk.`;
  }

  /**
   * Parse risk assessment from Claude response
   */
  private parseRiskAssessment(content: any): RiskAssessment {
    try {
      // Extract JSON from response
      const text = content.type === 'text' ? content.text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (!parsed.risk_level || !parsed.reasoning || parsed.requires_confirmation === undefined) {
        throw new Error('Invalid risk assessment format');
      }

      // Validate risk_level
      const validRiskLevels = ['LOW', 'MEDIUM', 'HIGH'];
      if (!validRiskLevels.includes(parsed.risk_level)) {
        throw new Error(`Invalid risk level: ${parsed.risk_level}`);
      }

      return {
        risk_level: parsed.risk_level,
        reasoning: parsed.reasoning,
        requires_confirmation: Boolean(parsed.requires_confirmation)
      };
    } catch (error) {
      logger.error('Failed to parse risk assessment:', error);

      // Default to high risk on parsing error
      return {
        risk_level: 'HIGH',
        reasoning: `Failed to parse risk assessment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        requires_confirmation: true
      };
    }
  }

  /**
   * Check if action requires additional security checks
   */
  requiresSecurityCheck(action: Action): boolean {
    const highRiskTools = [
      'click_element',
      'type_text',
      'navigate_to'
    ];

    return highRiskTools.includes(action.tool);
  }

  /**
   * Evaluate URL safety
   */
  async evaluateUrlSafety(url: string): Promise<{ safe: boolean; reasoning: string }> {
    try {
      const domain = this.extractDomain(url);

      // Known safe domains
      const safeDomains = [
        'google.com',
        'github.com',
        'stackoverflow.com',
        'wikipedia.org',
        'youtube.com',
        'amazon.com',
        'microsoft.com',
        'apple.com'
      ];

      const isSafeDomain = safeDomains.some(safe => domain.includes(safe));

      if (isSafeDomain) {
        return {
          safe: true,
          reasoning: `Domain ${domain} is in the list of trusted domains`
        };
      }

      // Check for suspicious URL patterns
      const suspiciousPatterns = [
        /bit\.ly/,
        /tinyurl\.com/,
        /shortened/,
        /download/,
        /exe$/,
        /zip$/,
        /rar$/
      ];

      const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(url.toLowerCase()));

      if (isSuspicious) {
        return {
          safe: false,
          reasoning: `URL contains suspicious patterns that may indicate security risks`
        };
      }

      // Check protocol
      if (!url.startsWith('https://')) {
        return {
          safe: false,
          reasoning: 'URL does not use HTTPS protocol'
        };
      }

      return {
        safe: true,
        reasoning: `Domain ${domain} appears safe (standard checks passed)`
      };
    } catch (error) {
      return {
        safe: false,
        reasoning: `Error evaluating URL safety: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Check if element text contains sensitive information
   */
  hasSensitiveContent(element: TaggerElement): boolean {
    const sensitiveKeywords = [
      'password',
      'credit card',
      'ssn',
      'social security',
      'bank account',
      'delete',
      'remove',
      'confirm',
      'purchase',
      'buy',
      'checkout',
      'payment',
      'submit',
      'save changes'
    ];

    const text = element.text.toLowerCase();
    const role = element.role.toLowerCase();

    return sensitiveKeywords.some(keyword =>
      text.includes(keyword) || role.includes(keyword)
    );
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get security context for evaluation
   */
  async buildSecurityContext(
    action: Action,
    currentUrl: string,
    targetElementId?: number,
    get_element_fn?: (id: number) => Promise<TaggerElement | null>
  ): Promise<SecurityContext> {
    let targetElement: TaggerElement | undefined;

    if (targetElementId && get_element_fn) {
      try {
        targetElement = await get_element_fn(targetElementId);
      } catch (error) {
        logger.debug('Failed to get target element for security evaluation:', error);
      }
    }

    return {
      action,
      current_url: currentUrl,
      target_element: targetElement
    };
  }

  /**
   * Check if action should be blocked entirely
   */
  shouldBlockAction(action: Action, context: SecurityContext): boolean {
    const blocklist = [
      'eval',
      'execute',
      'download_file',
      'install_extension',
      'modify_settings'
    ];

    // Block by tool name
    if (blocklist.some(blocked => action.tool.includes(blocked))) {
      return true;
    }

    // Block suspicious parameters
    const suspiciousParams = JSON.stringify(action.parameters).toLowerCase();
    const blockedParamPatterns = [
      'javascript:',
      'data:',
      'vbscript:',
      'file://',
      'ftp://'
    ];

    return blockedParamPatterns.some(pattern => suspiciousParams.includes(pattern));
  }

  /**
   * Enable or disable risk evaluation
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info(`Risk evaluation ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if risk evaluation is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}