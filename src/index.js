#!/usr/bin/env node

import { BrowserManager } from './browser/BrowserManager.js';
import { ClaudeClient } from './claude/ClaudeClient.js';
import { ContextManager } from './context/ContextManager.js';
import { MainAgent } from './agents/MainAgent.js';
import { askForInput, askYesNo } from './utils/confirmAction.js';
import { config } from '../config/config.js';
import readline from 'readline';

/**
 * Main application class
 */
class AIBrowserApp {
  constructor() {
    this.browserManager = null;
    this.claudeClient = null;
    this.contextManager = null;
    this.mainAgent = null;
    this.currentSession = 'default';
  }

  /**
   * Initialize application
   */
  async initialize() {
    console.log('🚀 AI Browser Automation');
    console.log('━'.repeat(60));

    // Validate config
    try {
      config.validate();
    } catch (error) {
      console.error('❌ Configuration error:', error.message);
      process.exit(1);
    }

    // Initialize components
    this.browserManager = new BrowserManager(config.browser);
    this.claudeClient = new ClaudeClient(config.anthropic.apiKey, config.anthropic.model);
    this.contextManager = new ContextManager(config.agent.maxContextSize);
    this.mainAgent = new MainAgent(
      this.browserManager,
      this.claudeClient,
      this.contextManager
    );

    console.log('✓ Components initialized');
  }

  /**
   * Show main menu
   */
  async showMenu() {
    console.log('\n' + '━'.repeat(60));
    console.log('Main Menu:');
    console.log('1. Start new automation task');
    console.log('2. Launch browser (manual login)');
    console.log('3. Continue with existing session');
    console.log('4. List available sessions');
    console.log('5. Change session');
    console.log('6. Exit');
    console.log('━'.repeat(60));

    const choice = await askForInput('Choose an option (1-6)');
    return choice;
  }

  /**
   * Main application loop
   */
  async run() {
    await this.initialize();

    let running = true;

    while (running) {
      const choice = await this.showMenu();

      switch (choice) {
        case '1':
          await this.startAutomationTask();
          break;

        case '2':
          await this.launchBrowserManually();
          break;

        case '3':
          await this.continueSession();
          break;

        case '4':
          await this.listSessions();
          break;

        case '5':
          await this.changeSession();
          break;

        case '6':
          running = false;
          await this.cleanup();
          break;

        default:
          console.log('Invalid option');
      }
    }
  }

  /**
   * Start new automation task
   */
  async startAutomationTask() {
    console.log('\n📋 New Automation Task');
    console.log('━'.repeat(60));

    // Check if browser is running
    if (!this.browserManager.isRunning()) {
      const shouldLaunch = await askYesNo('Browser is not running. Launch it now?');
      if (shouldLaunch) {
        await this.browserManager.launch(this.currentSession);
      } else {
        return;
      }
    }

    // Get user goal
    const goal = await askForInput('What would you like the AI to do?');
    if (!goal || goal.trim().length === 0) {
      console.log('No goal provided');
      return;
    }

    console.log('\n🤖 Starting AI agent...');
    console.log(`Session: ${this.currentSession}`);
    console.log(`Goal: ${goal}`);

    // Execute goal
    const result = await this.mainAgent.executeGoal(goal);

    // Show statistics
    console.log('\n📊 Execution Statistics:');
    const stats = this.mainAgent.getStats();
    console.log(`Steps taken: ${stats.stepCount}/${stats.maxSteps}`);
    console.log(`Context size: ${stats.contextSize} chars`);
    console.log(`Sub-agents used: ${stats.subAgentsUsed}`);

    if (result.success) {
      console.log('✅ Task completed successfully!');
    } else {
      console.log('❌ Task failed:', result.error);
    }

    // Ask if user wants to continue
    const continueWork = await askYesNo('\nWould you like to give another task?');
    if (!continueWork) {
      // Reset agent for next task
      this.mainAgent.reset();
    }
  }

  /**
   * Launch browser for manual login
   */
  async launchBrowserManually() {
    console.log('\n🌐 Launching browser for manual interaction');
    console.log(`Session: ${this.currentSession}`);

    if (this.browserManager.isRunning()) {
      console.log('Browser is already running');
      return;
    }

    await this.browserManager.launch(this.currentSession);

    console.log('\n✓ Browser launched');
    console.log('You can now manually navigate, login, or perform any actions.');
    console.log('The session will be saved automatically.');

    await askForInput('\nPress Enter when you\'re ready to continue with AI automation...');
  }

  /**
   * Continue with existing session
   */
  async continueSession() {
    console.log('\n🔄 Continuing with existing session');

    if (!this.browserManager.isRunning()) {
      await this.browserManager.launch(this.currentSession);
    }

    const currentUrl = await this.browserManager.getCurrentUrl();
    console.log(`Current URL: ${currentUrl}`);

    // Get current page content
    if (currentUrl && currentUrl !== 'about:blank') {
      const content = await this.browserManager.getPageContent();
      console.log(`Page title: ${content.title}`);
    }

    // Now user can give a task
    await this.startAutomationTask();
  }

  /**
   * List available sessions
   */
  async listSessions() {
    console.log('\n📁 Available Sessions:');
    const sessions = await this.browserManager.listSessions();

    if (sessions.length === 0) {
      console.log('No sessions found');
    } else {
      sessions.forEach((session, i) => {
        const indicator = session === this.currentSession ? '→' : ' ';
        console.log(`${indicator} ${i + 1}. ${session}`);
      });
    }

    console.log(`\nCurrent session: ${this.currentSession}`);
  }

  /**
   * Change session
   */
  async changeSession() {
    await this.listSessions();

    const sessionName = await askForInput('\nEnter session name (or create new)');

    if (sessionName && sessionName.trim().length > 0) {
      // Close current browser if running
      if (this.browserManager.isRunning()) {
        await this.browserManager.close();
      }

      this.currentSession = sessionName.trim();
      console.log(`✓ Session changed to: ${this.currentSession}`);
    }
  }

  /**
   * Cleanup on exit
   */
  async cleanup() {
    console.log('\n🧹 Cleaning up...');

    if (this.browserManager && this.browserManager.isRunning()) {
      const shouldClose = await askYesNo('Close the browser?');
      if (shouldClose) {
        await this.browserManager.close();
      } else {
        console.log('Browser left running. Session saved: ' + this.currentSession);
      }
    }

    console.log('👋 Goodbye!');
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Interrupted by user');
  process.exit(0);
});

// Main entry point
async function main() {
  const app = new AIBrowserApp();
  await app.run();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
