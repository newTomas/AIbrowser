export interface AgentConfig {
  maxIterations: number;
  maxHistoryLength: number;
  riskEvaluationEnabled: boolean;
  learningEnabled: boolean;
  memoryRetentionDays: number;
}

export interface AgentState {
  running: boolean;
  currentPageId: number | null;
  currentGoal?: string;
  iterations: number;
  lastAction?: string;
  lastError?: string;
}

export interface TaskResult {
  success: boolean;
  goal: string;
  iterations: number;
  duration: number;
  finalState?: any;
  error?: string;
}

export interface AgentMetrics {
  totalTasks: number;
  successfulTasks: number;
  averageIterations: number;
  averageDuration: number;
  mostUsedActions: Array<{ action: string; count: number }>;
  errorFrequency: Array<{ error: string; count: number }>;
}