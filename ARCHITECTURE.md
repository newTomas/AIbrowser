# Architecture Documentation

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interface (CLI)                     │
│                         src/index.js                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                         MainAgent                               │
│                    (Orchestrator)                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ • Receives user goals                                    │  │
│  │ • Makes autonomous decisions via Claude                 │  │
│  │ • Coordinates SubAgents                                  │  │
│  │ • Enforces confirmation for destructive actions         │  │
│  │ • Max 50 steps per goal                                  │  │
│  └─────────────────────────────────────────────────────────┘  │
└───┬─────────────────┬─────────────────┬───────────────────────┘
    │                 │                 │
    ▼                 ▼                 ▼
┌──────────┐   ┌──────────────┐   ┌─────────────┐
│ SubAgent │   │ SubAgent     │   │ SubAgent    │
│ (Task 1) │   │ (Task 2)     │   │ (Recovery)  │
└──────────┘   └──────────────┘   └─────────────┘
    │                 │                 │
    └─────────────────┴─────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Core Services Layer                          │
│                                                                 │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │ BrowserManager│  │ ClaudeClient   │  │ ContextManager   │  │
│  │              │  │                │  │                  │  │
│  │ • Puppeteer  │  │ • Anthropic API│  │ • Smart context  │  │
│  │ • Sessions   │  │ • Decision     │  │ • Summarization  │  │
│  │ • Actions    │  │   making       │  │ • History        │  │
│  └──────────────┘  └────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Component Interaction Flow

### 1. User Goal Execution

```
User Input
    │
    ▼
┌───────────────┐
│  MainAgent    │ 1. Receives goal
│               │ 2. Initializes execution loop
└───────┬───────┘
        │
        ▼
┌───────────────────┐
│  BrowserManager   │ 3. Gets current page state
│                   │    - URL, title, content
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│  ContextManager   │ 4. Summarizes page content
│                   │    - Extracts key elements
│                   │    - Limits context size
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│  ClaudeClient     │ 5. Sends to Claude API
│                   │    - System prompt + context
│                   │    - Returns decision JSON
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│  MainAgent        │ 6. Validates decision
│                   │    - Checks if destructive
│                   │    - Requests confirmation if needed
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│  BrowserManager   │ 7. Executes action
│                   │    - navigate, click, type, etc.
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│  ContextManager   │ 8. Records action in history
└───────────────────┘
        │
        ▼
    Loop until complete or max steps
```

### 2. Error Recovery Flow

```
Action Fails
    │
    ▼
┌───────────────────┐
│  MainAgent        │ 1. Detects failure
│                   │    - result.success === false
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│  SubAgent         │ 2. Creates specialized SubAgent
│  (Recovery)       │    - Named "Recovery-{step}"
│                   │    - Gets failure context
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│  ClaudeClient     │ 3. Asks Claude for alternative
│                   │    - Includes error details
│                   │    - Suggests different approach
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│  SubAgent         │ 4. Retries with new approach
│                   │    - Up to 3 retry attempts
│                   │    - 2-second delay between retries
└───────┬───────────┘
        │
        ├──── Success ────▶ Continue execution
        │
        └──── Still fails ─▶ Bubble up to MainAgent
```

### 3. Context Management

```
Raw Page Content (HTML)
    │
    ▼
┌─────────────────────────────────────────┐
│  BrowserManager.getPageContent()        │
│                                         │
│  Extracts:                              │
│  • Title, description                   │
│  • Body text (first 3000 chars)        │
│  • Visible links (first 50)            │
│  • Forms with inputs                    │
│  • Buttons (first 30)                  │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  ContextManager.summarizePageContent()  │
│                                         │
│  Further reduces:                       │
│  • Body preview (first 500 chars)      │
│  • Important links (first 20)          │
│  • Buttons (first 15)                  │
│  • Forms summary                        │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  ContextManager.getFullContext()        │
│                                         │
│  Builds final prompt:                   │
│  • Current page summary                 │
│  • Recent actions (last 5)             │
│  • System instructions                  │
│  • User goal                            │
│                                         │
│  Total: < 10,000 characters            │
└─────────────────┬───────────────────────┘
                  │
                  ▼
              Claude API
```

## Data Flow Diagrams

### Session Management

```
User starts application
    │
    ▼
┌────────────────────┐
│ Session Selection  │
│ • default          │  Stored in:
│ • github-session   │  ./sessions/{name}/
│ • custom-name      │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Launch Browser     │
│ with userDataDir   │  Puppeteer loads:
│                    │  • Cookies
└────────┬───────────┘  • LocalStorage
         │              • Session data
         ▼
┌────────────────────┐
│ User can:          │
│ 1. Login manually  │  Session persists
│ 2. Run automation  │  after browser closes
│ 3. Switch session  │
└────────────────────┘
```

### Decision Making Process

```
Claude receives context
    │
    ▼
Analyzes:
  • Current page state
  • User goal
  • Action history
  • Previous errors
    │
    ▼
Returns JSON decision:
{
  "thought": "reasoning",
  "action": "click",
  "parameters": { "selector": "#button" },
  "needsConfirmation": false
}
    │
    ├─── needsConfirmation: true ──▶ Ask user ──▶ Proceed or Skip
    │
    └─── needsConfirmation: false ─▶ Execute immediately
```

## Key Design Decisions

### 1. Why Sub-Agent Architecture?

**Problem**: Single agent can get stuck in error loops
**Solution**: Delegate error recovery to specialized SubAgents

Benefits:
- Isolated retry logic (doesn't pollute main conversation)
- Fresh context for alternative approaches
- Configurable max retries (3 attempts default)
- Prevents cascading failures

### 2. Why Smart Context Management?

**Problem**: Full HTML pages consume too many tokens
**Solution**: Extract only relevant information

Token reduction:
- Full page: ~50,000 tokens
- Smart extraction: ~500-1,000 tokens
- **90% reduction in API costs**

### 3. Why Persistent Sessions?

**Problem**: Manual login required for authenticated tasks
**Solution**: Puppeteer userDataDir stores session between runs

Benefits:
- Login once, reuse session
- Multiple accounts support
- Works with OAuth, 2FA, etc.
- Real browser behavior (cookies, storage)

### 4. Why Confirmation for Destructive Actions?

**Problem**: AI might perform unintended destructive operations
**Solution**: Automatic detection + user confirmation

Destructive actions detected by:
- Action type keywords (delete, purchase, submit)
- Parameter analysis (payment, buy, send)
- Manual flag (needsConfirmation: true)

## Performance Considerations

### Token Usage Optimization

```
Without optimization:
  Full HTML: 50,000 tokens
  × 50 steps = 2,500,000 tokens
  Cost: ~$75 per task

With optimization:
  Smart context: 1,000 tokens
  × 50 steps = 50,000 tokens
  Cost: ~$1.50 per task

50x cost reduction
```

### Memory Management

- Context history: Last 10 actions
- Conversation history: Last 20 messages
- Page content: Truncated to essentials
- SubAgents: Garbage collected after task

### Error Recovery Performance

```
Scenario: Action fails on Step 1

Without SubAgent:
  Step 1: Fail
  Step 2: Retry same approach
  Step 3: Fail again
  Step 4-50: Continues with flawed approach
  Result: Wastes all remaining steps

With SubAgent:
  Step 1: Fail
  SubAgent: 3 retry attempts with alternatives
  If success: Continue from Step 2
  If fail: MainAgent tries different strategy
  Result: Recovers or fails fast
```

## Security Architecture

```
┌─────────────────────────────────────────┐
│         Sensitive Operations            │
│  • Form submissions                     │
│  • Financial transactions              │
│  • Data deletion                        │
│  • Message sending                      │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│    isDestructiveAction() Check          │
│  • Keyword matching                     │
│  • Parameter analysis                   │
│  • Manual needsConfirmation flag       │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│         User Confirmation               │
│  Display: Action, reasoning, params     │
│  Prompt: "Proceed? (y/n)"              │
└─────────────────┬───────────────────────┘
                  │
            ┌─────┴─────┐
            ▼           ▼
          Yes          No
      Execute      Cancel action
                   & Continue
```

## Extension Points

### Adding New Actions

1. **BrowserManager**: Add method for browser control
2. **MainAgent/SubAgent**: Add case in executeAction()
3. **ContextManager**: Update system prompt with action description
4. **Destructive check**: Add keywords if needed

### Custom SubAgent Types

```javascript
class FormFillingAgent extends SubAgent {
  getSystemPrompt() {
    return `You are specialized in filling forms accurately...`;
  }
}

// Use in MainAgent
const formAgent = new FormFillingAgent('form-filler', ...);
await formAgent.executeTask('Fill registration form', context);
```

### Custom Context Strategies

```javascript
class DetailedContextManager extends ContextManager {
  summarizePageContent(pageContent) {
    // Custom logic for specific site types
    if (pageContent.url.includes('github.com')) {
      return this.summarizeGitHubPage(pageContent);
    }
    return super.summarizePageContent(pageContent);
  }
}
```

## Monitoring and Debugging

### Available Metrics

```javascript
const stats = mainAgent.getStats();
// {
//   stepCount: 15,
//   maxSteps: 50,
//   contextSize: 3427,
//   historyLength: 10,
//   subAgentsUsed: 2
// }
```

### Logging Levels

- **INFO**: Action start/complete
- **ERROR**: Action failures, API errors
- **DEBUG**: Claude reasoning (thought field)

### Common Issues and Solutions

1. **High step count**: Goal too complex, break into sub-tasks
2. **Context too large**: Review ContextManager limits
3. **Frequent SubAgent use**: Selectors may be unreliable
4. **Token limit errors**: Reduce MAX_CONTEXT_SIZE
