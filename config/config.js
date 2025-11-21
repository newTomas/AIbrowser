import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
  // Claude API settings
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
  },

  // Browser settings
  browser: {
    headless: process.env.BROWSER_HEADLESS === 'true',
    sessionDir: process.env.SESSION_DIR || './sessions',
  },

  // Agent settings
  agent: {
    maxSteps: parseInt(process.env.MAX_STEPS) || 50,
    maxContextSize: parseInt(process.env.MAX_CONTEXT_SIZE) || 10000,
    autoConfirm: process.env.AUTO_CONFIRM === 'true', // For testing only
    verboseLogging: process.env.VERBOSE_LOGGING === 'true', // Detailed clickable elements logging
  },

  // Validate configuration
  validate() {
    if (!this.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required. Please set it in .env file');
    }
    return true;
  },
};
