import { config } from 'dotenv';
import { AppConfig, LogLevelValue } from '@/types';

// Load environment variables
config();

/**
 * Get configuration from environment variables
 */
export function getConfig(): AppConfig {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required in environment variables');
  }

  const logLevel = (process.env.LOG_LEVEL || 'INFO') as LogLevelValue;
  const validLogLevels: LogLevelValue[] = ['OFF', 'INFO', 'DEBUG'];
  if (!validLogLevels.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${logLevel}. Must be one of: ${validLogLevels.join(', ')}`);
  }

  return {
    anthropicApiKey,
    userDataDir: process.env.USER_DATA_DIR || './user_data',
    logLevel,
    enableRiskEvaluation: process.env.ENABLE_RISK_EVALUATION !== 'false',
    headless: process.env.HEADLESS !== 'false',
    browserTimeout: parseInt(process.env.BROWSER_TIMEOUT || '30000', 10)
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