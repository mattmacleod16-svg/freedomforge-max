/**
 * Recipient management for revenue wallet
 * Reads a list of authorized withdrawal addresses from environment
 */

import { isAddress, getAddress } from 'ethers';

const DEFAULT_SINGLE_PAYOUT_RECIPIENT = '0x507d286480dDf20A18D2a218C84A81227A92F619';

export function getAuthorizedRecipients(): string[] {
  const enforceSingleRecipient = String(process.env.ENFORCE_SINGLE_PAYOUT_RECIPIENT || 'true').toLowerCase() !== 'false';
  const singleRecipientRaw = (process.env.SINGLE_PAYOUT_RECIPIENT || DEFAULT_SINGLE_PAYOUT_RECIPIENT).trim();

  if (enforceSingleRecipient) {
    if (!isAddress(singleRecipientRaw)) return [];
    return [getAddress(singleRecipientRaw)];
  }

  const raw = process.env.REVENUE_RECIPIENTS || '';
  const normalized = raw
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

  const unique = new Set<string>();
  for (const candidate of normalized) {
    if (!isAddress(candidate)) continue;
    unique.add(getAddress(candidate));
  }

  return Array.from(unique);
}

export function isAuthorizedRecipient(address: string): boolean {
  const list = getAuthorizedRecipients().map((a) => a.toLowerCase());
  return list.includes(address.toLowerCase());
}
