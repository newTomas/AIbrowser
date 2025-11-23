import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { WebAgent } from '@/agent/WebAgent';
import { AssistanceRequest } from '@/types';
import { logger } from './Logger';
import { validateConfig } from '@/utils/config';

export class InteractiveCLI {
  private agent: WebAgent;
  private program: Command;

  constructor() {
    this.agent = new WebAgent();
    this.program = new Command();
    this.setupCommands();
  }

  /**
   * Setup CLI commands
   */
  private setupCommands(): void {
    this.program
      .name('ai-web-agent')
      .description('Autonomous Web Agent with Playwright and Anthropic SDK')
      .version('1.0.0');

    this.program
      .command('interactive')
      .alias('i')
      .description('Start interactive mode')
      .action(() => this.startInteractiveMode());

    this.program
      .command('execute <goal>')
      .alias('exec')
      .description('Execute a task directly')
      .option('-m, --max-iterations <number>', 'Maximum iterations', '20')
      .option('-h, --headless', 'Run in headless mode', false)
      .action((goal, options) => this.executeDirectTask(goal, options));

    this.program
      .command('config')
      .description('Show current configuration')
      .action(() => this.showConfig());

    this.program
      .command('test')
      .description('Run basic connectivity tests')
      .action(() => this.runTests());
  }

  /**
   * Start interactive mode
   */
  public async startInteractiveMode(): Promise<void> {
    console.log(chalk.cyan('\n🤖 AI Web Agent - Interactive Mode'));
    console.log(chalk.gray('Type "help" for available commands or "exit" to quit\n'));

    // Validate configuration first
    try {
      validateConfig();
      console.log(chalk.green('✓ Configuration validated'));
    } catch (error) {
      console.error(chalk.red('✗ Configuration error:'), error instanceof Error ? error.message : 'Unknown error');
      return;
    }

    // Initialize agent
    try {
      console.log(chalk.yellow('Initializing browser and agent...'));
      await this.agent.initialize();
      console.log(chalk.green('✓ Agent initialized successfully'));

      // Set up user assistance callback
      this.agent.setUserAssistanceCallback(this.handleUserAssistance.bind(this));
    } catch (error) {
      console.error(chalk.red('✗ Failed to initialize agent:'), error instanceof Error ? error.message : 'Unknown error');
      return;
    }

    // Main interactive loop
    await this.interactiveLoop();
  }

  /**
   * Main interactive loop
   */
  private async interactiveLoop(): Promise<void> {
    while (true) {
      try {
        const { action } = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: 'What would you like to do?',
            choices: [
              { name: '🎯 Execute a task', value: 'execute' },
              { name: '📊 Show agent status', value: 'status' },
              { name: '📜 Show history', value: 'history' },
              { name: '🌐 Navigate to URL', value: 'navigate' },
              { name: '📸 Take screenshot', value: 'screenshot' },
              { name: '🔧 Settings', value: 'settings' },
              { name: '❌ Exit', value: 'exit' }
            ]
          }
        ]);

        switch (action) {
          case 'execute':
            await this.promptForTask();
            break;
          case 'status':
            await this.showStatus();
            break;
          case 'history':
            await this.showHistory();
            break;
          case 'navigate':
            await this.promptForNavigation();
            break;
          case 'screenshot':
            await this.takeScreenshot();
            break;
          case 'settings':
            await this.showSettings();
            break;
          case 'exit':
            await this.cleanup();
            return;
        }
      } catch (error) {
        console.error(chalk.red('Error in interactive loop:'), error instanceof Error ? error.message : 'Unknown error');
      }
    }
  }

  /**
   * Prompt user for task execution
   */
  private async promptForTask(): Promise<void> {
    const { goal, maxIterations } = await inquirer.prompt([
      {
        type: 'input',
        name: 'goal',
        message: 'What task would you like the agent to perform?',
        validate: (input) => input.trim().length > 0 || 'Please enter a task description'
      },
      {
        type: 'number',
        name: 'maxIterations',
        message: 'Maximum iterations:',
        default: 20,
        validate: (input) => input > 0 || 'Must be greater than 0'
      }
    ]);

    console.log(chalk.cyan(`\n🎯 Executing task: ${goal}`));
    console.log(chalk.gray(`Maximum iterations: ${maxIterations}\n`));

    try {
      await this.agent.executeTask(goal, maxIterations);
      console.log(chalk.green('\n✅ Task completed successfully!'));
    } catch (error) {
      console.error(chalk.red('\n❌ Task failed:'), error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Show current agent status
   */
  private async showStatus(): Promise<void> {
    console.log(chalk.cyan('\n📊 Agent Status'));
    console.log(chalk.gray('─'.repeat(50)));

    console.log(`Running: ${this.agent.isRunning() ? chalk.green('Yes') : chalk.red('No')}`);
    console.log(`Current Page ID: ${this.agent.getCurrentPageId() || chalk.gray('None')}`);

    const history = this.agent.getHistory();
    console.log(`History Entries: ${history.length}`);

    if (history.length > 0) {
      const lastEntry = history[history.length - 1];
      console.log(`Last Action: ${lastEntry.action?.tool || chalk.gray('None')}`);
      console.log(`Last Updated: ${lastEntry.timestamp.toLocaleString()}`);
    }

    console.log('');
  }

  /**
   * Show agent history
   */
  private async showHistory(): Promise<void> {
    const history = this.agent.getHistory();

    if (history.length === 0) {
      console.log(chalk.yellow('No history entries found.'));
      return;
    }

    console.log(chalk.cyan(`\n📜 Agent History (${history.length} entries)`));
    console.log(chalk.gray('─'.repeat(50)));

    history.slice(-10).forEach((entry, index) => {
      const time = entry.timestamp.toLocaleTimeString();
      const status = entry.observation?.error ? chalk.red('❌') : chalk.green('✅');

      console.log(`${status} ${chalk.gray(time)} - ${entry.thought.reasoning.substring(0, 60)}...`);

      if (entry.action) {
        console.log(`   ${chalk.gray('└─ Action:')} ${entry.action.tool} ${JSON.stringify(entry.action.parameters)}`);
      }

      if (entry.observation?.error) {
        console.log(`   ${chalk.gray('└─ Error:')} ${chalk.red(entry.observation.error)}`);
      }
    });

    if (history.length > 10) {
      console.log(chalk.gray(`\n... and ${history.length - 10} more entries`));
    }

    console.log('');
  }

  /**
   * Prompt for navigation
   */
  private async promptForNavigation(): Promise<void> {
    const { url } = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Enter URL to navigate to:',
        validate: (input) => {
          try {
            new URL(input);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        }
      }
    ]);

    console.log(chalk.cyan(`\n🌐 Navigating to: ${url}`));

    // This would need to be implemented in the WebAgent
    console.log(chalk.yellow('Navigation feature needs to be implemented in WebAgent'));
  }

  /**
   * Take screenshot
   */
  private async takeScreenshot(): Promise<void> {
    const filename = `screenshot-${Date.now()}.png`;

    console.log(chalk.cyan(`\n📸 Taking screenshot: ${filename}`));

    // This would need to be implemented in the WebAgent
    console.log(chalk.yellow('Screenshot feature needs to be implemented in WebAgent'));
  }

  /**
   * Show settings menu
   */
  private async showSettings(): Promise<void> {
    const { setting } = await inquirer.prompt([
      {
        type: 'list',
        name: 'setting',
        message: 'What setting would you like to configure?',
        choices: [
          { name: 'Log Level', value: 'logLevel' },
          { name: 'Risk Evaluation', value: 'riskEval' },
          { name: 'Browser Mode', value: 'browserMode' },
          { name: 'Back', value: 'back' }
        ]
      }
    ]);

    switch (setting) {
      case 'logLevel':
        await this.configureLogLevel();
        break;
      case 'riskEval':
        await this.configureRiskEvaluation();
        break;
      case 'browserMode':
        await this.configureBrowserMode();
        break;
      case 'back':
        return;
    }
  }

  /**
   * Configure log level
   */
  private async configureLogLevel(): Promise<void> {
    const { logLevel } = await inquirer.prompt([
      {
        type: 'list',
        name: 'logLevel',
        message: 'Select log level:',
        choices: [
          { name: 'OFF (only errors)', value: 'OFF' },
          { name: 'INFO (basic info)', value: 'INFO' },
          { name: 'DEBUG (verbose)', value: 'DEBUG' }
        ]
      }
    ]);

    logger.setLevel(logLevel);
    console.log(chalk.green(`✓ Log level set to: ${logLevel}`));
  }

  /**
   * Configure risk evaluation
   */
  private async configureRiskEvaluation(): Promise<void> {
    console.log(chalk.yellow('Risk evaluation configuration needs to be implemented'));
  }

  /**
   * Configure browser mode
   */
  private async configureBrowserMode(): Promise<void> {
    console.log(chalk.yellow('Browser mode configuration needs to be implemented'));
  }

  /**
   * Execute task directly from command line
   */
  private async executeDirectTask(goal: string, options: any): Promise<void> {
    try {
      validateConfig();

      console.log(chalk.cyan(`🤖 AI Web Agent - Direct Execution`));
      console.log(chalk.cyan(`Task: ${goal}`));

      if (options.headless) {
        console.log(chalk.yellow('Running in headless mode'));
      }

      await this.agent.initialize();
      this.agent.setUserAssistanceCallback(this.handleUserAssistance.bind(this));

      await this.agent.executeTask(goal, parseInt(options.maxIterations));

      console.log(chalk.green('\n✅ Task completed successfully!'));
    } catch (error) {
      console.error(chalk.red('\n❌ Task failed:'), error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Show current configuration
   */
  private async showConfig(): Promise<void> {
    try {
      validateConfig();
      console.log(chalk.green('✓ Configuration is valid'));
    } catch (error) {
      console.error(chalk.red('✗ Configuration error:'), error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Run basic tests
   */
  private async runTests(): Promise<void> {
    console.log(chalk.cyan('🧪 Running basic tests...'));

    try {
      validateConfig();
      console.log(chalk.green('✓ Configuration test passed'));

      // Test Anthropic API
      // This would require actual API testing
      console.log(chalk.yellow('⚠ API tests not implemented yet'));

    } catch (error) {
      console.error(chalk.red('✗ Test failed:'), error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Handle user assistance requests
   */
  private async handleUserAssistance(request: AssistanceRequest): Promise<boolean> {
    console.log(chalk.yellow(`\n🆘 User Assistance Requested`));
    console.log(chalk.gray('Reason:'), request.reason);
    console.log(chalk.gray('Critical:'), request.is_critical ? chalk.red('Yes') : chalk.green('No'));

    if (request.context) {
      console.log(chalk.gray('Context:'), request.context);
    }

    const { response } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'response',
        message: 'Do you want to allow this action?',
        default: false
      }
    ]);

    console.log(response ? chalk.green('✓ Action allowed') : chalk.red('✗ Action denied'));
    return response;
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    try {
      console.log(chalk.yellow('\n🧹 Cleaning up...'));
      await this.agent.cleanup();
      console.log(chalk.green('✓ Cleanup completed'));
    } catch (error) {
      console.error(chalk.red('✗ Cleanup failed:'), error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Run the CLI program
   */
  async run(argv: string[]): Promise<void> {
    try {
      await this.program.parseAsync(argv);
    } catch (error) {
      console.error(chalk.red('CLI Error:'), error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  }
}