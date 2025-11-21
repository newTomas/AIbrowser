/**
 * Utility functions for detecting situations that require human assistance
 */

/**
 * Detect CAPTCHA challenges on the page
 * @param {object} pageContent - Page content from BrowserManager
 * @param {string} html - Raw HTML content
 * @returns {object} Detection result with type and confidence
 */
export function detectCaptcha(pageContent, html = '') {
  // Universal CAPTCHA indicators - works with any CAPTCHA provider
  const passiveCaptchaIndicators = [
    // Generic CAPTCHA keywords
    'captcha',
    'recaptcha',
    'hcaptcha',
    'grecaptcha',
    'g-recaptcha',
    'h-captcha',
    'data-sitekey',
    // Challenge-related
    'challenge',
    'cf-challenge',
    'challenge-platform',
    // Verification-related
    'verification',
    'human verification',
    'verify you are human',
    'prove you are not a robot',
    'security check',
    // Service-specific
    '/recaptcha/',
    'hcaptcha.com',
    'cloudflare',
    'cf_clearance',
    'ray-id',
  ];

  // Indicators of ACTIVE captcha challenge (not just passive scripts)
  const activeCaptchaIndicators = [
    'challenge-form',
    'captcha-checkbox',
    'recaptcha-checkbox',
    'captcha visible',
    'complete the captcha',
    'solve the captcha',
    'please verify',
    'i\'m not a robot',
    'verify you\'re human',
    'security challenge',
    'checking your browser',
    'just a moment',
    'please wait while we verify',
  ];

  const url = pageContent?.url || '';
  const title = pageContent?.title?.toLowerCase() || '';
  const bodyText = pageContent?.body?.toLowerCase() || '';
  const htmlLower = html.toLowerCase();

  const detected = {
    found: false,
    confidence: 0,
    indicators: [],
    isActive: false, // Indicates if captcha is actively blocking (not just passive scripts)
  };

  // Check URL - high confidence if URL itself is a captcha service
  const captchaUrlKeywords = ['recaptcha', 'hcaptcha', 'captcha', 'challenge', 'verify'];
  if (captchaUrlKeywords.some(keyword => url.includes(keyword))) {
    detected.found = true;
    detected.confidence = 0.9;
    detected.isActive = true;
    detected.indicators.push('URL contains CAPTCHA service');
    return detected; // Return early - definitely active captcha
  }

  // Check for ACTIVE captcha indicators first (higher priority)
  let activeIndicatorCount = 0;
  for (const indicator of activeCaptchaIndicators) {
    if (title.includes(indicator) || bodyText.includes(indicator)) {
      detected.found = true;
      detected.isActive = true;
      activeIndicatorCount++;
      detected.indicators.push(`Active CAPTCHA indicator: ${indicator}`);
      detected.confidence = Math.min(0.95, detected.confidence + 0.3);
    }
  }

  // If we found active indicators, we're confident this is a real challenge
  if (activeIndicatorCount > 0) {
    detected.confidence = Math.min(1.0, detected.confidence + 0.2);
    return detected;
  }

  // Check for passive indicators - but be conservative
  let passiveIndicatorCount = 0;
  for (const keyword of passiveCaptchaIndicators) {
    // Only check HTML for passive indicators, not title/body
    // This prevents false positives from background scripts
    if (htmlLower.includes(keyword)) {
      detected.found = true;
      passiveIndicatorCount++;
      detected.indicators.push(`Passive element found: ${keyword}`);

      // Lower confidence increase for passive indicators
      detected.confidence = Math.min(0.5, detected.confidence + 0.1);
    }
  }

  // Check for common CAPTCHA patterns in page structure
  if (pageContent?.buttons) {
    const buttons = pageContent.buttons.map(b => b.text?.toLowerCase() || '');
    const hasVerifyButton = buttons.some(b =>
      b.includes('verify') ||
      b.includes('i\'m not a robot') ||
      b.includes('complete captcha')
    );

    if (hasVerifyButton && detected.found) {
      detected.isActive = true;
      detected.confidence = Math.min(1.0, detected.confidence + 0.3);
      detected.indicators.push('Verification button detected');
    }
  }

  // Special check: if page body is very short and contains captcha keywords
  // it's likely an interstitial captcha page (active challenge)
  if (bodyText.length < 500 && passiveIndicatorCount > 2) {
    detected.isActive = true;
    detected.confidence = Math.min(0.9, detected.confidence + 0.3);
    detected.indicators.push('Appears to be captcha interstitial page');
  }

  // If we only found passive indicators (like background scripts), lower confidence significantly
  if (detected.found && !detected.isActive && passiveIndicatorCount < 3) {
    detected.confidence = Math.min(0.4, detected.confidence);
    detected.indicators.push('Note: Only passive CAPTCHA elements found (may not need solving)');
  }

  return detected;
}

/**
 * Detect 2FA / authentication prompts
 * @param {object} pageContent - Page content from BrowserManager
 * @returns {object} Detection result
 */
export function detect2FA(pageContent) {
  const twoFAKeywords = [
    'verification code',
    'authenticator',
    'two-factor',
    '2fa',
    'security code',
    'enter code',
    'sms code',
    '6-digit code',
    'authentication code',
    'confirm your identity',
    'verify your identity',
    'one-time password',
    'otp',
  ];

  const title = pageContent?.title?.toLowerCase() || '';
  const bodyText = pageContent?.body?.toLowerCase() || '';

  const detected = {
    found: false,
    confidence: 0,
    indicators: [],
  };

  // Check for keywords (only in title or prominent body text)
  // IMPROVED: Only trigger if keywords are in title OR very prominent in body
  for (const keyword of twoFAKeywords) {
    if (title.includes(keyword)) {
      detected.found = true;
      detected.indicators.push(`Keyword in title: ${keyword}`);
      detected.confidence = Math.min(0.95, detected.confidence + 0.3);
    } else if (bodyText.length < 500 && bodyText.includes(keyword)) {
      // Only in short body text (interstitial pages)
      detected.found = true;
      detected.indicators.push(`Keyword in short body: ${keyword}`);
      detected.confidence = Math.min(0.8, detected.confidence + 0.2);
    }
  }

  // Check for forms with specific input types
  // IMPROVED: More strict detection to avoid false positives
  if (pageContent?.forms) {
    for (const form of pageContent.forms) {
      const inputs = form.inputs || [];

      // Look for code/PIN inputs with stricter criteria
      const codeInputs = inputs.filter(input => {
        const name = (input.name || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const label = (input.label || '').toLowerCase();
        const type = (input.type || '').toLowerCase();

        // Exclude fields that are obviously NOT for 2FA
        const isEmailField = type === 'email' || name.includes('email') || id.includes('email');
        const isPasswordField = type === 'password';
        const isPromoCode = name.includes('promo') || id.includes('promo') || placeholder.includes('promo');
        const isCouponCode = name.includes('coupon') || id.includes('coupon');
        const isZipCode = name.includes('zip') || name.includes('postal');

        if (isEmailField || isPasswordField || isPromoCode || isCouponCode || isZipCode) {
          return false;
        }

        // Must be specifically for OTP/verification codes
        const isOTPField = (
          name.includes('otp') ||
          name.includes('verification') ||
          name.includes('2fa') ||
          name.includes('mfa') ||
          id.includes('otp') ||
          id.includes('verification') ||
          placeholder.includes('verification code') ||
          placeholder.includes('6-digit') ||
          placeholder.includes('authenticator') ||
          label.includes('verification code') ||
          label.includes('authentication code')
        );

        // Generic "code" fields only if combined with verification keywords
        const isVerificationCode = (
          (name.includes('code') || id.includes('code')) &&
          (name.includes('verify') || id.includes('verify') ||
           placeholder.includes('verify') || label.includes('verify') ||
           placeholder.includes('enter code') || label.includes('enter code'))
        );

        return isOTPField || isVerificationCode;
      });

      // Only mark as 2FA if we found OTP-specific fields
      if (codeInputs.length > 0) {
        detected.found = true;
        // Lower confidence to reduce false positives
        detected.confidence = Math.max(detected.confidence, 0.65);
        detected.indicators.push(`Form with ${codeInputs.length} verification code input(s) detected`);
      }
    }
  }

  return detected;
}

/**
 * Detect ambiguous situations with multiple similar options
 * @param {object} pageContent - Page content
 * @returns {object} Detection result
 */
export function detectAmbiguity(pageContent) {
  const detected = {
    found: false,
    type: null,
    options: [],
    confidence: 0,
  };

  // Check for multiple similar buttons
  if (pageContent?.buttons && pageContent.buttons.length > 1) {
    const buttonTexts = pageContent.buttons.map(b => b.text?.toLowerCase() || '').filter(t => t.length > 0);

    // Group similar buttons
    const groups = {};
    for (const text of buttonTexts) {
      const normalized = text.trim().slice(0, 10); // First 10 chars
      groups[normalized] = (groups[normalized] || 0) + 1;
    }

    // Check if there are groups with multiple items
    const ambiguousGroups = Object.entries(groups).filter(([, count]) => count > 1);
    if (ambiguousGroups.length > 0) {
      detected.found = true;
      detected.type = 'multiple_similar_buttons';
      detected.confidence = 0.6;
      detected.options = ambiguousGroups.map(([text, count]) => ({
        type: 'button',
        text,
        count,
      }));
    }
  }

  // Check for multiple similar links
  if (pageContent?.links && pageContent.links.length > 5) {
    const linkTexts = pageContent.links.map(l => l.text?.toLowerCase() || '').filter(t => t.length > 0);

    // Check for many similar links (possible listing/navigation)
    const uniqueLinks = new Set(linkTexts);
    if (linkTexts.length > 10 && uniqueLinks.size < linkTexts.length * 0.5) {
      detected.found = true;
      detected.type = 'multiple_similar_links';
      detected.confidence = 0.5;
    }
  }

  // Check for multiple forms
  if (pageContent?.forms && pageContent.forms.length > 1) {
    detected.found = true;
    detected.type = 'multiple_forms';
    detected.confidence = 0.7;
    detected.options = pageContent.forms.map((form, i) => ({
      type: 'form',
      index: i,
      action: form.action,
      inputs: form.inputs?.length || 0,
    }));
  }

  return detected;
}

/**
 * Detect login/authentication pages
 * @param {object} pageContent - Page content
 * @returns {boolean} True if login page detected
 */
export function detectLoginPage(pageContent) {
  const loginKeywords = [
    'log in',
    'login',
    'sign in',
    'signin',
    'username',
    'password',
    'email',
    'authenticate',
  ];

  const title = pageContent?.title?.toLowerCase() || '';
  const bodyText = pageContent?.body?.toLowerCase() || '';

  // Check keywords
  for (const keyword of loginKeywords) {
    if (title.includes(keyword) || bodyText.includes(keyword)) {
      return true;
    }
  }

  // Check for password fields in forms
  if (pageContent?.forms) {
    for (const form of pageContent.forms) {
      const hasPasswordField = form.inputs?.some(input => input.type === 'password');
      if (hasPasswordField) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if page requires human interaction (comprehensive check)
 * @param {object} pageContent - Page content
 * @param {string} html - Raw HTML
 * @returns {object} Combined detection result
 */
export function detectHumanRequired(pageContent, html = '') {
  const captcha = detectCaptcha(pageContent, html);
  const twoFA = detect2FA(pageContent);
  const ambiguity = detectAmbiguity(pageContent);
  const isLogin = detectLoginPage(pageContent);

  const required = {
    humanRequired: false,
    reasons: [],
    details: {},
  };

  // IMPROVED: Only request human help for ACTIVE captchas with high confidence
  // Passive captcha elements (like background scripts) won't trigger help request
  if (captcha.found && captcha.isActive && captcha.confidence > 0.7) {
    required.humanRequired = true;
    required.reasons.push('CAPTCHA detected');
    required.details.captcha = captcha;
  } else if (captcha.found && !captcha.isActive) {
    // Log passive captcha detection but don't request help
    console.log('ℹ️  [Detection] Passive CAPTCHA elements detected (not blocking, no action needed)');
  }

  // IMPROVED: Higher threshold for 2FA to avoid false positives
  if (twoFA.found && twoFA.confidence > 0.75) {
    required.humanRequired = true;
    required.reasons.push('2FA/Authentication code required');
    required.details.twoFA = twoFA;
  } else if (twoFA.found && twoFA.confidence > 0.6) {
    // Log but don't request help for medium confidence
    console.log(`ℹ️  [Detection] Possible 2FA detected (confidence: ${(twoFA.confidence * 100).toFixed(0)}%) - not requesting help`);
  }

  if (ambiguity.found && ambiguity.confidence > 0.7) {
    required.humanRequired = true;
    required.reasons.push('Ambiguous situation - multiple similar options');
    required.details.ambiguity = ambiguity;
  }

  if (isLogin) {
    required.details.isLogin = true;
  }

  return required;
}

/**
 * Analyze error to determine if human help is needed
 * @param {string} errorMessage - Error message
 * @param {number} retryCount - Number of retries attempted
 * @param {number} maxRetries - Maximum retries allowed
 * @returns {boolean} True if human help should be requested
 */
export function shouldRequestHumanHelp(errorMessage, retryCount, maxRetries) {
  // After all retries exhausted
  if (retryCount >= maxRetries) {
    return true;
  }

  // Specific error patterns that need human help immediately
  const immediateHelpPatterns = [
    'captcha',
    'recaptcha',
    'hcaptcha',
    'cloudflare',
    'verification required',
    'human verification',
    'security check',
  ];

  const errorLower = errorMessage.toLowerCase();
  return immediateHelpPatterns.some(pattern => errorLower.includes(pattern));
}
