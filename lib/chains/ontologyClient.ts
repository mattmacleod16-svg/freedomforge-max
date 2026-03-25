/**
 * Ontology Chain Client
 * Pure-fetch REST client for the Ontology blockchain.
 * Covers: balance queries, unbound ONG yield, ONT ID resolution, tx status.
 * No SDK dependency — uses the Ontology REST API directly.
 */

export type OntologyNetwork = 'mainnet' | 'testnet';

export interface OntologyBalance {
  address: string;
  ont: string;       // integer string (no decimals)
  ong: string;       // string, divide by 1e9 for display
  unboundOng: string; // accrued but unclaimed ONG
}

export interface OntIDDocument {
  id: string; // "did:ont:AX..."
  publicKey: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyHex: string;
  }>;
  authentication: string[];
  service: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
  attributes: Array<{
    key: string;
    type: string;
    value: string;
  }>;
  created: string;
  updated: string;
}

export interface OntologyTxStatus {
  txHash: string;
  state: 'success' | 'failed' | 'pending' | 'notfound';
  gasConsumed: string;
  blockHeight?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REST_ENDPOINTS: Record<OntologyNetwork, string> = {
  mainnet: 'https://dappnode1.ont.io:10334',
  testnet: 'https://polaris1.ont.io:10334',
};

const FETCH_TIMEOUT_MS = 15_000;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeController(): AbortController {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  // Attach timer so callers can clear it if needed; we clear on both success and error.
  (controller as AbortController & { _timer: ReturnType<typeof setTimeout> })._timer = timer;
  return controller;
}

async function restGet(
  network: OntologyNetwork,
  path: string,
): Promise<unknown> {
  const controller = makeController();
  const timer = (controller as AbortController & { _timer: ReturnType<typeof setTimeout> })._timer;
  try {
    const url = `${REST_ENDPOINTS[network]}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Balance ──────────────────────────────────────────────────────────────────

/**
 * Fetch ONT and ONG balances for an address.
 * unboundOng is returned as '0' — full resolution requires a signed pre-exec
 * transaction against the native ONG unbonding contract and is not supported
 * via a simple unauthenticated REST call.
 */
export async function getBalance(
  address: string,
  network: OntologyNetwork = 'mainnet',
): Promise<OntologyBalance | null> {
  try {
    const data = await restGet(network, `/api/v1/balance/${address}`);
    if (!data || typeof data !== 'object') return null;

    const result = (data as Record<string, unknown>)['Result'];
    if (!result || typeof result !== 'object') return null;

    const r = result as Record<string, unknown>;
    const ont = typeof r['ont'] === 'string' ? r['ont'] : String(r['ont'] ?? '0');
    const ong = typeof r['ong'] === 'string' ? r['ong'] : String(r['ong'] ?? '0');

    return {
      address,
      ont,
      ong,
      // Full unbound ONG resolution requires a signed pre-exec transaction
      // against native contract 0100000000000000000000000000000000000000.
      unboundOng: '0',
    };
  } catch {
    return null;
  }
}

// ─── ONT ID resolution ────────────────────────────────────────────────────────

/**
 * Resolve an ONT ID (DID) to its DDO (DID Document).
 *
 * Full on-chain DDO resolution requires a signed pre-exec transaction against
 * the native ONT ID contract. As a lighter alternative we attempt to query the
 * public ont-did.com resolver. Returns null when the resolver is unavailable or
 * the DID is not found.
 */
export async function resolveOntID(
  ontid: string,
  network: OntologyNetwork = 'mainnet',
): Promise<OntIDDocument | null> {
  if (!isValidOntID(ontid)) return null;

  // Testnet DIDs are unlikely to appear on the public resolver.
  if (network === 'testnet') return null;

  const controller = makeController();
  const timer = (controller as AbortController & { _timer: ReturnType<typeof setTimeout> })._timer;
  try {
    const url = `https://ont-did.com/api/v1/did/${encodeURIComponent(ontid)}`;
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;

    // Normalise the resolver response into OntIDDocument shape.
    const doc = (data['result'] ?? data) as Record<string, unknown>;

    return {
      id: typeof doc['id'] === 'string' ? doc['id'] : ontid,
      publicKey: Array.isArray(doc['publicKey'])
        ? (doc['publicKey'] as Array<Record<string, unknown>>).map((pk) => ({
            id: String(pk['id'] ?? ''),
            type: String(pk['type'] ?? ''),
            controller: String(pk['controller'] ?? ''),
            publicKeyHex: String(pk['publicKeyHex'] ?? ''),
          }))
        : [],
      authentication: Array.isArray(doc['authentication'])
        ? (doc['authentication'] as unknown[]).map(String)
        : [],
      service: Array.isArray(doc['service'])
        ? (doc['service'] as Array<Record<string, unknown>>).map((svc) => ({
            id: String(svc['id'] ?? ''),
            type: String(svc['type'] ?? ''),
            serviceEndpoint: String(svc['serviceEndpoint'] ?? ''),
          }))
        : [],
      attributes: Array.isArray(doc['attributes'])
        ? (doc['attributes'] as Array<Record<string, unknown>>).map((attr) => ({
            key: String(attr['key'] ?? ''),
            type: String(attr['type'] ?? ''),
            value: String(attr['value'] ?? ''),
          }))
        : [],
      created: typeof doc['created'] === 'string' ? doc['created'] : '',
      updated: typeof doc['updated'] === 'string' ? doc['updated'] : '',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Transaction status ───────────────────────────────────────────────────────

/**
 * Fetch the status of a submitted transaction by its hash.
 */
export async function getTxStatus(
  txHash: string,
  network: OntologyNetwork = 'mainnet',
): Promise<OntologyTxStatus> {
  const fallback: OntologyTxStatus = {
    txHash,
    state: 'notfound',
    gasConsumed: '0',
  };

  try {
    const data = await restGet(network, `/api/v1/transaction/${txHash}`);
    if (!data || typeof data !== 'object') return fallback;

    const d = data as Record<string, unknown>;
    const result = d['Result'] as Record<string, unknown> | undefined;
    if (!result) {
      // Ontology returns Error: 0 for not-found
      return fallback;
    }

    // Ontology tx states: 1 = success, 0 = failed; pending can't be queried by hash
    const stateCode = result['State'];
    let state: OntologyTxStatus['state'] = 'notfound';
    if (stateCode === 1) state = 'success';
    else if (stateCode === 0) state = 'failed';

    const gasConsumed =
      typeof result['GasConsumed'] === 'number'
        ? String(result['GasConsumed'])
        : typeof result['GasConsumed'] === 'string'
          ? result['GasConsumed']
          : '0';

    const blockHeight =
      typeof result['BlockHeight'] === 'number' ? result['BlockHeight'] : undefined;

    return { txHash, state, gasConsumed, blockHeight };
  } catch {
    return fallback;
  }
}

// ─── Network stats ────────────────────────────────────────────────────────────

/**
 * Fetch high-level network statistics (current block height, tx count, node count).
 * Block height is obtained from the latest block header; tx/node counts are
 * available on the Ontology explorer API but not the public node REST API —
 * those fields will be 0 when unavailable.
 */
export async function getOntologyStats(
  network: OntologyNetwork = 'mainnet',
): Promise<{ blockHeight: number; txCount: number; nodeCount: number } | null> {
  try {
    const data = await restGet(network, '/api/v1/block/height');
    if (!data || typeof data !== 'object') return null;

    const d = data as Record<string, unknown>;
    const result = d['Result'];
    const blockHeight = typeof result === 'number' ? result : 0;

    return {
      blockHeight,
      // tx count and node count require the Ontology explorer API, not the
      // public node REST endpoint.
      txCount: 0,
      nodeCount: 0,
    };
  } catch {
    return null;
  }
}

// ─── Formatters & validators ──────────────────────────────────────────────────

/**
 * Format raw ONG value (integer string scaled by 1e9) to a human-readable
 * decimal string with 6 decimal places.
 *
 * Example: '1500000000' → '1.500000'
 */
export function formatOng(rawOng: string): string {
  const raw = rawOng.trim();
  if (!raw || raw === '0') return '0.000000';

  // Use BigInt to avoid floating-point precision issues on large balances.
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return '0.000000';
  }

  const SCALE = BigInt(1_000_000_000);
  const whole = value / SCALE;
  const frac = value % SCALE;

  // Pad fractional part to 9 digits then truncate to 6.
  const fracStr = frac.toString().padStart(9, '0').slice(0, 6);
  return `${whole}.${fracStr}`;
}

/**
 * Format raw ONT value (integer string, no decimals) for display.
 * ONT has no decimal scaling — the value is returned as-is.
 */
export function formatOnt(rawOnt: string): string {
  return rawOnt.trim() || '0';
}

/**
 * Validate an Ontology address.
 * Base58Check addresses are 34 characters starting with 'A'.
 */
export function isValidOntAddress(address: string): boolean {
  return /^A[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

/**
 * Validate an Ontology DID (ONT ID).
 * Format: did:ont:<address>
 */
export function isValidOntID(did: string): boolean {
  return /^did:ont:A[1-9A-HJ-NP-Za-km-z]{33}$/.test(did);
}
