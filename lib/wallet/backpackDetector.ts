/**
 * Backpack Wallet Detector
 * Zero-dependency detection of the Backpack wallet browser extension.
 * Supports: Solana (window.backpack), Ethereum (EIP-6963), Wallet Standard protocol.
 * Safe to import in SSR — all window access is guarded.
 */

export type WalletChain = 'solana' | 'ethereum' | 'unknown';

export interface DetectedWallet {
  name: string;
  rdns?: string;           // EIP-6963 reverse domain name
  chain: WalletChain;
  isBackpack: boolean;
  provider: unknown;       // raw provider object — typed at call site
}

export interface BackpackSolanaProvider {
  isBackpack: boolean;
  publicKey: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array }>;
  signTransaction(transaction: unknown): Promise<unknown>;
  signAllTransactions(transactions: unknown[]): Promise<unknown[]>;
}

export interface BackpackEthereumProvider {
  isBackpack?: boolean;
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
}

export interface WalletDetectionResult {
  hasBackpack: boolean;
  solana: BackpackSolanaProvider | null;
  ethereum: BackpackEthereumProvider | null;
  walletStandard: boolean;   // true if Wallet Standard protocol detected
  allDetected: DetectedWallet[];
}

// ─── Sync Detection ───────────────────────────────────────────────────────────

/**
 * Synchronous snapshot of Backpack wallet presence.
 * Safe for SSR — returns all-null result when window is unavailable.
 */
export function detectBackpackSync(): WalletDetectionResult {
  if (typeof window === 'undefined') {
    return {
      hasBackpack: false,
      solana: null,
      ethereum: null,
      walletStandard: false,
      allDetected: [],
    };
  }

  const win = window as unknown as Record<string, unknown>;
  const allDetected: DetectedWallet[] = [];

  // ── Solana provider via window.backpack ──────────────────────────────────
  let solanaProvider: BackpackSolanaProvider | null = null;
  const rawBackpack = win['backpack'];
  if (
    rawBackpack !== null &&
    rawBackpack !== undefined &&
    typeof rawBackpack === 'object' &&
    (rawBackpack as Record<string, unknown>)['isBackpack'] === true
  ) {
    solanaProvider = rawBackpack as BackpackSolanaProvider;
    allDetected.push({
      name: 'Backpack',
      chain: 'solana',
      isBackpack: true,
      provider: rawBackpack,
    });
  }

  // ── Legacy Ethereum provider via window.ethereum ─────────────────────────
  let ethereumProvider: BackpackEthereumProvider | null = null;
  const rawEthereum = win['ethereum'];
  if (
    rawEthereum !== null &&
    rawEthereum !== undefined &&
    typeof rawEthereum === 'object' &&
    (rawEthereum as Record<string, unknown>)['isBackpack'] === true
  ) {
    ethereumProvider = rawEthereum as BackpackEthereumProvider;
    allDetected.push({
      name: 'Backpack',
      chain: 'ethereum',
      isBackpack: true,
      provider: rawEthereum,
    });
  }

  // ── Wallet Standard detection (passive — check registered wallets) ────────
  // Wallet Standard registers wallets synchronously at page load via
  // wallet-standard:register-wallet events. We can check if any registered
  // wallet identifies as Backpack by inspecting window's wallet registry if
  // exposed, but the protocol itself is event-driven and best detected async.
  // Here we note that if window.backpack exists, Wallet Standard is likely
  // active since Backpack implements both simultaneously.
  const walletStandard = solanaProvider !== null;

  return {
    hasBackpack: solanaProvider !== null || ethereumProvider !== null,
    solana: solanaProvider,
    ethereum: ethereumProvider,
    walletStandard,
    allDetected,
  };
}

// ─── Async Detection (EIP-6963) ───────────────────────────────────────────────

/**
 * Async detection that fires eip6963:requestProvider and waits for
 * eip6963:announceProvider events with rdns === 'app.backpack'.
 * Falls back to sync result on timeout or in SSR environments.
 */
export async function detectBackpackAsync(timeoutMs = 1000): Promise<WalletDetectionResult> {
  const syncResult = detectBackpackSync();

  if (typeof window === 'undefined') {
    return syncResult;
  }

  return new Promise<WalletDetectionResult>((resolve) => {
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const result: WalletDetectionResult = {
      ...syncResult,
      allDetected: [...syncResult.allDetected],
    };

    const announceHandler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        info: { rdns: string; name: string; uuid: string };
        provider: BackpackEthereumProvider;
      }>;

      const { info, provider } = customEvent.detail ?? {};
      if (!info || !provider) return;

      if (info.rdns === 'app.backpack') {
        // Merge EIP-6963 Ethereum provider into result
        result.hasBackpack = true;
        result.ethereum = provider;

        const alreadyListed = result.allDetected.some(
          (w) => w.chain === 'ethereum' && w.isBackpack,
        );
        if (!alreadyListed) {
          result.allDetected.push({
            name: info.name ?? 'Backpack',
            rdns: info.rdns,
            chain: 'ethereum',
            isBackpack: true,
            provider,
          });
        }

        // Resolve immediately once we find Backpack via EIP-6963
        cleanup();
        resolve(result);
      }
    };

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener('eip6963:announceProvider', announceHandler);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    window.addEventListener('eip6963:announceProvider', announceHandler);

    // Request providers — this triggers any installed wallets to announce
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    // Timeout: resolve with whatever we have so far
    timeoutId = setTimeout(() => {
      cleanup();
      resolve(result);
    }, timeoutMs);
  });
}

// ─── Convenience Helpers ──────────────────────────────────────────────────────

/**
 * Returns true if the Backpack browser extension is installed and its Solana
 * provider is available on window.backpack.
 */
export function isBackpackInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as Record<string, unknown>;
  const bp = win['backpack'];
  return (
    bp !== null &&
    bp !== undefined &&
    typeof bp === 'object' &&
    (bp as Record<string, unknown>)['isBackpack'] === true
  );
}

/**
 * Returns the raw Backpack Solana provider from window.backpack, or null.
 */
export function getBackpackSolanaProvider(): BackpackSolanaProvider | null {
  if (!isBackpackInstalled()) return null;
  const win = window as unknown as Record<string, unknown>;
  return (win['backpack'] as BackpackSolanaProvider) ?? null;
}

/**
 * Returns the CAIP-2 chain identifier for Solana mainnet-beta.
 * This is a constant — no window access needed.
 */
export function getBackpackChainId(): string {
  return 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
}

/**
 * Connects to Backpack and returns the public key as a base58 string.
 * Returns null if Backpack is not installed or the connection is rejected.
 */
export async function connectBackpackSolana(): Promise<string | null> {
  const provider = getBackpackSolanaProvider();
  if (!provider) return null;

  try {
    const response = await provider.connect();
    return response.publicKey.toString();
  } catch {
    return null;
  }
}

/**
 * Signs a UTF-8 message with Backpack and returns a base64-encoded signature.
 * Returns null if Backpack is not installed or signing fails.
 */
export async function signMessageWithBackpack(message: string): Promise<string | null> {
  const provider = getBackpackSolanaProvider();
  if (!provider) return null;

  try {
    const bytes = new TextEncoder().encode(message);
    const { signature } = await provider.signMessage(bytes, 'utf8');
    // Encode raw Uint8Array signature as base64
    return btoa(String.fromCharCode(...signature));
  } catch {
    return null;
  }
}
