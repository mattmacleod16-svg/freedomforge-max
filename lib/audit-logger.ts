// Quick patch to fix missing 'ip' property
// (add this line or make ip optional in the type definition)
const record: AuditRecord = {
  ts: new Date().toISOString(),
  endpoint: event.endpoint,
  method: event.method,
  ip: event.ip || 'unknown',          // ← added this line
  ipHash: event.ipHash,
  user: event.user,
  result: event.result,
  severity: event.severity ?? SEVERITY_MAP[event.endpoint] ?? 'info',
  detail: event.detail,
};
