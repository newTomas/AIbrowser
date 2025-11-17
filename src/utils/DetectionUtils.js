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
  const captchaIndicators = {
    // reCAPTCHA
    recaptcha: [
      'g-recaptcha',
      'recaptcha',
      'grecaptcha',
      '/recaptcha/',
      'data-sitekey',
    ],
    // hCaptcha
    hcaptcha: [
      'h-captcha',
      'hcaptcha',
      'hcaptcha.com',
    ],
    // Cloudflare
    cloudflare: [
      'cf-challenge',
      'cf_clearance',
      'cloudflare',
      'challenge-platform',
      'ray-id',
    ],
    // Generic CAPTCHA indicators
    generic: [
      'captcha',
      'human verification',
      'verify you are human',
      'prove you are not a robot',
      'security check',
    ],
  };

  const url = pageContent?.url || '';
  const title = pageContent?.title?.toLowerCase() || '';
  const bodyText = pageContent?.body?.toLowerCase() || '';
  const htmlLower = html.toLowerCase();

  const detected = {
    found: false,
    type: null,
    confidence: 0,
    indicators: [],
  };

  // Check URL
  if (url.includes('recaptcha') || url.includes('hcaptcha') || url.includes('cloudflare')) {
    detected.found = true;
    detected.confidence = 0.9;
    detected.indicators.push('URL contains CAPTCHA service');
  }

  // Check each type
  for (const [type, keywords] of Object.entries(captchaIndicators)) {
    for (const keyword of keywords) {
      if (
        title.includes(keyword) ||
        bodyText.includes(keyword) ||
        htmlLower.includes(keyword)
      ) {
        detected.found = true;
        detected.type = type;
        detected.indicators.push(`Keyword found: ${keyword}`);

        // Increase confidence based on number of matches
        detected.confidence = Math.min(0.95, detected.confidence + 0.2);
      }
    }
  }

  // Check for common CAPTCHA patterns in page structure
  if (pageContent?.buttons) {
    const buttons = pageContent.buttons.map(b => b.text?.toLowerCase() || '');
    if (buttons.some(b => b.includes('verify') || b.includes('continue') || b.includes('check'))) {
      if (detected.found) {
        detected.confidence = Math.min(1.0, detected.confidence + 0.1);
      }
    }
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

  // Check for keywords
  for (const keyword of twoFAKeywords) {
    if (title.includes(keyword) || bodyText.includes(keyword)) {
      detected.found = true;
      detected.indicators.push(`Keyword found: ${keyword}`);
      detected.confidence = Math.min(0.95, detected.confidence + 0.25);
    }
  }

  // Check for forms with specific input types
  if (pageContent?.forms) {
    for (const form of pageContent.forms) {
      const inputs = form.inputs || [];

      // Look for code/PIN inputs
      const hasCodeInput = inputs.some(input => {
        const name = (input.name || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        const id = (input.id || '').toLowerCase();

        return (
          name.includes('code') ||
          name.includes('otp') ||
          name.includes('pin') ||
          placeholder.includes('code') ||
          placeholder.includes('enter') ||
          id.includes('code') ||
          id.includes('otp')
        );
      });

      if (hasCodeInput) {
        detected.found = true;
        detected.confidence = Math.max(detected.confidence, 0.8);
        detected.indicators.push('Form with code input detected');
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

  if (captcha.found && captcha.confidence > 0.6) {
    required.humanRequired = true;
    required.reasons.push('CAPTCHA detected');
    required.details.captcha = captcha;
  }

  if (twoFA.found && twoFA.confidence > 0.6) {
    required.humanRequired = true;
    required.reasons.push('2FA/Authentication code required');
    required.details.twoFA = twoFA;
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
