// ReAct Agent Types
export interface Thought {
  reasoning: string;
  next_action?: string;
  confidence?: number;
}

export interface Action {
  tool: string;
  parameters: Record<string, unknown>;
}

// Typed action interface for better type safety
export type TypedAction = ActionParameters;

// Last action results type
export interface LastActionResults {
  click_element?: { success: boolean; elementId: number };
  type_text?: { success: boolean; elementId: number; textLength: number };
    navigate_to?: { success: boolean; url: string; finalUrl?: string };
  scroll_page?: { success: boolean; direction: string; scrollAmount: number };
  switch_to_page?: { success: boolean; pageId: number; previousPageId?: number };
  screenshot?: { success: boolean; filename: string; path: string };
  wait?: { success: boolean; duration: number; reason?: string };
  request_user_assistance?: { success: boolean; reason: string; response: boolean };
  goal_achieved?: { success: boolean; summary: string; iterations: number };
}

export interface ModelResponse {
  thought: string;
  action?: {
    tool: string;
    parameters?: Record<string, unknown>;
  };
  goal_achieved?: {
    summary: string;
  };
}

export interface Observation {
  timestamp: Date;
  page_info: {
    url: string;
    title: string;
  };
  elements: TaggerElement[];
  tabs: TabInfo[];
  error?: string;
  history_summary?: string;
}

export interface TaggerElement {
  id: number;
  role: string;
  value: string | number | boolean;
  input_type?: string;
  input_group?: string;
  text: string;
}

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  is_active: boolean;
}

// Browser Types
export interface BrowserConfig {
  headless: boolean;
  userDataDir: string;
  timeout: number;
}

export interface NavigationOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

// Security Types
export interface RiskAssessment {
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning: string;
  requires_confirmation: boolean;
}

export interface SecurityContext {
  action: Action;
  current_url: string;
  target_element?: TaggerElement | null;
}

// Configuration Types
export interface LogLevel {
  OFF: 0;
  INFO: 1;
  DEBUG: 2;
}

export type LogLevelValue = keyof LogLevel;

export type ModelType = 'claude-sonnet-4-5' | 'claude-4.5-haiku' | 'claude-3-haiku-20240307' | 'claude-3-opus-20240229';

export interface ModelConfig {
  main: ModelType;
  risk: ModelType;
  maxTokens?: number;
}

export interface AppConfig {
  anthropicApiKey: string;
  anthropicBaseUrl?: string;
  userDataDir: string;
  logLevel: LogLevelValue;
  enableRiskEvaluation: boolean;
  headless: boolean;
  browserTimeout: number;
  models?: ModelConfig;
  rateLimits?: RateLimitConfig;
  sensitiveFilterLevel: SensitiveFilterLevel;
}

export type SensitiveFilterLevel = 'OFF' | 'PARTIAL' | 'STRICT';

export interface RateLimitConfig {
  apiRateLimit: number;        // API requests per minute
  actionRateLimit: number;     // Browser actions per 10 seconds
  navigationRateLimit: number; // Page navigations per 30 seconds
}

// Error Types
export interface AgentError {
  type: 'PLAYWRIGHT' | 'SECURITY' | 'API' | 'VALIDATION';
  message: string;
  details?: ErrorDetails;
  recoverable: boolean;
}

// CLI Types
export interface CLIChoice {
  name: string;
  value: unknown;
  description?: string;
}

export interface AssistanceRequest {
  reason: string;
  is_critical: boolean;
  context?: string;
}

// Chat Message Types
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

// Additional action types for new functionality
export interface ScreenshotAction {
  tool: 'screenshot';
  parameters?: {
    filename?: string;
    reason?: string;
  };
}

export interface GoalAchievedAction {
  tool: 'goal_achieved';
  parameters: {
    summary: string;
  };
}

// DOM Element interfaces for better type safety
export interface DOMElement {
  tagName: string;
  id?: string;
  className?: string;
  name?: string;
  value?: string;
  placeholder?: string;
  type?: string;
  textContent?: string | null;
  innerText?: string | null;
  title?: string | null;
  href?: string;
  checked?: boolean;
  options?: HTMLOptionsCollection;
  selectedIndex?: number;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getBoundingClientRect(): DOMRect;
  scrollIntoView(options?: ScrollIntoViewOptions): void;
  click(): void;
  focus(): void;
}

export interface DOMWindow {
  document: Document;
  getComputedStyle(element: Element): CSSStyleDeclaration;
  innerHeight: number;
  innerWidth: number;
  scrollBy(x: number, y: number): void;
  hasFocus(): boolean;
}

// Action parameter types for better type safety
export interface ClickElementParams {
  id: number;
  // page_id не требуется - используется currentPageId
}

export interface TypeTextParams {
  id: number;
  text: string;
  // page_id не требуется - используется currentPageId
}


export interface NavigateToParams {
  url: string;
  new_tab?: boolean;
}

export interface ScrollPageParams {
  direction: 'up' | 'down';
  // page_id не требуется - используется currentPageId
}

export interface SwitchToPageParams {
  // Может принимать либо id, либо page_id
  id?: number;
  page_id?: number;
}

export interface ScreenshotParams {
  filename?: string;
}

export interface RequestUserAssistanceParams {
  reason: string;
  is_critical?: boolean;
}

export interface GoalAchievedParams {
  summary: string;
}

export interface WaitParams {
  duration?: number;
  selector?: string;
}

// Union type for all action parameters
export type ActionParameters =
  | { tool: 'click_element'; parameters: ClickElementParams }
  | { tool: 'type_text'; parameters: TypeTextParams }
    | { tool: 'navigate_to'; parameters: NavigateToParams }
  | { tool: 'scroll_page'; parameters: ScrollPageParams }
  | { tool: 'switch_to_page'; parameters: SwitchToPageParams }
  | { tool: 'screenshot'; parameters: ScreenshotParams }
  | { tool: 'request_user_assistance'; parameters: RequestUserAssistanceParams }
  | { tool: 'goal_achieved'; parameters: GoalAchievedParams }
  | { tool: 'wait'; parameters: WaitParams };

// Parameter validation types
export interface ParameterValidator<T = unknown> {
  (value: unknown): T | null;
}

export interface ParameterValidationRules {
  id: ParameterValidator<number>;
  page_id: ParameterValidator<number>;
  text: ParameterValidator<string>;
  url: ParameterValidator<string>;
  direction: ParameterValidator<'up' | 'down'>;
  duration: ParameterValidator<number>;
  filename: ParameterValidator<string>;
  reason: ParameterValidator<string>;
  summary: ParameterValidator<string>;
  selector: ParameterValidator<string>;
  new_tab: ParameterValidator<boolean>;
  is_critical: ParameterValidator<boolean>;
}

// Logging types for better type safety
export interface LogEntry {
  level: LogLevelValue;
  message: string;
  timestamp: Date;
  data?: unknown;
}

export interface SanitizedLogData {
  [key: string]: unknown;
}

// Generic function types
export type GenericFunction<T extends unknown[] = unknown[], R = unknown> = (...args: T) => R;

// Error handling types
export interface ErrorDetails {
  code?: string;
  stack?: string;
  context?: Record<string, unknown>;
  timestamp?: Date;
}

// Note: Updated interfaces are already defined above with proper types