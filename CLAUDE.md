# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm run dev          # Run in development mode with ts-node
npm run build        # Compile TypeScript and resolve path aliases
npm start            # Run compiled application (starts interactive mode by default)
```

### Testing & Setup
```bash
npx playwright install  # Install Playwright browsers (required)
npm start -- config      # Validate configuration
npm start -- test        # Run basic connectivity tests
```

### CLI Usage
```bash
npm start              # Interactive mode (default behavior)
npm start interactive   # Explicit interactive mode
npm start execute "task"  # Execute task directly
npm start execute "task" --max-iterations 30  # Custom iterations
npm start execute "task" --headless         # Headless browser mode
npm start --help         # Show available commands
```

## Architecture Overview

This is an autonomous web automation agent built with a ReAct (Reasoning-Acting-Observing) cycle architecture. The system integrates multiple specialized components to achieve intelligent web automation with robust security and memory capabilities.

### Core Components Integration

**WebAgent** (`src/agent/WebAgent.ts`) is the central orchestrator that:
- Manages the ReAct cycle: generates thoughts, decides actions, executes them, and observes results
- Integrates all subsystems: browser automation, security evaluation, memory, CLI, and copy functionality
- Maintains conversation history for self-correction and context awareness
- Handles user assistance requests through CLI callbacks

**Browser Automation Layer**:
- `BrowserManager`: Persistent browser context with proper multi-tab state management (prevents duplicate tabs)
- `ElementTagger`: Intelligent element detection that processes main document AND iframe content with unified ID system
- `PageActions`: Implements 9 core action tools (click, type, navigate, scroll, switch tabs, wait, screenshot, request assistance, goal_achieved) with enhanced validation and intelligent text extraction

**Security Layer** (`src/security/RiskEvaluator.ts`):
- LLM-based risk evaluation before each action execution using Claude
- Three-tier risk classification (HIGH/MEDIUM/LOW) with configurable confirmation requirements
- URL safety validation and sensitive content detection
- Blocks potentially destructive actions and requires human confirmation for high-risk operations

**Memory System** (`src/agent/memory.ts`):
- Stores and learns from action history with success/failure patterns
- Context-aware memory retrieval based on current URL and action types
- Pattern recognition for avoiding repeated mistakes
- Export/import functionality for knowledge persistence

**CLI Interface** (`src/cli/InteractiveCLI.ts`):
- Interactive mode with menu-driven navigation and human-in-the-loop support
- Direct task execution with command-line options
- Real-time progress reporting and user assistance integration

### Data Flow

1. **User Input** → CLI parses goal (default: interactive mode, or explicit commands)
2. **ReAct Cycle Start** → WebAgent generates strategic thought considering multi-tab workflows
3. **Action Decision** → LLM selects appropriate action tool from expanded toolkit (9 available actions)
4. **Security Check** → RiskEvaluator analyzes action safety and may request confirmation
5. **Execution** → PageActions performs browser automation with enhanced element validation
6. **Observation** → ElementTagger scans all pages (including iframes) for state changes
7. **Context Update** → Chat history stores conversation for context awareness
8. **Loop Continuation** → Cycle repeats until goal achieved or max iterations reached

### Critical Features

**Iframe Support**: Unlike typical web scrapers, this system processes content inside iframes as part of a unified element set with sequential IDs, preventing ID collisions and enabling automation of complex modern web applications.

**Element ID Management**: Always clears stale IDs before each tagging session for consistent element identification and reliable targeting across automation cycles.

**Enhanced User Assistance**: Multi-option assistance system with 5 response choices (allow/deny/skip/pause/instruct) instead of simple y/n prompts.

**Visibility Filtering**: Intelligent text extraction that filters hidden child elements based on display, visibility, opacity, and hidden attributes to prevent false positives.

**Multi-tab Intelligence**: Smart tab management that prevents duplicate creation and maintains proper active tab state with detailed logging.

**Element Validation**: Comprehensive validation prevents type_text errors on incompatible elements like labels and buttons with clear error messages.

**Wait Actions**: Flexible timing controls for page loading and dynamic content with both duration (in milliseconds) and CSS selector-based waiting.

### Key Architectural Patterns

**Path Aliases**: Uses TypeScript path mapping (`@/`, `@/types/`, etc.) for clean imports. Build process uses `tsc-alias` to resolve these at runtime.

**Configuration Management**: Centralized in `src/utils/config.ts` with environment variable validation and type-safe defaults.

**Logging System**: Structured logging with multiple levels (OFF/INFO/DEBUG) and specialized formatters for ReAct cycle steps, security events, and detailed debugging.

**Error Handling**: Comprehensive error recovery with self-correction through history analysis and user assistance fallbacks.

### Environment Configuration

Required `.env` variables:
- `ANTHROPIC_API_KEY`: Claude API access
- `ANTHROPIC_BASE_URL`: Custom API endpoint (if used)
- `USER_DATA_DIR`: Browser profile directory
- `LOG_LEVEL`: OFF/INFO/DEBUG (affects detailed output)
- `ENABLE_RISK_EVALUATION`: Security layer toggle
- `HEADLESS`: Browser visibility setting
- `BROWSER_TIMEOUT`: Browser operation timeout

**Action Tool Summary**: The system supports 9 core actions: click_element, type_text, navigate_to, scroll_page, switch_to_page, wait, screenshot, request_user_assistance, and goal_achieved. Each action includes parameter validation and error handling.

**Rate Limiting**: Built-in rate limiting system (RateLimiterManager) prevents excessive API calls and browser actions with configurable windows.

The system is designed for extensibility - new action tools can be added to PageActions, security rules enhanced in RiskEvaluator, and rate limiting rules configured in RateLimiterManager.