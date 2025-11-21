import * as p from '@clack/prompts';
import pc from 'picocolors';

/**
 * Ask user for text input with modern interactive UI
 * @param {string} message - Question to ask
 * @param {string} [placeholder] - Placeholder text
 * @param {string} [defaultValue] - Default value
 * @returns {Promise<string>} User's input
 */
export async function askForInput(message, placeholder = '', defaultValue = '') {
  const result = await p.text({
    message,
    placeholder,
    defaultValue,
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}

/**
 * Ask user yes/no confirmation with modern UI
 * @param {string} message - Question to ask
 * @param {boolean} [initialValue=false] - Default value
 * @returns {Promise<boolean>} User's choice
 */
export async function askYesNo(message, initialValue = false) {
  const result = await p.confirm({
    message,
    initialValue,
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}

/**
 * Select from menu with arrow keys
 * @param {string} message - Menu prompt
 * @param {Array<{value: string, label: string, hint?: string}>} options - Menu options
 * @returns {Promise<string>} Selected value
 */
export async function selectFromMenu(message, options) {
  const result = await p.select({
    message,
    options,
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}

/**
 * Multi-select from menu with arrow keys and space to toggle
 * @param {string} message - Menu prompt
 * @param {Array<{value: string, label: string, hint?: string}>} options - Menu options
 * @returns {Promise<string[]>} Selected values
 */
export async function multiSelect(message, options) {
  const result = await p.multiselect({
    message,
    options,
    required: false,
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}

/**
 * Display intro/header
 * @param {string} title - Title to display
 */
export function intro(title) {
  p.intro(pc.cyan(title));
}

/**
 * Display outro/footer
 * @param {string} message - Message to display
 */
export function outro(message) {
  p.outro(message);
}

/**
 * Display note/info message
 * @param {string} message - Message to display
 * @param {string} [type='info'] - Type: 'info', 'success', 'warning', 'error'
 */
export function note(message, type = 'info') {
  const colors = {
    info: pc.blue,
    success: pc.green,
    warning: pc.yellow,
    error: pc.red,
  };

  const symbols = {
    info: 'ℹ',
    success: '✓',
    warning: '⚠',
    error: '✗',
  };

  const color = colors[type] || colors.info;
  const symbol = symbols[type] || symbols.info;

  p.note(message, color(`${symbol} ${type.toUpperCase()}`));
}

/**
 * Display spinner for long operations
 * @returns {Object} Spinner object with start/stop/message methods
 */
export function spinner() {
  return p.spinner();
}

/**
 * Confirm destructive action with details
 * @param {Object} action - Action object {action, thought, parameters}
 * @returns {Promise<boolean>} User's confirmation
 */
export async function confirmAction(action) {
  p.intro(pc.yellow('⚠️  CONFIRMATION REQUIRED'));

  // Build action details
  let details = `${pc.bold('Action:')} ${action.action}\n`;
  details += `${pc.bold('Reasoning:')} ${action.thought}\n`;

  if (action.parameters) {
    details += `${pc.bold('Parameters:')}\n`;
    for (const [key, value] of Object.entries(action.parameters)) {
      details += `  • ${key}: ${JSON.stringify(value)}\n`;
    }
  }

  p.note(details, pc.yellow('Action Details'));

  const confirmed = await p.confirm({
    message: 'Do you want to proceed with this action?',
    initialValue: false,
  });

  if (p.isCancel(confirmed)) {
    p.cancel('Action cancelled');
    return false;
  }

  if (confirmed) {
    p.outro(pc.green('✓ Action confirmed'));
  } else {
    p.outro(pc.red('✗ Action cancelled'));
  }

  return confirmed;
}

/**
 * Display action result
 * @param {Object} result - Result object {success, error?, data?}
 */
export function displayActionResult(result) {
  if (result.success) {
    note('Action completed successfully', 'success');
    if (result.data) {
      console.log(pc.dim(JSON.stringify(result.data, null, 2)));
    }
  } else {
    note(`Action failed: ${result.error || 'Unknown error'}`, 'error');
  }
}

/**
 * Create a group of related prompts
 * @param {Object} prompts - Object mapping keys to prompt functions
 * @param {Function} [onCancel] - Optional cancel handler
 * @returns {Promise<Object>} Object mapping keys to results
 */
export async function group(prompts, onCancel = null) {
  const result = await p.group(prompts, {
    onCancel: onCancel || (() => {
      p.cancel('Operation cancelled');
      process.exit(0);
    }),
  });

  return result;
}
