/**
 * Recipient management for revenue wallet
 * Reads a list of authorized withdrawal addresses from environment
 */

export function getAuthorizedRecipients(): string[] {
  const raw = process.env.REVENUE_RECIPIENTS || '';
  return raw
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

export function isAuthorizedRecipient(address: string): boolean {
  const list = getAuthorizedRecipients().map((a) => a.toLowerCase());
  return list.includes(address.toLowerCase());
}
