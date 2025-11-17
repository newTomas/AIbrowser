import readline from 'readline';

/**
 * Request user confirmation for destructive actions
 * @param {object} action - The action that needs confirmation
 * @returns {Promise<boolean>} - True if user confirms, false otherwise
 */
export async function confirmAction(action) {
  console.log('\n⚠️  CONFIRMATION REQUIRED ⚠️');
  console.log('─'.repeat(50));
  console.log(`Action: ${action.action}`);
  console.log(`Reasoning: ${action.thought}`);

  if (action.parameters) {
    console.log('Parameters:');
    Object.entries(action.parameters).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });
  }

  console.log('─'.repeat(50));

  return await askYesNo('Do you want to proceed with this action?');
}

/**
 * Ask yes/no question
 */
export async function askYesNo(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Ask for user input
 */
export async function askForInput(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question}: `, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Display action result
 */
export function displayActionResult(action, result) {
  console.log('\n✓ Action completed');
  console.log(`Action: ${action.action}`);
  if (result.success !== undefined) {
    console.log(`Success: ${result.success}`);
    if (result.error) {
      console.log(`Error: ${result.error}`);
    }
  }
  console.log();
}
