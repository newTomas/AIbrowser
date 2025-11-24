import { LogLevelValue, SanitizedLogData } from '@/types';
import { getConfig } from '@/utils/config';

/**
 * Get numeric log level for comparison
 */
function getLogLevelNumeric(logLevel: LogLevelValue): number {
  switch (logLevel) {
    case 'OFF': return 0;
    case 'INFO': return 1;
    case 'DEBUG': return 2;
    default: return 1;
  }
}

export class Logger {
  private currentLevel: LogLevelValue;
  private enableColors: boolean;

  constructor(level: LogLevelValue = 'INFO', enableColors: boolean = true) {
    this.currentLevel = level;
    this.enableColors = enableColors && process.stdout.isTTY;
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevelValue): void {
    this.currentLevel = level;
  }

  /**
   * Check if log level should be printed
   */
  private shouldLog(level: LogLevelValue): boolean {
    return getLogLevelNumeric(this.currentLevel) >= getLogLevelNumeric(level);
  }

  /**
   * Colorize text for terminal output
   */
  private colorize(text: string, color: string): string {
    if (!this.enableColors) return text;

    const colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m'
    };

    return `${colors[color as keyof typeof colors] || ''}${text}${colors.reset}`;
  }

  /**
   * Sanitize log data to prevent sensitive information exposure
   */
  private sanitizeLogData(data: unknown): unknown {
    if (typeof data === 'string') {
      // Redact potential API keys and sensitive tokens
      return data
        .replace(/sk-ant-[a-zA-Z0-9_-]{20,}/gi, '[REDACTED_API_KEY]')
        .replace(/Bearer\s+[a-zA-Z0-9_-]{20,}/gi, '[REDACTED_TOKEN]')
        .replace(/password["\s]*[:=]["\s]*([^"'\s,}]+)/gi, 'password: [REDACTED]')
        .replace(/token["\s]*[:=]["\s]*([^"'\s,}]+)/gi, 'token: [REDACTED]')
        .replace(/secret["\s]*[:=]["\s]*([^"'\s,}]+)/gi, 'secret: [REDACTED]');
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeLogData(item));
    }

    if (typeof data === 'object' && data !== null) {
      const sanitized: SanitizedLogData = {};
      for (const [key, value] of Object.entries(data)) {
        // Redact sensitive fields
        if (/^(api_?key|secret|token|password|authorization)$/i.test(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitizeLogData(value);
        }
      }
      return sanitized;
    }

    return data;
  }

  /**
   * Format timestamp
   */
  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Log with level and formatting
   */
  private log(level: LogLevelValue, levelStr: string, color: string, message: string, ...args: unknown[]): void {
    if (!this.shouldLog(level)) return;

    const timestamp = this.formatTimestamp();
    const coloredLevel = this.colorize(`[${levelStr}]`, color);
    const coloredMessage = this.colorize(message, 'white');

    // Sanitize all arguments to prevent sensitive data exposure
    const sanitizedArgs = args.map(arg => this.sanitizeLogData(arg));

    console.log(`${this.colorize(timestamp, 'dim')} ${coloredLevel} ${coloredMessage}`, ...sanitizedArgs);
  }

  /**
   * Error logging - always shown
   */
  error(message: string, ...args: unknown[]): void {
    const timestamp = this.formatTimestamp();
    const coloredMessage = this.colorize(message, 'red');
    console.error(`${this.colorize(timestamp, 'dim')} ${this.colorize('[ERROR]', 'red')} ${coloredMessage}`, ...args);
  }

  /**
   * Info logging
   */
  info(message: string, ...args: unknown[]): void {
    this.log('INFO', 'INFO', 'green', message, ...args);
  }

  /**
   * Debug logging with detailed information
   */
  debug(message: string, data?: unknown): void {
    if (data) {
      const sanitizedData = this.sanitizeLogData(data);
      this.log('DEBUG', 'DEBUG', 'cyan', message, '\n', JSON.stringify(sanitizedData, null, 2));
    } else {
      this.log('DEBUG', 'DEBUG', 'cyan', message);
    }
  }

  /**
   * Log ReAct Thought
   */
  thought(reasoning: string, nextAction?: string): void {
    if (!this.shouldLog('INFO')) return;

    console.log(`\n${this.colorize('🤔 THOUGHT:', 'yellow')}`);
    console.log(this.colorize(reasoning, 'white'));

    if (nextAction) {
      console.log(`\n${this.colorize('⚡ NEXT ACTION:', 'blue')}`);
      console.log(this.colorize(nextAction, 'white'));
    }
    console.log();
  }

  /**
   * Log ReAct Action
   */
  action(tool: string, parameters: Record<string, unknown>): void {
    if (!this.shouldLog('INFO')) return;

    console.log(`${this.colorize('🔧 ACTION:', 'magenta')} ${this.colorize(tool, 'bright')}`);
    if (Object.keys(parameters).length > 0) {
      const sanitizedParams = this.sanitizeLogData(parameters);
      console.log(this.colorize('Parameters:', 'dim'), sanitizedParams);
    }
    console.log();
  }

  /**
   * Log ReAct Observation
   */
  observation(summary: string, details?: string): void {
    if (!this.shouldLog('INFO')) return;

    console.log(`${this.colorize('👁️  OBSERVATION:', 'cyan')} ${this.colorize(summary, 'white')}`);

    if (details && this.currentLevel === 'DEBUG') {
      // Output details directly without "Details:" label for cleaner TOON format
      console.log(details);
    }
    console.log();
  }

  /**
   * Warning logging
   */
  warning(message: string, ...args: unknown[]): void {
    this.log('INFO', 'WARNING', 'yellow', message, ...args);
  }

  /**
   * Log security warnings
   */
  security(message: string, riskLevel?: string): void {
    const color = riskLevel === 'HIGH' ? 'red' : riskLevel === 'MEDIUM' ? 'yellow' : 'green';
    console.log(`${this.colorize('🛡️  SECURITY:', color)} ${this.colorize(message, 'white')}`);
    console.log();
  }

  /**
   * Create child logger with prefix
   */
  child(prefix: string): Logger {
    const childLogger = new Logger(this.currentLevel, this.enableColors);

    // Override log methods to add prefix
    const originalLog = childLogger.log.bind(childLogger);
    childLogger.log = (level, levelStr, color, message, ...args) => {
      originalLog(level, levelStr, color, `[${prefix}] ${message}`, ...args);
    };

    return childLogger;
  }
}

// Create default logger instance
// Initialize logger with configuration from environment
let loggerInstance: Logger;

try {
  const config = getConfig();
  loggerInstance = new Logger(config.logLevel);
} catch (error) {
  // Fallback to INFO if config fails to load
  loggerInstance = new Logger('INFO');
}

export const logger = loggerInstance;