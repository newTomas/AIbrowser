#!/usr/bin/env node

import { InteractiveCLI } from '@/cli/InteractiveCLI';
import { logger } from '@/cli/Logger';

/**
 * Main entry point for the AI Web Agent
 */
async function main(): Promise<void> {
  const cli = new InteractiveCLI();

  // Handle process termination gracefully
  process.on('SIGINT', () => {
    logger.info('\nReceived SIGINT, shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });

  try {
    await cli.run(process.argv);
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the main function
if (require.main === module) {
  main();
}

export { main };