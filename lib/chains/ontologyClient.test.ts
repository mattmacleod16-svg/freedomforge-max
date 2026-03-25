import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isValidOntAddress,
  isValidOntID,
  formatOng,
  formatOnt,
  getBalance,
} from './ontologyClient';

// ─── isValidOntAddress ────────────────────────────────────────────────────────

describe('isValidOntAddress', () => {
  it('accepts a valid 34-char address starting with A', () => {
    expect(isValidOntAddress('AXk2RXzDz1UrqZFkCMYLVuJAQNqZBhSm2K')).toBe(true);
  });

  it('accepts another valid address', () => {
    expect(isValidOntAddress('ANH5bHrrt111XwNEnuPZj6u95Dd6u7G4D6')).toBe(true);
  });

  it('rejects an address that is too short', () => {
    expect(isValidOntAddress('AXk2RXzDz1UrqZFkCMYLVuJAQNq')).toBe(false);
  });

  it('rejects an address that does not start with A', () => {
    expect(isValidOntAddress('BXk2RXzDz1UrqZFkCMYLVuJAQNqZBhSm2K')).toBe(false);
  });

  it('rejects an address with invalid Base58 characters (0, O, I, l)', () => {
    // Contains '0' which is not in Base58 alphabet
    expect(isValidOntAddress('AXk2RXzDz1UrqZFkCMYLVuJAQN0ZBhSm2K')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidOntAddress('')).toBe(false);
  });
});

// ─── isValidOntID ─────────────────────────────────────────────────────────────

describe('isValidOntID', () => {
  it('accepts a valid did:ont: DID', () => {
    expect(isValidOntID('did:ont:AXk2RXzDz1UrqZFkCMYLVuJAQNqZBhSm2K')).toBe(true);
  });

  it('rejects a DID with the wrong method', () => {
    expect(isValidOntID('did:ethr:AXk2RXzDz1UrqZFkCMYLVuJAQNqZBhSm2K')).toBe(false);
  });

  it('rejects a DID with a missing prefix', () => {
    expect(isValidOntID('AXk2RXzDz1UrqZFkCMYLVuJAQNqZBhSm2K')).toBe(false);
  });

  it('rejects a DID whose address portion is invalid', () => {
    // Address starts with B, not A
    expect(isValidOntID('did:ont:BXk2RXzDz1UrqZFkCMYLVuJAQNqZBhSm2K')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidOntID('')).toBe(false);
  });
});

// ─── formatOng ────────────────────────────────────────────────────────────────

describe('formatOng', () => {
  it('formats 1 ONG (1e9 raw) correctly', () => {
    expect(formatOng('1000000000')).toBe('1.000000');
  });

  it('formats 1.5 ONG', () => {
    expect(formatOng('1500000000')).toBe('1.500000');
  });

  it('formats a fractional amount below 1 ONG', () => {
    expect(formatOng('500000')).toBe('0.000500');
  });

  it('formats zero', () => {
    expect(formatOng('0')).toBe('0.000000');
  });

  it('formats an empty string as zero', () => {
    expect(formatOng('')).toBe('0.000000');
  });

  it('handles large balances without floating-point precision loss', () => {
    // 1 million ONG
    expect(formatOng('1000000000000000')).toBe('1000000.000000');
  });
});

// ─── formatOnt ────────────────────────────────────────────────────────────────

describe('formatOnt', () => {
  it('returns the integer string unchanged', () => {
    expect(formatOnt('1000')).toBe('1000');
  });

  it('returns 0 for an empty string', () => {
    expect(formatOnt('')).toBe('0');
  });

  it('trims whitespace', () => {
    expect(formatOnt('  42  ')).toBe('42');
  });
});

// ─── getBalance ───────────────────────────────────────────────────────────────

describe('getBalance', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses a mocked REST response correctly', async () => {
    const mockResponse = {
      Action: 'getbalance',
      Desc: 'SUCCESS',
      Error: 0,
      Result: {
        ont: '100',
        ong: '2500000000',
      },
      Version: '1.0.0',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      }),
    );

    const balance = await getBalance('AXk2RXzDz1UrqZFkCMYLVuJAQNqZBhSm2K', 'mainnet');

    expect(balance).not.toBeNull();
    expect(balance?.address).toBe('AXk2RXzDz1UrqZFkCMYLVuJAQNqZBhSm2K');
    expect(balance?.ont).toBe('100');
    expect(balance?.ong).toBe('2500000000');
    expect(balance?.unboundOng).toBe('0');
  });

  it('returns null on a non-ok HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      }),
    );

    const balance = await getBalance('AXk2RXzDz1UrqZFkCMYLVuJAQNqZBhSm2K', 'mainnet');
    expect(balance).toBeNull();
  });

  it('returns null on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new Error('Network unreachable')),
    );

    const balance = await getBalance('AXk2RXzDz1UrqZFkCMYLVuJAQNqZBhSm2K', 'mainnet');
    expect(balance).toBeNull();
  });

  it('returns null when the Result field is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Action: 'getbalance', Error: 0 }),
      }),
    );

    const balance = await getBalance('AXk2RXzDz1UrqZFkCMYLVuJAQNqZBhSm2K', 'mainnet');
    expect(balance).toBeNull();
  });
});
