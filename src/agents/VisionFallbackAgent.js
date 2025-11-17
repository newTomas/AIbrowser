/**
 * VisionFallbackAgent - Uses Claude Vision API as fallback when HTML analysis fails
 */
export class VisionFallbackAgent {
  constructor(claudeClient, browserManager) {
    this.claudeClient = claudeClient;
    this.browserManager = browserManager;
    this.usageCount = 0;
  }

  /**
   * Analyze page using screenshot when HTML analysis is insufficient
   * @param {string} userGoal - User's goal
   * @param {string} context - Additional context (e.g., "element not found")
   * @returns {Promise<object>} Vision analysis result
   */
  async analyzeWithVision(userGoal, context = '') {
    console.log('\n📸 [VisionFallback] Using Claude Vision API for analysis...');

    try {
      // Take screenshot
      const screenshot = await this.browserManager.screenshot({ fullPage: false });
      this.usageCount++;

      // Analyze screenshot
      const result = await this.claudeClient.analyzeScreenshot(
        screenshot,
        userGoal,
        context
      );

      if (!result.success) {
        return {
          success: false,
          error: 'Vision analysis failed',
          details: result.error,
        };
      }

      console.log('[VisionFallback] Analysis complete');
      if (result.analysis?.obstacles?.length > 0) {
        console.log('⚠️  Obstacles detected:', result.analysis.obstacles);
      }

      return {
        success: true,
        analysis: result.analysis,
        usedVision: true,
      };
    } catch (error) {
      console.error('[VisionFallback] Error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Find specific element using vision
   * @param {string} elementDescription - What to find
   * @returns {Promise<object>} Element location information
   */
  async findElement(elementDescription) {
    console.log(`\n🔍 [VisionFallback] Looking for: "${elementDescription}"`);

    try {
      const screenshot = await this.browserManager.screenshot({ fullPage: false });
      this.usageCount++;

      const result = await this.claudeClient.findElementInScreenshot(
        screenshot,
        elementDescription
      );

      if (!result.success) {
        return {
          success: false,
          error: 'Vision element search failed',
        };
      }

      const analysis = result.analysis;

      if (analysis.found) {
        console.log('✓ [VisionFallback] Element found!');
        console.log(`  Location: ${analysis.location}`);
        console.log(`  Suggested selector: ${analysis.recommendedSelector}`);
      } else {
        console.log('✗ [VisionFallback] Element not found in screenshot');
      }

      return {
        success: true,
        found: analysis.found,
        elementInfo: analysis,
      };
    } catch (error) {
      console.error('[VisionFallback] Error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Detect issues using vision (CAPTCHA, errors, etc.)
   * @returns {Promise<object>} Detected issues
   */
  async detectIssues() {
    console.log('\n🔍 [VisionFallback] Scanning for issues with Vision API...');

    try {
      const screenshot = await this.browserManager.screenshot({ fullPage: false });
      this.usageCount++;

      const result = await this.claudeClient.detectIssuesInScreenshot(screenshot);

      if (!result.success) {
        return {
          success: false,
          error: 'Vision issue detection failed',
        };
      }

      const analysis = result.analysis;

      if (analysis.issues && analysis.issues.length > 0) {
        console.log('⚠️  [VisionFallback] Issues detected:');
        analysis.issues.forEach(issue => {
          console.log(`  - ${issue.type}: ${issue.description} (${issue.severity})`);
        });
      } else {
        console.log('✓ [VisionFallback] No issues detected');
      }

      return {
        success: true,
        issues: analysis.issues || [],
        canProceed: analysis.canProceed,
        recommendation: analysis.recommendation,
      };
    } catch (error) {
      console.error('[VisionFallback] Error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Decide if vision should be used based on situation
   * @param {object} situation - Current situation details
   * @returns {boolean} Whether to use vision
   */
  shouldUseVision(situation) {
    // Use vision if:
    // 1. HTML analysis failed or returned low confidence
    if (situation.htmlAnalysisFailed || (situation.confidence && situation.confidence < 0.5)) {
      return true;
    }

    // 2. Element not found after retries
    if (situation.elementNotFound && situation.retries >= 2) {
      return true;
    }

    // 3. Complex page structure detected
    if (situation.complexStructure) {
      return true;
    }

    // 4. Explicit request
    if (situation.forceVision) {
      return true;
    }

    return false;
  }

  /**
   * Get usage statistics
   */
  getStats() {
    return {
      usageCount: this.usageCount,
      timesUsed: this.usageCount,
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.usageCount = 0;
  }
}
