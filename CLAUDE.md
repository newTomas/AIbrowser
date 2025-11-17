# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Browser Automation - интеллектуальная система автоматизации браузера с использованием Claude AI и Puppeteer. Система позволяет автономно выполнять задачи в браузере с поддержкой persistent sessions.

## Technology Stack

- **Runtime**: Node.js (ES Modules)
- **Browser Automation**: Puppeteer
- **AI**: Anthropic Claude API (@anthropic-ai/sdk)
- **Environment**: dotenv for configuration

## Running Commands

```bash
# Install dependencies
npm install

# Run application
npm start

# Development mode with auto-reload
npm run dev

# Run tests
npm test
```

## Architecture

### Core Components

1. **BrowserManager** (`src/browser/BrowserManager.js`)
   - Manages Puppeteer browser instances
   - Handles persistent sessions (stores in `./sessions/{sessionName}`)
   - Provides smart page content extraction (not full HTML)
   - Key methods: `launch()`, `goto()`, `getPageContent()`, `click()`, `type()`

2. **MainAgent** (`src/agents/MainAgent.js`)
   - Orchestrates autonomous browser automation
   - Makes decisions through Claude API
   - Coordinates SubAgents for error recovery
   - Implements confirmation flow for destructive actions
   - Maximum 50 steps per goal (configurable via MAX_STEPS)

3. **SubAgent** (`src/agents/SubAgent.js`)
   - Handles specific tasks with retry logic
   - Up to 3 retries per action with exponential backoff
   - Used for error recovery by MainAgent
   - Each SubAgent is stateless and task-specific

4. **ContextManager** (`src/context/ContextManager.js`)
   - Implements smart context management
   - Summarizes page content to reduce token usage
   - Maintains action history (last 10 actions)
   - Limits context to 10,000 characters by default

5. **ClaudeClient** (`src/claude/ClaudeClient.js`)
   - Wrapper for Anthropic API
   - Manages conversation history (last 20 messages)
   - Handles JSON parsing of Claude responses
   - Supports streaming for long-running tasks

### Key Design Patterns

**Sub-agent Architecture**:
- MainAgent delegates error recovery to specialized SubAgents
- Each SubAgent gets full context of failed action + error details
- SubAgents automatically retry with alternative approaches
- Prevents cascading failures through isolated retry logic

**Smart Context Management**:
- Never sends full HTML to Claude API
- Extracts: title, description, first 500 chars of body, visible buttons/links, forms
- Reduces token usage by ~90% compared to full page content
- Maintains context size under 10KB for optimal performance

**Destructive Action Confirmation**:
- Automatic detection via action names and parameters
- Keywords: 'delete', 'submit', 'purchase', 'payment', 'buy', 'send_message'
- User must explicitly confirm via CLI prompt
- Can be bypassed with AUTO_CONFIRM=true (testing only)

**Persistent Sessions**:
- Browser sessions saved to `./sessions/{sessionName}/` directory
- Includes cookies, localStorage, session storage
- Allows manual login, then automated tasks with authenticated session
- Multiple sessions supported (e.g., different user accounts)

## Important Implementation Details

### Adding New Browser Actions

When adding a new action that the AI can perform:

1. Add method to `BrowserManager.js`
2. Add case to `MainAgent.executeAction()` and `SubAgent.executeAction()`
3. Update system prompt in `ContextManager.getFullContext()` with action description
4. If destructive, add keywords to `MainAgent.isDestructiveAction()`

### Error Handling Flow

```
Action fails → MainAgent detects failure → Creates SubAgent
SubAgent gets context + error → Claude suggests alternative
SubAgent executes with retry (up to 3 attempts)
If still fails → Bubble up to MainAgent → Continue with next step
```

### Context Optimization

`BrowserManager.getPageContent()` extracts:
- `title`, `description` (meta tags)
- `body` (first 3000 chars of visible text)
- `links` (first 50 visible links with text + href)
- `forms` (all forms with input details)
- `buttons` (first 30 visible buttons)

`ContextManager.summarizePageContent()` further reduces this:
- `bodyPreview` (first 500 chars)
- `importantLinks` (first 20 links)
- `buttons` (first 15 buttons)

### Claude API Integration

Expected response format from Claude:
```json
{
  "thought": "reasoning about next action",
  "action": "navigate|click|type|wait|scroll|screenshot|evaluate|complete",
  "parameters": { "url": "...", "selector": "...", "text": "..." },
  "needsConfirmation": false
}
```

Special actions:
- `complete`: Signals task completion, must include `summary` field
- `wait`: Pauses execution, useful when waiting for page changes
- `evaluate`: Executes arbitrary JavaScript on page (use sparingly)

## Configuration

Configuration priority:
1. Environment variables in `.env`
2. Defaults in `config/config.js`

Key settings:
- `ANTHROPIC_API_KEY`: Required for Claude API
- `BROWSER_HEADLESS`: false for visible browser (debugging)
- `SESSION_DIR`: Where to store browser sessions
- `MAX_STEPS`: Maximum steps per goal (prevents infinite loops)
- `MAX_CONTEXT_SIZE`: Maximum context size in characters

## Testing Strategy

When making changes:
1. Test with simple navigation task first
2. Verify session persistence by closing/reopening
3. Test error recovery by intentionally using wrong selectors
4. Verify destructive action confirmation works
5. Check token usage doesn't exceed limits

## Common Pitfalls

- **Don't send full page HTML to Claude** - Use `getPageContent()` which extracts smart summaries
- **Always check if browser is running** - Use `browserManager.isRunning()`
- **Handle navigation timeouts** - Pages may take >30s to load, adjust timeout as needed
- **CSS selectors may break** - SubAgent retry logic handles this
- **Token limits** - ContextManager keeps context under 10K chars, but monitor usage
- **Session directory permissions** - Ensure `./sessions/` is writable

## Extension Points

To extend functionality:

1. **Custom SubAgents**: Create specialized SubAgents for complex tasks (e.g., form filling, search operations)
2. **Action Plugins**: Add domain-specific actions (e.g., social media posting, data extraction)
3. **Context Strategies**: Implement custom context extraction for specific site types
4. **Confirmation Policies**: Customize what counts as "destructive" per use case

## Security Considerations

- Sessions directory contains cookies/credentials - add to `.gitignore`
- Never commit `.env` file with API keys
- Destructive action confirmation is mandatory for safety
- `--disable-web-security` flag is for development only - remove in production
- Validate user input before passing to browser actions
