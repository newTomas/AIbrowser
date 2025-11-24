import { config } from 'dotenv';
import { AppConfig, LogLevelValue, ModelConfig, ModelType, RateLimitConfig, SensitiveFilterLevel } from '@/types';

// Load environment variables
config();

/**
 * Validate API key format and security (supports multiple providers)
 */
function validateApiKey(apiKey: string, keyName: string): string {
  // Remove any whitespace and potential quotes
  const cleanKey = apiKey.trim().replace(/^["']|["']$/g, '');

  // Check minimum length for most API keys
  if (cleanKey.length < 10) {
    throw new Error(`${keyName} appears to be too short (minimum 10 characters)`);
  }

  // Check for common placeholder/test values across providers
  const forbiddenValues = [
    'test', 'example', 'dummy', 'your-api-key-here', 'placeholder',
    'fake', 'mock', 'sample', 'demo', 'xxxxx', '*****'
  ];
  if (forbiddenValues.some(forbidden => cleanKey.toLowerCase().includes(forbidden))) {
    throw new Error(`${keyName} contains placeholder/test value. Please use a real API key.`);
  }

  return cleanKey;
}

/**
 * Get configuration from environment variables
 */
export function getConfig(): AppConfig {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required in environment variables');
  }

  // Validate and sanitize the API key
  const validatedApiKey = validateApiKey(anthropicApiKey, 'ANTHROPIC_API_KEY');

  const logLevel = (process.env.LOG_LEVEL || 'INFO') as LogLevelValue;
  const validLogLevels: LogLevelValue[] = ['OFF', 'INFO', 'DEBUG'];
  if (!validLogLevels.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${logLevel}. Must be one of: ${validLogLevels.join(', ')}`);
  }

  // Default model configuration
  const models: ModelConfig = {
    main: (process.env.MAIN_MODEL as ModelType) || 'claude-sonnet-4-5',
    risk: (process.env.RISK_MODEL as ModelType) || 'claude-4.5-haiku',
    maxTokens: process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS, 10) : undefined
  };

  // Rate limiting configuration
  const rateLimits: RateLimitConfig = {
    apiRateLimit: parseInt(process.env.API_RATE_LIMIT || '60', 10),
    actionRateLimit: parseInt(process.env.ACTION_RATE_LIMIT || '30', 10),
    navigationRateLimit: parseInt(process.env.NAVIGATION_RATE_LIMIT || '10', 10)
  };

  // Sensitive data filtering configuration
  const sensitiveFilterLevel = (process.env.SENSITIVE_FILTER_LEVEL || 'PARTIAL') as SensitiveFilterLevel;
  const validFilterLevels: SensitiveFilterLevel[] = ['OFF', 'PARTIAL', 'STRICT'];
  if (!validFilterLevels.includes(sensitiveFilterLevel)) {
    throw new Error(`Invalid SENSITIVE_FILTER_LEVEL: ${sensitiveFilterLevel}. Must be one of: ${validFilterLevels.join(', ')}`);
  }

  return {
    anthropicApiKey: validatedApiKey,
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
    userDataDir: process.env.USER_DATA_DIR || './user_data',
    logLevel,
    enableRiskEvaluation: process.env.ENABLE_RISK_EVALUATION !== 'false',
    headless: process.env.HEADLESS !== 'false',
    browserTimeout: parseInt(process.env.BROWSER_TIMEOUT || '30000', 10),
    models,
    rateLimits,
    sensitiveFilterLevel
  };
}

/**
 * Validate required environment variables
 */
export function validateConfig(): void {
  try {
    getConfig();
  } catch (error) {
    console.error('Configuration error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

/**
 * Get numeric log level for comparison
 */
export function getLogLevelNumeric(logLevel: LogLevelValue): number {
  switch (logLevel) {
    case 'OFF': return 0;
    case 'INFO': return 1;
    case 'DEBUG': return 2;
    default: return 1;
  }
}