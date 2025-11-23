// ReAct Agent Types
export interface Thought {
  reasoning: string;
  next_action?: string;
  confidence?: number;
}

export interface Action {
  tool: string;
  parameters: Record<string, any>;
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
  text: string;
  selector?: string;
  tab_index?: number;
  onclick?: string;
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
  target_element?: TaggerElement;
}

// Configuration Types
export interface LogLevel {
  OFF: 0;
  INFO: 1;
  DEBUG: 2;
}

export type LogLevelValue = keyof LogLevel;

export interface AppConfig {
  anthropicApiKey: string;
  userDataDir: string;
  logLevel: LogLevelValue;
  enableRiskEvaluation: boolean;
  headless: boolean;
  browserTimeout: number;
}

// Error Types
export interface AgentError {
  type: 'PLAYWRIGHT' | 'SECURITY' | 'API' | 'VALIDATION';
  message: string;
  details?: any;
  recoverable: boolean;
}

// CLI Types
export interface CLIChoice {
  name: string;
  value: any;
  description?: string;
}

export interface AssistanceRequest {
  reason: string;
  is_critical: boolean;
  context?: string;
}