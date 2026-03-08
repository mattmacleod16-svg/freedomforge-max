#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const filePath = path.resolve(process.cwd(), 'lib/alchemy/recipients.ts');
const requiredWallet = '0x507d286480dDf20A18D2a218C84A81227A92F619';

if (!fs.existsSync(filePath)) {
  console.error(`smoke-recipient-guard: missing file ${filePath}`);
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');

const requiredPatterns = [
  /DEFAULT_SINGLE_PAYOUT_RECIPIENT\s*=\s*'0x507d286480dDf20A18D2a218C84A81227A92F619'/,
  /ENFORCE_SINGLE_PAYOUT_RECIPIENT/,
  /if \(enforceSingleRecipient\)\s*\{[\s\S]*?return \[getAddress\(singleRecipientRaw\)\];/,
];

const missing = requiredPatterns.filter((pattern) => !pattern.test(content));
if (missing.length > 0) {
  console.error('smoke-recipient-guard: FAILED (single-recipient enforcement missing)');
  for (const pattern of missing) {
    console.error(` - missing pattern ${pattern}`);
  }
  process.exit(1);
}

console.log(`smoke-recipient-guard: OK (single payout recipient enforced: ${requiredWallet})`);