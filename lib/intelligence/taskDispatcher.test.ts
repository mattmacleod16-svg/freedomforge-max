import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../models/modelOrchestrator', () => ({
  getMultiModelResponse: vi.fn(),
}));

vi.mock('../chains/xrplClient', () => ({
  getXRPAccountInfo: vi.fn(),
  getXRPBalance: vi.fn(),
  getXRPTxStatus: vi.fn(),
}));

vi.mock('../chains/starknetClient', () => ({
  getStarknetETHBalance: vi.fn(),
  getStarknetTxStatus: vi.fn(),
}));

vi.mock('../chains/injectiveClient', () => ({
  getInjectiveBalances: vi.fn(),
  getInjectiveDerivativeMarkets: vi.fn(),
  getInjectiveSpotMarkets: vi.fn(),
}));

vi.mock('../chains/polygonClient', () => ({
  getPolygonBalance: vi.fn(),
  getPolygonTxReceipt: vi.fn(),
}));

vi.mock('../chains/icpClient', () => ({
  getICPBalance: vi.fn(),
  getICPCanisterStatus: vi.fn(),
  getICPNetworkHealth: vi.fn(),
}));

vi.mock('../chains/ontologyClient', () => ({
  getBalance: vi.fn(),
  getTxStatus: vi.fn(),
}));

import { getMultiModelResponse } from '../models/modelOrchestrator';
import { getICPNetworkHealth } from '../chains/icpClient';
import { dispatchTask } from './taskDispatcher';

describe('taskDispatcher', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('routes code task to primary model lane when available', async () => {
    vi.mocked(getMultiModelResponse).mockResolvedValueOnce([
      {
        model: 'blackbox',
        response: 'Primary response',
        confidence: 0.91,
        timestamp: Date.now(),
      },
    ]);

    const result = await dispatchTask({
      type: 'code',
      prompt: 'Write a robust parser',
    });

    expect(result.ok).toBe(true);
    expect(result.data).toBe('Primary response');
    expect(result.trace.selectedModel).toBe('blackbox');
    expect(result.trace.fallbackUsed).toBe(false);
  });

  it('falls back to decentralized lane when primary model call returns empty', async () => {
    vi.mocked(getMultiModelResponse)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          model: 'corcel',
          response: 'Fallback response',
          confidence: 0.77,
          timestamp: Date.now(),
        },
      ]);

    const result = await dispatchTask({
      type: 'search',
      prompt: 'Summarize macro signals',
    });

    expect(result.ok).toBe(true);
    expect(result.data).toBe('Fallback response');
    expect(result.trace.selectedModel).toBe('corcel');
    expect(result.trace.fallbackUsed).toBe(true);
    expect(result.trace.reason).toBe('primary-failed-fallback-used');
  });

  it('runs chain adapters directly without model calls', async () => {
    vi.mocked(getICPNetworkHealth).mockResolvedValueOnce({
      healthy: true,
      totalNodes: 10,
      totalSubnets: 2,
      latestBlock: 123,
    });

    const result = await dispatchTask({
      type: 'chain-icp',
      payload: { action: 'network-health' },
    });

    expect(result.ok).toBe(true);
    expect(result.trace.selectedAdapter).toBe('icp');
    expect(result.trace.selectedModel).toBeNull();
    expect(getMultiModelResponse).not.toHaveBeenCalled();
  });
});
