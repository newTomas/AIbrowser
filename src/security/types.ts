export interface SecurityEvent {
  timestamp: Date;
  type: 'RISK_ASSESSMENT' | 'ACTION_BLOCKED' | 'USER_CONFIRMATION' | 'SECURITY_ERROR';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  action: string;
  context: string;
  details?: any;
}

export interface SecurityPolicy {
  allowExternalNavigation: boolean;
  allowFormSubmission: boolean;
  allowFileDownloads: boolean;
  allowAccountChanges: boolean;
  requireConfirmationForHighRisk: boolean;
  blockedDomains: string[];
  allowedDomains: string[];
}

export interface SecurityAuditLog {
  events: SecurityEvent[];
  totalActions: number;
  blockedActions: number;
  highRiskActions: number;
  userConfirmations: number;
}

export interface SecurityViolation {
  type: 'MALICIOUS_URL' | 'SENSITIVE_DATA' | 'DESTRUCTIVE_ACTION' | 'UNAUTHORIZED_ACCESS';
  severity: 'HIGH' | 'CRITICAL';
  description: string;
  recommendedAction: string;
}