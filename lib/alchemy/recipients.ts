/**
 * Recipient management for revenue wallet
 * Reads a list of authorized withdrawal addresses from environment
 */

import { isAddress, getAddress } from 'ethers';

export function getAuthorizedRecipients(): string[] {
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
