import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isBackpackInstalled,
  detectBackpackSync,
  getBackpackChainId,
  connectBackpackSolana,
  getBackpackSolanaProvider,
} from './backpackDetector';

// ─── isBackpackInstalled ──────────────────────────────────────────────────────

describe('isBackpackInstalled', () => {
  it('returns false when window.backpack is undefined', () => {
    vi.stubGlobal('window', { backpack: undefined });
    expect(isBackpackInstalled()).toBe(false);
  });

  it('returns true when window.backpack.isBackpack = true', () => {
    vi.stubGlobal('window', {
      backpack: { isBackpack: true, publicKey: null },
    });
    expect(isBackpackInstalled()).toBe(true);
  });

  it('returns false when window.backpack.isBackpack is false', () => {
    vi.stubGlobal('window', {
      backpack: { isBackpack: false },
    });
    expect(isBackpackInstalled()).toBe(false);
  });

  it('returns false when window.backpack is null', () => {
    vi.stubGlobal('window', { backpack: null });
    expect(isBackpackInstalled()).toBe(false);
  });
});

// ─── detectBackpackSync ───────────────────────────────────────────────────────

describe('detectBackpackSync', () => {
  it('returns SSR-safe all-null result when window is undefined', () => {
    // Temporarily remove window from global scope
    const originalWindow = globalThis.window;
    // @ts-expect-error — intentionally deleting window to simulate SSR
    delete globalThis.window;

    const result = detectBackpackSync();

    expect(result.hasBackpack).toBe(false);
    expect(result.solana).toBeNull();
    expect(result.ethereum).toBeNull();
    expect(result.walletStandard).toBe(false);
    expect(result.allDetected).toHaveLength(0);

    // Restore window
    globalThis.window = originalWindow;
  });

  it('correctly identifies Solana provider from window.backpack', () => {
    const mockProvider = {
      isBackpack: true,
      publicKey: { toString: () => 'FakePublicKey1111' },
      connect: vi.fn(),
      disconnect: vi.fn(),
      signMessage: vi.fn(),
      signTransaction: vi.fn(),
      signAllTransactions: vi.fn(),
    };

    vi.stubGlobal('window', { backpack: mockProvider, ethereum: undefined });

    const result = detectBackpackSync();

    expect(result.hasBackpack).toBe(true);
    expect(result.solana).toBe(mockProvider);
    expect(result.ethereum).toBeNull();
    expect(result.walletStandard).toBe(true);
    expect(result.allDetected).toHaveLength(1);
    expect(result.allDetected[0].chain).toBe('solana');
    expect(result.allDetected[0].isBackpack).toBe(true);
  });

  it('correctly identifies Ethereum provider from window.ethereum with isBackpack flag', () => {
    const mockEthProvider = {
      isBackpack: true,
      request: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };

    vi.stubGlobal('window', { backpack: undefined, ethereum: mockEthProvider });

    const result = detectBackpackSync();

    expect(result.hasBackpack).toBe(true);
    expect(result.solana).toBeNull();
    expect(result.ethereum).toBe(mockEthProvider);
    expect(result.allDetected).toHaveLength(1);
    expect(result.allDetected[0].chain).toBe('ethereum');
  });

  it('returns hasBackpack=false when neither provider is present', () => {
    vi.stubGlobal('window', { backpack: undefined, ethereum: undefined });

    const result = detectBackpackSync();

    expect(result.hasBackpack).toBe(false);
    expect(result.solana).toBeNull();
    expect(result.ethereum).toBeNull();
    expect(result.allDetected).toHaveLength(0);
  });

  it('detects both Solana and Ethereum providers when both present', () => {
    const mockSolana = { isBackpack: true, publicKey: null, connect: vi.fn(), disconnect: vi.fn(), signMessage: vi.fn(), signTransaction: vi.fn(), signAllTransactions: vi.fn() };
    const mockEth = { isBackpack: true, request: vi.fn(), on: vi.fn(), removeListener: vi.fn() };

    vi.stubGlobal('window', { backpack: mockSolana, ethereum: mockEth });

    const result = detectBackpackSync();

    expect(result.hasBackpack).toBe(true);
    expect(result.solana).toBe(mockSolana);
    expect(result.ethereum).toBe(mockEth);
    expect(result.allDetected).toHaveLength(2);
  });
});

// ─── getBackpackChainId ───────────────────────────────────────────────────────

describe('getBackpackChainId', () => {
  it('returns the correct CAIP-2 Solana mainnet chain ID', () => {
    expect(getBackpackChainId()).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  });

  it('returns the same value regardless of window state', () => {
    vi.stubGlobal('window', undefined);
    expect(getBackpackChainId()).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  });
});

// ─── connectBackpackSolana ────────────────────────────────────────────────────

describe('connectBackpackSolana', () => {
  it('returns null when Backpack is not installed', async () => {
    vi.stubGlobal('window', { backpack: undefined });
    const result = await connectBackpackSolana();
    expect(result).toBeNull();
  });

  it('returns the publicKey string when mock connect() resolves', async () => {
    const mockPublicKey = 'BackpackPubKey9999AAABBB';
    const mockProvider = {
      isBackpack: true,
      publicKey: null,
      connect: vi.fn().mockResolvedValue({
        publicKey: { toString: () => mockPublicKey },
      }),
      disconnect: vi.fn(),
      signMessage: vi.fn(),
      signTransaction: vi.fn(),
      signAllTransactions: vi.fn(),
    };

    vi.stubGlobal('window', { backpack: mockProvider });

    const result = await connectBackpackSolana();
    expect(result).toBe(mockPublicKey);
    expect(mockProvider.connect).toHaveBeenCalledOnce();
  });

  it('returns null when connect() rejects', async () => {
    const mockProvider = {
      isBackpack: true,
      publicKey: null,
      connect: vi.fn().mockRejectedValue(new Error('User rejected')),
      disconnect: vi.fn(),
      signMessage: vi.fn(),
      signTransaction: vi.fn(),
      signAllTransactions: vi.fn(),
    };

    vi.stubGlobal('window', { backpack: mockProvider });

    const result = await connectBackpackSolana();
    expect(result).toBeNull();
  });
});

// ─── getBackpackSolanaProvider ────────────────────────────────────────────────

describe('getBackpackSolanaProvider', () => {
  it('returns null when window.backpack is undefined', () => {
    vi.stubGlobal('window', { backpack: undefined });
    expect(getBackpackSolanaProvider()).toBeNull();
  });

  it('returns the provider when window.backpack.isBackpack = true', () => {
    const mockProvider = {
      isBackpack: true,
      publicKey: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      signMessage: vi.fn(),
      signTransaction: vi.fn(),
      signAllTransactions: vi.fn(),
    };
    vi.stubGlobal('window', { backpack: mockProvider });
    expect(getBackpackSolanaProvider()).toBe(mockProvider);
  });
});
