#!/usr/bin/env node

import { BrowserManager } from './browser/BrowserManager.js';
import { ClaudeClient } from './claude/ClaudeClient.js';
import { ContextManager } from './context/ContextManager.js';
import { MainAgent } from './agents/MainAgent.js';
import { askForInput, askYesNo, selectFromMenu, intro, outro, note } from './utils/interactivePrompts.js';
import { config } from '../config/config.js';

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
    intro('🚀 AI Browser Automation');

    // Validate config
    try {
      config.validate();
    } catch (error) {
      note(`Configuration error: ${error.message}`, 'error');
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

    note('Components initialized successfully', 'success');
  }

  /**
   * Show main menu
   */
  async showMenu() {
    const choice = await selectFromMenu('Main Menu', [
      { value: '1', label: 'Start new automation task', hint: 'Give AI a goal to accomplish' },
      { value: '2', label: 'Launch browser (manual login)', hint: 'Open browser for manual setup' },
      { value: '3', label: 'Continue with existing session', hint: 'Resume automation' },
      { value: '4', label: 'List available sessions', hint: 'View saved sessions' },
      { value: '5', label: 'Change session', hint: 'Switch to different session' },
      { value: '6', label: 'Exit', hint: 'Close application' },
    ]);
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
          note('Invalid option', 'warning');
      }
    }
  }

  /**
   * Start new automation task
   */
  async startAutomationTask() {
    intro('📋 New Automation Task');

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
      note('No goal provided', 'warning');
      return;
    }

    let taskInfo = `Session: ${this.currentSession}\n`;
    taskInfo += `Goal: ${goal}`;
    note(taskInfo, 'info');

    // Execute goal
    const result = await this.mainAgent.executeGoal(goal);

    // Show statistics
    const stats = this.mainAgent.getStats();
    let statsInfo = `Steps taken: ${stats.stepCount}/${stats.maxSteps}\n`;
    statsInfo += `Context size: ${stats.contextSize} chars\n`;
    statsInfo += `Sub-agents used: ${stats.subAgentsUsed}`;
    note(statsInfo, 'info');

    if (result.success) {
      note('Task completed successfully!', 'success');
    } else {
      note(`Task failed: ${result.error}`, 'error');
    }

    // Ask if user wants to continue
    const continueWork = await askYesNo('Would you like to give another task?');
    if (!continueWork) {
      // Reset agent for next task
      this.mainAgent.reset();
    }
  }

  /**
   * Launch browser for manual login
   */
  async launchBrowserManually() {
    intro('🌐 Launching browser for manual interaction');
    note(`Session: ${this.currentSession}`, 'info');

    if (this.browserManager.isRunning()) {
      note('Browser is already running', 'warning');
      return;
    }

    await this.browserManager.launch(this.currentSession);

    let launchInfo = 'Browser launched successfully\n';
    launchInfo += 'You can now manually navigate, login, or perform any actions.\n';
    launchInfo += 'The session will be saved automatically.';
    note(launchInfo, 'success');

    await askForInput('Press Enter when you\'re ready to continue with AI automation...');
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

    const sessionName = await askForInput('Enter session name (or create new)');

    if (sessionName && sessionName.trim().length > 0) {
      // Sanitize session name to prevent path traversal attacks
      const sanitized = sessionName.trim()
        .replace(/^\.+/, '')               // Remove leading dots FIRST
        .replace(/[^a-zA-Z0-9_-]/g, '_')  // Only allow alphanumeric, underscore, dash
        .substring(0, 50);                 // Limit length to 50 characters

      if (sanitized.length === 0) {
        note('Invalid session name. Use only letters, numbers, hyphens, and underscores.', 'error');
        return;
      }

      // Close current browser if running
      if (this.browserManager.isRunning()) {
        await this.browserManager.close();
      }

      this.currentSession = sanitized;
      note(`Session changed to: ${this.currentSession}`, 'success');
    }
  }

  /**
   * Cleanup on exit
   */
  async cleanup() {
    intro('🧹 Cleaning up...');

    if (this.browserManager && this.browserManager.isRunning()) {
      const shouldClose = await askYesNo('Close the browser?');
      if (shouldClose) {
        await this.browserManager.close();
      } else {
        note(`Browser left running. Session saved: ${this.currentSession}`, 'info');
      }
    }

    outro('👋 Goodbye!');
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
