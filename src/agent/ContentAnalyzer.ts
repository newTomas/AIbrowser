import { Observation } from '@/types';
import { logger } from '@/cli/Logger';

export interface PageHealth {
  isHealthy: boolean;
  contentScore: number; // 0-100
  issues: string[];
  recommendations: string[];
  loadState: 'empty' | 'loading' | 'error' | 'partial' | 'complete';
  elementCount: number;
  interactiveElements: number;
  hasExpectedContent?: boolean;
}

export class ContentAnalyzer {
  private static readonly MIN_ELEMENTS_THRESHOLD = 5;
  private static readonly MIN_INTERACTIVE_THRESHOLD = 1;
  private static readonly EMPTY_CONTENT_INDICATORS = [
    '404', 'not found', 'error', 'page not found', 'access denied',
    'loading...', 'please wait', 'refresh', 'try again', 'service unavailable'
  ];

  /**
   * Analyze page health based on observation
   */
  static analyzePageHealth(observation: Observation): PageHealth {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let contentScore = 50; // Start at neutral

    const elementCount = observation.elements.length;
    const interactiveElements = observation.elements.filter(el =>
      ['button', 'input', 'a', 'select', 'textarea'].includes(el.role)
    ).length;

    // Check for completely empty pages
    if (elementCount === 0) {
      return {
        isHealthy: false,
        contentScore: 0,
        issues: ['No elements found on page'],
        recommendations: ['Try a different website', 'Check if URL is correct'],
        loadState: 'empty',
        elementCount: 0,
        interactiveElements: 0
      };
    }

    // Analyze element count
    if (elementCount < this.MIN_ELEMENTS_THRESHOLD) {
      issues.push(`Very few elements detected (${elementCount})`);
      recommendations.push('Wait for page to load completely');
      contentScore -= 30;
    } else {
      contentScore += Math.min(elementCount / 2, 30); // Up to 30 points for elements
    }

    // Analyze interactive elements
    if (interactiveElements < this.MIN_INTERACTIVE_THRESHOLD) {
      issues.push(`No interactive elements found (${interactiveElements})`);
      recommendations.push('Page may still be loading or be non-functional');
      contentScore -= 20;
    } else {
      contentScore += Math.min(interactiveElements * 10, 20); // Up to 20 points for interactive elements
    }

    // Check for loading indicators in text content
    const pageText = observation.elements.map(el => el.text).join(' ').toLowerCase();
    const hasLoadingIndicators = this.EMPTY_CONTENT_INDICATORS.some(indicator =>
      pageText.includes(indicator.toLowerCase())
    );

    if (hasLoadingIndicators) {
      issues.push('Page shows loading/error indicators');
      recommendations.push('Wait for loading to complete or try alternative source');
      contentScore -= 40;
    }

    // Analyze page title
    if (observation.page_info.title) {
      const titleText = observation.page_info.title.toLowerCase();
      if (titleText.includes('error') || titleText.includes('404') || titleText.includes('not found')) {
        issues.push('Page title indicates error');
        recommendations.push('Try a different URL or alternative website');
        contentScore -= 50;
      }
    }

    // Determine load state
    let loadState: PageHealth['loadState'];
    if (contentScore < 20) {
      loadState = 'error';
    } else if (contentScore < 40) {
      loadState = 'empty';
    } else if (contentScore < 60) {
      loadState = 'loading';
    } else if (contentScore < 80) {
      loadState = 'partial';
    } else {
      loadState = 'complete';
    }

    const isHealthy = contentScore >= 60 && issues.length === 0;

    return {
      isHealthy,
      contentScore: Math.max(0, Math.min(100, contentScore)),
      issues,
      recommendations,
      loadState,
      elementCount,
      interactiveElements
    };
  }

  /**
   * Check if page is suitable for specific content extraction
   */
  static isSuitableForContentExtraction(
    observation: Observation,
    contentType: 'email' | 'form' | 'data' | 'text'
  ): { suitable: boolean; reason: string; confidence: number } {
    const health = this.analyzePageHealth(observation);

    if (!health.isHealthy) {
      return {
        suitable: false,
        reason: `Page unhealthy (${health.loadState}): ${health.issues.join(', ')}`,
        confidence: 0.2
      };
    }

    // Check for specific content indicators
    const pageText = observation.elements.map(el => el.text.toLowerCase()).join(' ');

    switch (contentType) {
      case 'email':
        const hasEmailIndicators = pageText.includes('@') ||
          pageText.includes('email') ||
          pageText.includes('contact') ||
          pageText.includes('mail');

        if (!hasEmailIndicators) {
          return {
            suitable: false,
            reason: 'No email-related content detected',
            confidence: 0.3
          };
        }
        break;

      case 'form':
        const hasFormElements = observation.elements.some(el =>
          ['input', 'textarea', 'select'].includes(el.role)
        );

        if (!hasFormElements) {
          return {
            suitable: false,
            reason: 'No form elements detected',
            confidence: 0.2
          };
        }
        break;

      case 'data':
        if (observation.elements.length < 10) {
          return {
            suitable: false,
            reason: 'Insufficient content for data extraction',
            confidence: 0.4
          };
        }
        break;
    }

    return {
      suitable: true,
      reason: 'Page appears suitable for content extraction',
      confidence: health.contentScore / 100
    };
  }

  /**
   * Generate page health summary for prompts
   */
  static generateHealthSummary(health: PageHealth): string {
    if (health.isHealthy) {
      return `✅ Page appears healthy (${health.contentScore}/100 score, ${health.elementCount} elements)`;
    }

    let summary = `⚠️  Page issues detected (${health.contentScore}/100 score):\n`;

    if (health.issues.length > 0) {
      summary += 'Issues: ' + health.issues.join('; ') + '\n';
    }

    if (health.recommendations.length > 0) {
      summary += 'Recommendations: ' + health.recommendations.join('; ');
    }

    return summary;
  }
}