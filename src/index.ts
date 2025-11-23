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
    // Check if no arguments or only --help/--version are provided
    const args = process.argv.slice(2);
    const hasCommand = args.length > 0 && !args.every(arg => arg.startsWith('-'));

    if (!hasCommand) {
      // Default to interactive mode
      await cli.startInteractiveMode();
    } else {
      // Run with provided arguments
      await cli.run(process.argv);
    }
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