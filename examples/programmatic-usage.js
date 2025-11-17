/**
 * Example: Programmatic usage of AI Browser Automation
 *
 * This demonstrates how to use the library programmatically
 * instead of through the CLI interface.
 */

import { BrowserManager } from '../src/browser/BrowserManager.js';
import { ClaudeClient } from '../src/claude/ClaudeClient.js';
import { ContextManager } from '../src/context/ContextManager.js';
import { MainAgent } from '../src/agents/MainAgent.js';
import dotenv from 'dotenv';

dotenv.config();

async function example1_SimpleTask() {
  console.log('Example 1: Simple navigation and search task\n');

  // Initialize components
  const browserManager = new BrowserManager({
    headless: false,
    sessionDir: './sessions',
  });

  const claudeClient = new ClaudeClient(process.env.ANTHROPIC_API_KEY);
  const contextManager = new ContextManager();
  const mainAgent = new MainAgent(browserManager, claudeClient, contextManager);

  // Launch browser
  await browserManager.launch('example-session');

  // Execute goal
  const result = await mainAgent.executeGoal(
    'Go to google.com and search for "Node.js tutorials"'
  );

  console.log('\nResult:', result);

  // Get statistics
  const stats = mainAgent.getStats();
  console.log('Statistics:', stats);

  // Cleanup
  await browserManager.close();
}

async function example2_WithPersistentSession() {
  console.log('Example 2: Using persistent session for authenticated tasks\n');

  const browserManager = new BrowserManager({
    headless: false,
    sessionDir: './sessions',
  });

  const claudeClient = new ClaudeClient(process.env.ANTHROPIC_API_KEY);
  const contextManager = new ContextManager();
  const mainAgent = new MainAgent(browserManager, claudeClient, contextManager);

  // Launch with specific session name
  await browserManager.launch('github-session');

  // First task: Navigate to GitHub
  await mainAgent.executeGoal('Go to github.com');

  console.log('\n--- Please login manually in the browser ---');
  console.log('Press Ctrl+C when done, then run this script again\n');

  // Keep browser open
  await new Promise(() => {}); // Infinite wait
}

async function example3_CustomActions() {
  console.log('Example 3: Direct browser control with custom actions\n');

  const browserManager = new BrowserManager({
    headless: false,
    sessionDir: './sessions',
  });

  await browserManager.launch();

  // Direct navigation
  await browserManager.goto('https://example.com');

  // Get page content
  const content = await browserManager.getPageContent();
  console.log('Page title:', content.title);
  console.log('Links found:', content.links.length);

  // Take screenshot
  const screenshot = await browserManager.screenshot();
  console.log('Screenshot taken (base64):', screenshot.slice(0, 50) + '...');

  // Custom JavaScript execution
  const result = await browserManager.evaluate(() => {
    return {
      url: window.location.href,
      title: document.title,
      linksCount: document.querySelectorAll('a').length,
    };
  });
  console.log('Page info:', result);

  await browserManager.close();
}

async function example4_ErrorHandling() {
  console.log('Example 4: Error handling and recovery\n');

  const browserManager = new BrowserManager({
    headless: false,
    sessionDir: './sessions',
  });

  const claudeClient = new ClaudeClient(process.env.ANTHROPIC_API_KEY);
  const contextManager = new ContextManager();
  const mainAgent = new MainAgent(browserManager, claudeClient, contextManager);

  await browserManager.launch();

  try {
    // This will test the error recovery system
    const result = await mainAgent.executeGoal(
      'Go to example.com and click on a button that does not exist'
    );

    console.log('Result:', result);
  } catch (error) {
    console.error('Error caught:', error.message);
  }

  await browserManager.close();
}

// Run examples
async function main() {
  const example = process.argv[2] || '1';

  switch (example) {
    case '1':
      await example1_SimpleTask();
      break;
    case '2':
      await example2_WithPersistentSession();
      break;
    case '3':
      await example3_CustomActions();
      break;
    case '4':
      await example4_ErrorHandling();
      break;
    default:
      console.log('Usage: node examples/programmatic-usage.js [1|2|3|4]');
  }
}

if (process.argv[1].endsWith('programmatic-usage.js')) {
  main().catch(console.error);
}

export {
  example1_SimpleTask,
  example2_WithPersistentSession,
  example3_CustomActions,
  example4_ErrorHandling,
};
