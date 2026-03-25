/**
 * Task Dispatcher
 * Compartmentalized and dispersed task routing across specialized model lanes
 * and chain adapters. Keeps routing deterministic and observable.
 */

import { getMultiModelResponse } from '../models/modelOrchestrator';
import { getXRPAccountInfo, getXRPBalance, getXRPTxStatus } from '../chains/xrplClient';
import { getStarknetETHBalance, getStarknetTxStatus } from '../chains/starknetClient';
import { getInjectiveBalances, getInjectiveDerivativeMarkets, getInjectiveSpotMarkets } from '../chains/injectiveClient';
import { getPolygonBalance, getPolygonTxReceipt } from '../chains/polygonClient';
import { getICPBalance, getICPCanisterStatus, getICPNetworkHealth } from '../chains/icpClient';
import { getBalance as getOntologyBalance, getTxStatus as getOntologyTxStatus } from '../chains/ontologyClient';

export type TaskType =
  | 'code'
  | 'search'
  | 'risk-analysis'
  | 'trading-signal'
  | 'market-analysis'
  | 'chain-xrpl'
  | 'chain-starknet'
  | 'chain-injective'
  | 'chain-polygon'
  | 'chain-icp'
  | 'chain-ontology';

export interface TaskDispatchInput {
  type: TaskType;
  prompt?: string;
  payload?: Record<string, unknown>;
  preferredModels?: string[];
}

export interface DispatchTrace {
  compartment: TaskType;
  selectedModel: string | null;
  modelCandidates: string[];
  selectedAdapter: string;
  fallbackUsed: boolean;
  reason: string;
}

export interface TaskDispatchResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  trace: DispatchTrace;
}

interface ModelLane {
  primary: string[];
  fallback: string[];
}

const MODEL_LANES: Record<TaskType, ModelLane> = {
  code: {
    primary: ['blackbox', 'openai', 'anthropic'],
    fallback: ['akash', 'corcel', 'ionet', 'zerog'],
  },
  search: {
    primary: ['perplexity', 'openrouter', 'openai'],
    fallback: ['corcel', 'akash', 'ionet'],
  },
  'risk-analysis': {
    primary: ['anthropic', 'openai', 'grok'],
    fallback: ['corcel', 'akash', 'ionet', 'zerog'],
  },
  'trading-signal': {
    primary: ['corcel', 'grok', 'openai'],
    fallback: ['akash', 'ionet', 'zerog'],
  },
  'market-analysis': {
    primary: ['grok', 'perplexity', 'openai'],
    fallback: ['corcel', 'akash', 'ionet'],
  },
  'chain-xrpl': {
    primary: ['grok', 'openai'],
    fallback: ['corcel', 'ionet'],
  },
  'chain-starknet': {
    primary: ['grok', 'openai'],
    fallback: ['corcel', 'ionet'],
  },
  'chain-injective': {
    primary: ['grok', 'openai'],
    fallback: ['corcel', 'akash', 'ionet'],
  },
  'chain-polygon': {
    primary: ['grok', 'openai'],
    fallback: ['corcel', 'ionet'],
  },
  'chain-icp': {
    primary: ['openai', 'anthropic'],
    fallback: ['corcel', 'akash', 'ionet'],
  },
  'chain-ontology': {
    primary: ['openai', 'grok'],
    fallback: ['corcel', 'akash'],
  },
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readPayload(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  return asString(payload?.[key]);
}

async function runModelLane(
  prompt: string,
  lane: ModelLane,
  preferredModels: string[] = [],
): Promise<{ text: string | null; model: string | null; usedFallback: boolean; candidates: string[] }> {
  const primaryCandidates = [...preferredModels, ...lane.primary];
  const primary = await getMultiModelResponse(prompt, 1, { preferredModels: primaryCandidates });
  if (primary.length > 0) {
    return {
      text: primary[0].response,
      model: primary[0].model,
      usedFallback: false,
      candidates: primaryCandidates,
    };
  }

  const fallbackCandidates = lane.fallback;
  const fallback = await getMultiModelResponse(prompt, 1, { preferredModels: fallbackCandidates });
  return {
    text: fallback[0]?.response ?? null,
    model: fallback[0]?.model ?? null,
    usedFallback: true,
    candidates: [...primaryCandidates, ...fallbackCandidates],
  };
}

async function dispatchChainTask(type: TaskType, payload: Record<string, unknown> = {}): Promise<unknown> {
  switch (type) {
    case 'chain-xrpl': {
      const action = readPayload(payload, 'action') ?? 'balance';
      const address = readPayload(payload, 'address');
      const txHash = readPayload(payload, 'txHash');
      if (action === 'account' && address) return getXRPAccountInfo(address);
      if (action === 'tx-status' && txHash) return getXRPTxStatus(txHash);
      if (address) return getXRPBalance(address);
      return null;
    }
    case 'chain-starknet': {
      const action = readPayload(payload, 'action') ?? 'balance';
      const address = readPayload(payload, 'address');
      const txHash = readPayload(payload, 'txHash');
      if (action === 'tx-status' && txHash) return getStarknetTxStatus(txHash);
      if (address) return getStarknetETHBalance(address);
      return null;
    }
    case 'chain-injective': {
      const action = readPayload(payload, 'action') ?? 'spot-markets';
      const address = readPayload(payload, 'address');
      if (action === 'balances' && address) return getInjectiveBalances(address);
      if (action === 'derivatives') return getInjectiveDerivativeMarkets();
      return getInjectiveSpotMarkets();
    }
    case 'chain-polygon': {
      const action = readPayload(payload, 'action') ?? 'balance';
      const address = readPayload(payload, 'address');
      const txHash = readPayload(payload, 'txHash');
      if (action === 'tx-receipt' && txHash) return getPolygonTxReceipt(txHash);
      if (address) return getPolygonBalance(address);
      return null;
    }
    case 'chain-icp': {
      const action = readPayload(payload, 'action') ?? 'network-health';
      const principal = readPayload(payload, 'principal');
      const canisterId = readPayload(payload, 'canisterId');
      if (action === 'balance' && principal) return getICPBalance(principal);
      if (action === 'canister-status' && canisterId) return getICPCanisterStatus(canisterId);
      return getICPNetworkHealth();
    }
    case 'chain-ontology': {
      const action = readPayload(payload, 'action') ?? 'balance';
      const address = readPayload(payload, 'address');
      const txHash = readPayload(payload, 'txHash');
      if (action === 'tx-status' && txHash) return getOntologyTxStatus(txHash);
      if (address) return getOntologyBalance(address);
      return null;
    }
    default:
      return null;
  }
}

export async function dispatchTask(input: TaskDispatchInput): Promise<TaskDispatchResult> {
  const lane = MODEL_LANES[input.type];
  const prompt = input.prompt?.trim();

  try {
    // Chain tasks prioritize deterministic adapter execution first.
    if (input.type.startsWith('chain-')) {
      const data = await dispatchChainTask(input.type, input.payload);
      return {
        ok: data !== null,
        data,
        error: data === null ? 'Missing chain payload fields for selected action' : undefined,
        trace: {
          compartment: input.type,
          selectedModel: null,
          modelCandidates: [],
          selectedAdapter: input.type.replace('chain-', ''),
          fallbackUsed: false,
          reason: 'direct-chain-adapter',
        },
      };
    }

    if (!prompt) {
      return {
        ok: false,
        error: 'Prompt is required for non-chain tasks',
        trace: {
          compartment: input.type,
          selectedModel: null,
          modelCandidates: lane ? [...lane.primary, ...lane.fallback] : [],
          selectedAdapter: 'model-lane',
          fallbackUsed: false,
          reason: 'missing-prompt',
        },
      };
    }

    const laneResult = await runModelLane(prompt, lane, input.preferredModels || []);
    return {
      ok: laneResult.text !== null,
      data: laneResult.text,
      error: laneResult.text === null ? 'No model response received' : undefined,
      trace: {
        compartment: input.type,
        selectedModel: laneResult.model,
        modelCandidates: laneResult.candidates,
        selectedAdapter: 'model-lane',
        fallbackUsed: laneResult.usedFallback,
        reason: laneResult.usedFallback ? 'primary-failed-fallback-used' : 'primary-succeeded',
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown dispatch error',
      trace: {
        compartment: input.type,
        selectedModel: null,
        modelCandidates: lane ? [...lane.primary, ...lane.fallback] : [],
        selectedAdapter: input.type.startsWith('chain-') ? input.type.replace('chain-', '') : 'model-lane',
        fallbackUsed: false,
        reason: 'exception',
      },
    };
  }
}

export function getTaskRouter() {
  return MODEL_LANES;
}
