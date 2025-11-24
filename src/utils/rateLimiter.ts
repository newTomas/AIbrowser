/**
 * Rate limiting utilities for API calls and actions
 */

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  strategy?: 'sliding' | 'fixed';
}

export interface RateLimitResult {
  allowed: boolean;
  remainingRequests: number;
  resetTime: number;
  waitTime?: number;
}

export interface RateLimiterStats {
  currentRequests: number;
  maxRequests: number;
  windowMs: number;
  remainingRequests: number;
}

export class RateLimiter {
  private requests: number[] = [];
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if a request is allowed under the rate limit
   */
  checkLimit(): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Remove old requests outside the window
    this.requests = this.requests.filter(timestamp => timestamp > windowStart);

    const currentRequestCount = this.requests.length;
    const allowed = currentRequestCount < this.config.maxRequests;

    if (allowed) {
      this.requests.push(now);
    }

    // Calculate when the oldest request will expire
    const oldestRequest = this.requests[0];
    const resetTime = oldestRequest ? oldestRequest + this.config.windowMs : now;

    return {
      allowed,
      remainingRequests: Math.max(0, this.config.maxRequests - currentRequestCount - (allowed ? 1 : 0)),
      resetTime,
      waitTime: allowed ? undefined : Math.max(0, resetTime - now)
    };
  }

  /**
   * Wait until a request is allowed (returns a Promise)
   */
  async waitForSlot(): Promise<void> {
    const result = this.checkLimit();
    if (result.allowed) {
      return;
    }

    if (result.waitTime) {
      await this.sleep(result.waitTime);
    }
    return this.waitForSlot(); // Recursive check
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.requests = [];
  }

  /**
   * Get current statistics
   */
  getStats(): RateLimiterStats {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const recentRequests = this.requests.filter(timestamp => timestamp > windowStart);

    return {
      currentRequests: recentRequests.length,
      maxRequests: this.config.maxRequests,
      windowMs: this.config.windowMs,
      remainingRequests: Math.max(0, this.config.maxRequests - recentRequests.length)
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Rate limiter specifically for API calls
 */
export class ApiRateLimiter extends RateLimiter {
  constructor(rateLimit: number) {
    if (rateLimit <= 0) {
      // Disabled rate limiter - use very high limits
      super({
        maxRequests: Number.MAX_SAFE_INTEGER,
        windowMs: 1000,
        strategy: 'sliding'
      });
    } else {
      super({
        maxRequests: rateLimit,
        windowMs: 60 * 1000, // 1 minute
        strategy: 'sliding'
      });
    }
  }
}

/**
 * Rate limiter for browser actions
 */
export class ActionRateLimiter extends RateLimiter {
  constructor(rateLimit: number) {
    if (rateLimit <= 0) {
      // Disabled rate limiter - use very high limits
      super({
        maxRequests: Number.MAX_SAFE_INTEGER,
        windowMs: 1000,
        strategy: 'sliding'
      });
    } else {
      super({
        maxRequests: rateLimit,
        windowMs: 10 * 1000, // 10 seconds
        strategy: 'sliding'
      });
    }
  }
}

/**
 * Rate limiter for page navigation
 */
export class NavigationRateLimiter extends RateLimiter {
  constructor(rateLimit: number) {
    if (rateLimit <= 0) {
      // Disabled rate limiter - use very high limits
      super({
        maxRequests: Number.MAX_SAFE_INTEGER,
        windowMs: 1000,
        strategy: 'sliding'
      });
    } else {
      super({
        maxRequests: rateLimit,
        windowMs: 30 * 1000, // 30 seconds
        strategy: 'sliding'
      });
    }
  }
}

/**
 * Global rate limiter manager
 */
export class RateLimiterManager {
  private static instance: RateLimiterManager;
  private limiters: Map<string, RateLimiter> = new Map();

  private constructor(rateLimits?: { apiRateLimit: number; actionRateLimit: number; navigationRateLimit: number }) {
    // Initialize limiters with configuration or defaults
    const limits = rateLimits || { apiRateLimit: 60, actionRateLimit: 30, navigationRateLimit: 10 };

    this.limiters.set('api', new ApiRateLimiter(limits.apiRateLimit));
    this.limiters.set('actions', new ActionRateLimiter(limits.actionRateLimit));
    this.limiters.set('navigation', new NavigationRateLimiter(limits.navigationRateLimit));
  }

  static getInstance(rateLimits?: { apiRateLimit: number; actionRateLimit: number; navigationRateLimit: number }): RateLimiterManager {
    if (!RateLimiterManager.instance) {
      RateLimiterManager.instance = new RateLimiterManager(rateLimits);
    }
    return RateLimiterManager.instance;
  }

  /**
   * Reinitialize the manager with new configuration (for testing)
   */
  static reinitialize(rateLimits?: { apiRateLimit: number; actionRateLimit: number; navigationRateLimit: number }): void {
    RateLimiterManager.instance = new RateLimiterManager(rateLimits);
  }

  getLimiter(name: string): RateLimiter | undefined {
    return this.limiters.get(name);
  }

  addLimiter(name: string, limiter: RateLimiter): void {
    this.limiters.set(name, limiter);
  }

  /**
   * Execute function with rate limiting
   */
  async executeWithLimit<T>(
    limiterName: string,
    fn: () => Promise<T>,
    options?: { skipLimit?: boolean }
  ): Promise<T> {
    const limiter = this.getLimiter(limiterName);
    if (!limiter || options?.skipLimit) {
      return fn();
    }

    await limiter.waitForSlot();
    return fn();
  }

  /**
   * Get statistics for all limiters
   */
  getAllStats(): Record<string, RateLimiterStats> {
    const stats: Record<string, RateLimiterStats> = {};
    for (const [name, limiter] of this.limiters.entries()) {
      stats[name] = limiter.getStats();
    }
    return stats;
  }

  /**
   * Reset all limiters
   */
  resetAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.reset();
    }
  }
}

/**
 * Decorator for rate limiting functions
 */
export function rateLimited(limiterName: string, options?: { skipLimit?: boolean }) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const rateLimiter = RateLimiterManager.getInstance();
      return rateLimiter.executeWithLimit(limiterName, () => method.apply(this, args), options);
    };

    return descriptor;
  };
}