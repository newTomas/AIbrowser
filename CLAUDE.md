# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm run dev          # Run in development mode with ts-node
npm run build        # Compile TypeScript and resolve path aliases
npm start            # Run compiled application
```

### Testing & Setup
```bash
npx playwright install  # Install Playwright browsers
npm start -- config      # Validate configuration
npm start -- test        # Run basic connectivity tests
```

### CLI Usage
```bash
npm start interactive                         # Interactive mode with menu
npm start execute "task description"          # Execute task directly
npm start execute "task" --max-iterations 30 # With custom iterations
npm start execute "task" --headless           # Headless browser mode
```

## Architecture Overview

This is an autonomous web automation agent built with a ReAct (Reasoning-Acting-Observing) cycle architecture. The system integrates multiple specialized components to achieve intelligent web automation.

### Core Components Integration

**WebAgent** (`src/agent/WebAgent.ts`) is the central orchestrator that:
- Manages the ReAct cycle: generates thoughts, decides actions, executes them, and observes results
- Integrates all subsystems: browser automation, security evaluation, memory, and CLI
- Maintains conversation history for self-correction and context awareness
- Handles user assistance requests through CLI callbacks

**Browser Automation Layer**:
- `BrowserManager`: Persistent browser context with multi-tab management using Playwright
- `ElementTagger`: Intelligent element detection that injects `data-agent-id` into DOM for reliable element interaction
- `PageActions`: Implements the 6 core action tools (click, type, navigate, scroll, switch tabs, request assistance)

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

### Data Flow

1. **User Input** → CLI parses goal and options
2. **ReAct Cycle Start** → WebAgent generates initial thought about current state
3. **Action Decision** → LLM selects appropriate action tool based on context
4. **Security Check** → RiskEvaluator analyzes action safety and may request confirmation
5. **Execution** → PageActions performs the browser automation
6. **Observation** → ElementTagger scans page, captures state, updates context
7. **Memory Update** → AgentMemory stores outcome for learning
8. **Loop Continuation** → Cycle repeats until goal achieved or max iterations reached

### Key Architectural Patterns

**Path Aliases**: Uses TypeScript path mapping (`@/`, `@/types/`, etc.) for clean imports. Build process uses `tsc-alias` to resolve these at runtime.

**Configuration Management**: Centralized in `src/utils/config.ts` with environment variable validation and type-safe defaults.

**Logging System**: Structured logging with multiple levels (OFF/INFO/DEBUG) and specialized formatters for ReAct cycle steps.

**Error Handling**: Comprehensive error recovery with self-correction through history analysis and user assistance fallbacks.

### Environment Configuration

Required `.env` variables:
- `ANTHROPIC_API_KEY`: Claude API access
- `USER_DATA_DIR`: Browser profile directory
- `LOG_LEVEL`: OFF/INFO/DEBUG
- `ENABLE_RISK_EVALUATION`: Security layer toggle

The system is designed for extensibility - new action tools can be added to PageActions, security rules enhanced in RiskEvaluator, and memory patterns expanded in AgentMemory.