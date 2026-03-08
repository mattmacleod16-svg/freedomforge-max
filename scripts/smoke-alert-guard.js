#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const filePath = path.resolve(process.cwd(), 'lib/alchemy/connector.ts');

if (!fs.existsSync(filePath)) {
  console.error(`smoke-alert-guard: missing file ${filePath}`);
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');

const forbiddenPatterns = [
  /sendAlert\(`Token payout sent to \$\{addr\}:/,
  /sendAlert\(`Revenue payout sent to \$\{addr\}:/,
  /const\s+alertOnSuccess\s*=\s*String\(process\.env\.ALERT_ON_SUCCESS/,
];

const violations = forbiddenPatterns
  .map((pattern) => ({ pattern: pattern.toString(), hit: pattern.test(content) }))
  .filter((row) => row.hit);

if (violations.length > 0) {
  console.error('smoke-alert-guard: FAILED (distribution success-alert logic detected)');
  for (const violation of violations) {
    console.error(` - matched ${violation.pattern}`);
  }
  process.exit(1);
}

console.log('smoke-alert-guard: OK (distribution notifications are failure-only)');