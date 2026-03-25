import { describe, it, expect } from 'vitest';
import {
  classifySubnetIntent,
  recommendSubnet,
  getBittensorContext,
  type SubnetIntent,
} from './subnetRouter';

// ─── classifySubnetIntent ─────────────────────────────────────────────────────

describe('classifySubnetIntent', () => {
  it('classifies trading queries as trading-signals', () => {
    expect(classifySubnetIntent('What is the current crypto price?')).toBe('trading-signals');
    expect(classifySubnetIntent('Show me stock market signals')).toBe('trading-signals');
    expect(classifySubnetIntent('Best DeFi yield right now')).toBe('trading-signals');
    expect(classifySubnetIntent('Give me a portfolio analysis for forex')).toBe('trading-signals');
  });

  it('classifies search queries as search-augmented', () => {
    expect(classifySubnetIntent('Find the latest news')).toBe('search-augmented');
    expect(classifySubnetIntent('What is the current status of XRP?')).toBe('search-augmented');
    expect(classifySubnetIntent('Who is Satoshi Nakamoto?')).toBe('search-augmented');
    expect(classifySubnetIntent('Recent developments in 2026')).toBe('search-augmented');
  });

  it('classifies creative queries as creative', () => {
    expect(classifySubnetIntent('Write me a story about AI')).toBe('creative');
    expect(classifySubnetIntent('Generate a poem about Bitcoin')).toBe('creative');
    expect(classifySubnetIntent('Create song lyrics for a freedom anthem')).toBe('creative');
  });

  it('classifies general queries as general', () => {
    expect(classifySubnetIntent('Hello')).toBe('general');
    expect(classifySubnetIntent('Tell me something interesting')).toBe('general');
    expect(classifySubnetIntent('')).toBe('general');
  });
});

// ─── recommendSubnet ──────────────────────────────────────────────────────────

describe('recommendSubnet', () => {
  const allIntents: SubnetIntent[] = [
    'trading-signals',
    'search-augmented',
    'creative',
    'data-retrieval',
    'text-generation',
    'general',
  ];

  it('returns a valid SubnetRecommendation with netuid > 0 for every intent', () => {
    for (const intent of allIntents) {
      const rec = recommendSubnet(intent);
      expect(rec.netuid).toBeGreaterThan(0);
      expect(rec.subnetName).toBeTruthy();
      expect(rec.corcelModel).toBeTruthy();
      expect(rec.intent).toBe(intent);
    }
  });

  it('all recommendations have confidence > 0.5', () => {
    for (const intent of allIntents) {
      const rec = recommendSubnet(intent);
      expect(rec.confidence).toBeGreaterThan(0.5);
    }
  });

  it('trading-signals routes to subnet 8', () => {
    expect(recommendSubnet('trading-signals').netuid).toBe(8);
  });

  it('search-augmented routes to subnet 5', () => {
    expect(recommendSubnet('search-augmented').netuid).toBe(5);
  });

  it('creative routes to subnet 3', () => {
    expect(recommendSubnet('creative').netuid).toBe(3);
  });

  it('data-retrieval routes to subnet 13', () => {
    expect(recommendSubnet('data-retrieval').netuid).toBe(13);
  });

  it('text-generation routes to subnet 1', () => {
    expect(recommendSubnet('text-generation').netuid).toBe(1);
  });

  it('general routes to subnet 18', () => {
    expect(recommendSubnet('general').netuid).toBe(18);
  });
});

// ─── getBittensorContext ──────────────────────────────────────────────────────

describe('getBittensorContext', () => {
  it('returns a non-empty string', () => {
    const ctx = getBittensorContext('What is the price of Bitcoin?');
    expect(ctx).toBeTruthy();
    expect(ctx.length).toBeGreaterThan(0);
  });

  it('contains the netuid number for a trading query', () => {
    const ctx = getBittensorContext('Show me stock market signals');
    expect(ctx).toContain('8');
  });

  it('contains the netuid number for a search query', () => {
    const ctx = getBittensorContext('Find the latest news today');
    expect(ctx).toContain('5');
  });

  it('contains the netuid number for a general query', () => {
    const ctx = getBittensorContext('Hello there');
    expect(ctx).toContain('18');
  });

  it('contains Bittensor branding', () => {
    const ctx = getBittensorContext('anything');
    expect(ctx).toContain('Bittensor');
  });

  it('mentions collective miner consensus', () => {
    const ctx = getBittensorContext('anything');
    expect(ctx).toContain('collective miner consensus');
  });
});
