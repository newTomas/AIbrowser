# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Browser Automation - интеллектуальная система автоматизации браузера с использованием Claude AI и Puppeteer. Система позволяет автономно выполнять задачи в браузере с поддержкой persistent sessions, HTML-анализа, Vision API fallback, и человеческой помощи.

## Technology Stack

- **Runtime**: Node.js (ES Modules)
- **Browser Automation**: Puppeteer
- **AI**: Anthropic Claude API (@anthropic-ai/sdk)
- **HTML Parsing**: Cheerio (offline DOM analysis)
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
   - Manages Puppeteer browser instances with multi-tab support
   - Handles persistent sessions (stores in `./sessions/{sessionName}`)
   - Provides smart page content extraction (not full HTML)
   - Universal CAPTCHA visibility checking (works with any provider)
   - **Key methods**:
     - `launch()`, `goto()`, `getPageContent()`, `getHTML()`
     - `click()`, `type()` - **Always clear input before typing, use DOM click to avoid overlays**
     - `createTab()`, `switchTab()`, `closeTab()`, `getAllTabs()`
     - `checkCaptchaVisibility()` - Universal approach, checks CSS visibility/opacity

2. **MainAgent** (`src/agents/MainAgent.js`)
   - Orchestrates autonomous browser automation
   - Makes decisions through Claude API
   - Coordinates SubAgents, HTMLAnalyzer, VisionFallback, HumanAssistance
   - Loop detection (prevents infinite action repetition)
   - Implements confirmation flow for destructive actions
   - Maximum 50 steps per goal (configurable via MAX_STEPS)

3. **HTMLAnalyzerAgent** (`src/agents/HTMLAnalyzerAgent.js`)
   - Runs in **separate context** to avoid bloating main conversation
   - Uses Cheerio for offline DOM parsing
   - Generates reliable CSS selectors (priority: ID > data-testid > name > aria-label)
   - Returns compact summaries with actionable elements + selectors
   - **Key methods**: `analyzePage()`, `getCompactSummary()`, `generateBestSelector()`

4. **VisionFallbackAgent** (`src/agents/VisionFallbackAgent.js`)
   - Fallback when HTML analysis fails or elements not found
   - Uses Claude Vision API to analyze screenshots
   - Can detect CAPTCHAs, find elements visually, identify issues
   - **Key methods**: `analyzeWithVision()`, `analyzeScreenshot()`, `findElementInScreenshot()`

5. **HumanAssistanceManager** (`src/utils/HumanAssistanceManager.js`)
   - Handles CAPTCHA, 2FA, ambiguity, element not found
   - Cooldown tracking (domain-based, survives redirects)
   - Skip list for temporary detection bypass
   - **NEW**: Supports text input from user (not just option buttons)
   - **Key methods**: `requestCaptchaHelp()`, `request2FAHelp()`, `requestHelp()`, `markResolved()`

6. **DetectionUtils** (`src/utils/DetectionUtils.js`)
   - **Universal CAPTCHA detection** - works with any provider (not just reCAPTCHA/hCaptcha)
   - Distinguishes active challenges from passive scripts
   - Checks actual visibility (display, visibility, opacity)
   - Improved 2FA detection (excludes promo codes, zip codes)
   - **Key functions**: `detectCaptcha()`, `detect2FA()`, `detectHumanRequired()`

7. **ContextManager** (`src/context/ContextManager.js`)
   - Implements smart context management
   - **NEW**: Tracks open tabs and displays them in context
   - Summarizes page content to reduce token usage
   - Maintains action history (last 10 actions)
   - Limits context to 10,000 characters by default
   - Defines available actions for AI (evaluate, tab management, human help)

8. **ClaudeClient** (`src/claude/ClaudeClient.js`)
   - Wrapper for Anthropic API
   - Manages conversation history (last 20 messages)
   - Improved JSON parsing (strips markdown blocks, extracts nested JSON)
   - Supports Vision API for screenshot analysis
   - **Key methods**: `getDecision()`, `analyzeImage()`, `analyzeScreenshot()`

9. **SubAgent** (`src/agents/SubAgent.js`)
   - Handles specific tasks with retry logic
   - Up to 3 retries per action with exponential backoff
   - Used for error recovery by MainAgent
   - Each SubAgent is stateless and task-specific

### Key Design Patterns

**Multi-Tab Architecture**:
- Tracks all open tabs with `Map<tabId, {page, title, url}>`
- `createTab()` automatically switches to new tab
- Context shows all open tabs to AI - AI should use `switch_tab` instead of `navigate` for already-open pages
- Auto `bringToFront()` before click/type to ensure correct tab is active

**HTML Analysis in Separate Context**:
- HTMLAnalyzerAgent runs in isolated conversation to avoid context bloat
- Uses Cheerio for offline DOM parsing + Claude for semantic understanding
- Returns compact summary (~90% size reduction) with CSS selectors
- Main conversation only receives actionable elements with selectors

**Universal CAPTCHA Detection**:
- Not tied to specific providers (reCAPTCHA, hCaptcha, Cloudflare)
- Uses generic selectors: `[class*="captcha"]`, `iframe[src*="captcha"]`
- Checks CSS visibility: `display`, `visibility`, `opacity`
- Distinguishes badge size (<100x100) from challenge size (>250x250)

**Smart Context Management**:
- Never sends full HTML to Claude API
- Extracts: title, description, first 500 chars of body, visible buttons/links, forms
- Reduces token usage by ~90% compared to full page content
- Maintains context size under 10KB for optimal performance

**Human Assistance with Text Input**:
- AI can request help with `request_human_help` action
- User can choose: 1) Complete manually, 2) Provide text/data, 3) Skip, 4) Abort
- Data flows back to AI via `result.userData`
- Domain-based cooldown prevents repeated requests on same site

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

**Loop Detection**:
- Tracks last 10 action signatures
- If same action repeats 3+ times in last 5 actions → requests human help
- Prevents AI from getting stuck in infinite loops

## Important Implementation Details

### Browser Interaction Best Practices

**Click Implementation**:
```javascript
// Uses DOM click (not coordinate click) to avoid hitting overlays/ads
const element = await page.$(selector);
await element.evaluate(el => el.scrollIntoView()); // Scroll into view
await element.click(); // DOM click bypasses visual layers
```

**Type Implementation**:
```javascript
// ALWAYS clears existing content before typing
await element.click({ clickCount: 3 }); // Triple-click to select all
await page.keyboard.press('Backspace'); // Delete
await element.type(text); // Type new text
```

**Navigation Handling**:
```javascript
// Uses domcontentloaded instead of networkidle2 (faster, handles slow resources)
await page.goto(url, {
  waitUntil: 'domcontentloaded',
  timeout: 15000
});

// Distinguishes critical errors (ERR_NAME_NOT_RESOLVED) from timeouts
// Returns false for DNS errors, true for timeouts (page may be usable)
```

**Evaluate Execution**:
```javascript
// Handles both simple expressions and multi-line scripts
// Simple: "document.querySelector('#id').value"
// Multi-line: "const el = document.querySelector('#id'); return el.value;"
// Automatically wraps in IIFE to support return statements
```

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
If still fails → Try Vision API fallback → Request human help → Bubble up to MainAgent
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

`HTMLAnalyzerAgent.getCompactSummary()` provides:
- `topButtons` (10 with selectors)
- `forms` (2 with input selectors)
- `keyActions` (3 recommended)
- `potentialIssues` (2 warnings)

### CAPTCHA Detection Flow

```
1. Check URL for captcha keywords → High confidence
2. Check for active indicators (title/body text) → Mark as active
3. Check HTML for passive indicators → Lower confidence
4. Call checkCaptchaVisibility() to verify actual visibility
   - Checks CSS: display, visibility, opacity
   - Distinguishes badge from challenge by size
5. Only request help if: isActive && confidence > 0.7 && visually confirmed
```

### Tab Management Rules for AI

AI should follow these rules (defined in ContextManager):
1. Check "Open Tabs" section to see all available tabs
2. To access content from another tab, use `switch_tab` FIRST, then perform actions
3. Do NOT navigate to URLs that are already open in other tabs - use `switch_tab` instead
4. Example: If temp-mail.org is already open in tab-0, do `switch_tab` to tab-0 instead of `navigate`

### Claude API Integration

Expected response format from Claude:
```json
{
  "thought": "reasoning about next action",
  "action": "navigate|click|type|evaluate|create_tab|switch_tab|request_human_help|complete",
  "parameters": { "url": "...", "selector": "...", "text": "...", "script": "..." },
  "needsConfirmation": false
}
```

Available actions:
- `navigate`: Navigate to URL
- `click`: Click element (uses DOM click, avoids overlays)
- `type`: Type into field (clears first)
- `evaluate`: Execute JavaScript (simple expressions or multi-line with variables)
- `press_enter`, `go_back`, `scroll`, `wait`
- `create_tab`, `switch_tab`, `close_tab`, `list_tabs`, `find_tab`
- `request_human_help`: Request user assistance (user can provide text response)
- `complete`: Mark task complete

Special actions:
- `complete`: Signals task completion, must include `summary` field
- `evaluate`: Simple expressions (no semicolons/vars) or multi-line scripts (with const/let and return)
- `request_human_help`: User can now provide text data back to AI

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

## Common Pitfalls and Solutions

### Browser Interaction Issues

- **Click hits ads instead of target** - Fixed: Using DOM click (element.click()) instead of coordinate click
- **Type appends to existing text** - Fixed: Triple-click + Backspace to clear before typing
- **Navigation timeout on slow pages** - Fixed: Using domcontentloaded (15s timeout) instead of networkidle2 (30s)
- **Wrong tab receives actions** - Fixed: Auto bringToFront() before click/type
- **Execution context destroyed** - Fixed: Catch error, return placeholder data instead of crashing

### CAPTCHA Detection Issues

- **False positives from passive scripts** - Check `isActive` flag and `checkCaptchaVisibility()`
- **Missing hidden CAPTCHAs** - Check CSS: `visibility: hidden`, `opacity: 0`, `display: none`
- **Wrong provider assumptions** - Use universal selectors, not hardcoded reCAPTCHA/hCaptcha
- **Badge vs challenge confusion** - Check size: badge <100x100, challenge >250x250

### AI Behavior Issues

- **AI doesn't know about other tabs** - Context now shows all open tabs
- **AI navigates instead of switching tabs** - Added rule #7 in ContextManager
- **AI tries non-existent actions** - Explicit action list in prompt with "use ONLY these"
- **AI gets stuck in loops** - Loop detection triggers human help after 3 repeats
- **AI uses clipboard instead of evaluate** - Added rule #6: prefer evaluate for text extraction

### Context and Token Issues

- **Context too large** - HTMLAnalyzerAgent runs in separate context, returns compact summary
- **Token limits** - ContextManager keeps context under 10K chars, but monitor usage
- **Full HTML sent to API** - Never use raw HTML, always use getPageContent() + summarizePageContent()

### Error Recovery

- **CSS selectors break** - SubAgent retry logic + Vision fallback
- **Element not found** - HTMLAnalyzerAgent generates reliable selectors (ID > data-testid > aria-label)
- **Vision API needed** - Fallback when HTML analysis fails, but track usage (screenshotCount)

## Extension Points

To extend functionality:

1. **Custom SubAgents**: Create specialized SubAgents for complex tasks (e.g., form filling, search operations)
2. **Action Plugins**: Add domain-specific actions (e.g., social media posting, data extraction)
3. **Context Strategies**: Implement custom context extraction for specific site types
4. **Confirmation Policies**: Customize what counts as "destructive" per use case
5. **Detection Rules**: Add site-specific CAPTCHA/2FA patterns in DetectionUtils
6. **HTML Analysis Rules**: Extend HTMLAnalyzerAgent for domain-specific parsing

## Security Considerations

- Sessions directory contains cookies/credentials - add to `.gitignore`
- Never commit `.env` file with API keys
- Destructive action confirmation is mandatory for safety
- `--disable-web-security` flag is for development only - remove in production
- Validate user input before passing to browser actions
- Human assistance allows text input - sanitize if executing as code
