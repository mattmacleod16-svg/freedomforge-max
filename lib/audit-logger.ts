export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';
export type AuditResult = 'success' | 'failure' | 'partial';

export interface AuditRecord {
  ts: string;
  endpoint: string;
  method: string;
  ip?: string;
  ipHash: string;
  user: string;
  result: AuditResult;
  severity: AuditSeverity;
  detail?: Record<string, unknown>;
}

export const SEVERITY_MAP: Record<string, AuditSeverity> = {
  '/api/forge-price': 'info',
  '/ar-holo': 'info',
};

export async function logAuditEvent(event: Omit<AuditRecord, 'ts' | 'ipHash'> & { ip?: string }) {
  const record: AuditRecord = {
    ts: new Date().toISOString(),
    endpoint: event.endpoint,
    method: event.method,
    ip: event.ip || 'unknown',
    ipHash: event.ip ? btoa(event.ip) : 'anonymous',
    user: event.user || 'anonymous',
    result: event.result,
    severity: event.severity ?? SEVERITY_MAP[event.endpoint] ?? 'info',
    detail: event.detail,
  };

  // In production this would send to a logging service
  console.log('[AUDIT]', record);
}
