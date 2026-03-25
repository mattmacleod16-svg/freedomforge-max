/**
 * AzuroClient — Unit Tests
 * ════════════════════════
 *
 * Vitest tests for the Azuro Protocol GraphQL client.
 * All network calls are intercepted with vi.stubGlobal('fetch', ...).
 *
 * Run: npx vitest run lib/markets/azuroClient.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AzuroChain,
  AZURO_SUBGRAPH_URLS,
  getUpcomingGames,
  getMarketOdds,
  getAzuroSignal,
} from './azuroClient';

// ── Shared mock builders ─────────────────────────────────────────────────────

function makeGame(overrides: Partial<{
  id: string;
  sportName: string;
  leagueName: string;
  countryName: string;
  startsAt: number;
  homeName: string;
  awayName: string;
}> = {}) {
  return {
    id: overrides.id ?? 'game-1',
    sport: { name: overrides.sportName ?? 'Basketball' },
    league: { name: overrides.leagueName ?? 'NBA' },
    country: { name: overrides.countryName ?? 'USA' },
    startsAt: overrides.startsAt ?? 1_700_000_000,
    homeTeam: { name: overrides.homeName ?? 'Lakers' },
    awayTeam: { name: overrides.awayName ?? 'Celtics' },
  };
}

function makeCondition(overrides: Partial<{
  id: string;
  marketName: string;
}> = {}) {
  return {
    id: overrides.id ?? 'cond-1',
    marketName: overrides.marketName ?? 'Match Winner',
    outcomes: [
      { id: 'out-1', title: 'Lakers', currentOdds: '1.95' },
      { id: 'out-2', title: 'Celtics', currentOdds: '1.87' },
    ],
  };
}

function stubFetch(responses: Record<string, unknown>[], sequential = true) {
  let callIndex = 0;
  const mockFn = vi.fn().mockImplementation(() => {
    const body = sequential ? responses[callIndex++ % responses.length] : responses[0];
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
  });
  vi.stubGlobal('fetch', mockFn);
  return mockFn;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AzuroClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── AZURO_SUBGRAPH_URLS ───────────────────────────────────────────────────

  describe('AZURO_SUBGRAPH_URLS', () => {
    it('has entries for all four supported chains', () => {
      expect(AZURO_SUBGRAPH_URLS[AzuroChain.POLYGON]).toContain('polygon');
      expect(AZURO_SUBGRAPH_URLS[AzuroChain.GNOSIS]).toContain('gnosis');
      expect(AZURO_SUBGRAPH_URLS[AzuroChain.CHILIZ]).toContain('chiliz');
      expect(AZURO_SUBGRAPH_URLS[AzuroChain.ARBITRUM]).toContain('arbitrum');
    });
  });

  // ── getUpcomingGames ──────────────────────────────────────────────────────

  describe('getUpcomingGames', () => {
    beforeEach(() => {
      stubFetch([{ data: { games: [makeGame()] } }]);
    });

    it('returns a parsed list of AzuroGame objects', async () => {
      const games = await getUpcomingGames(AzuroChain.POLYGON);
      expect(games).toHaveLength(1);
      expect(games[0].id).toBe('game-1');
      expect(games[0].sport).toBe('Basketball');
      expect(games[0].league).toBe('NBA');
      expect(games[0].homeTeam).toBe('Lakers');
      expect(games[0].awayTeam).toBe('Celtics');
      expect(games[0].status).toBe('Created');
    });

    it('sends a POST request to the correct subgraph URL', async () => {
      await getUpcomingGames(AzuroChain.GNOSIS, 'Soccer', 5);
      const mockFetch = vi.mocked(global.fetch);
      expect(mockFetch).toHaveBeenCalledWith(
        AZURO_SUBGRAPH_URLS[AzuroChain.GNOSIS],
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('returns an empty array when the subgraph returns no games', async () => {
      vi.unstubAllGlobals();
      stubFetch([{ data: { games: [] } }]);
      const games = await getUpcomingGames(AzuroChain.POLYGON);
      expect(games).toEqual([]);
    });

    it('throws when the subgraph returns an HTTP error', async () => {
      vi.unstubAllGlobals();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
      await expect(getUpcomingGames(AzuroChain.POLYGON)).rejects.toThrow('HTTP 429');
    });
  });

  // ── getMarketOdds ─────────────────────────────────────────────────────────

  describe('getMarketOdds', () => {
    it('returns parsed AzuroMarket objects with outcomes', async () => {
      stubFetch([{ data: { conditions: [makeCondition()] } }]);

      const markets = await getMarketOdds(AzuroChain.POLYGON, 'game-1');
      expect(markets).toHaveLength(1);
      expect(markets[0].conditionId).toBe('cond-1');
      expect(markets[0].marketName).toBe('Match Winner');
      expect(markets[0].outcomes).toHaveLength(2);
      expect(markets[0].outcomes[0].title).toBe('Lakers');
      expect(markets[0].outcomes[0].currentOdds).toBe('1.95');
    });

    it('returns empty array when no conditions exist', async () => {
      stubFetch([{ data: { conditions: [] } }]);
      const markets = await getMarketOdds(AzuroChain.POLYGON, 'game-xyz');
      expect(markets).toEqual([]);
    });
  });

  // ── getAzuroSignal ────────────────────────────────────────────────────────

  describe('getAzuroSignal', () => {
    it('returns a formatted string for a mocked NBA query', async () => {
      // First call: getUpcomingGames, subsequent calls: getMarketOdds
      stubFetch([
        { data: { games: [makeGame({ id: 'g1', sportName: 'Basketball', leagueName: 'NBA' })] } },
        { data: { conditions: [makeCondition()] } },
      ]);

      const result = await getAzuroSignal('NBA odds tonight');

      expect(typeof result).toBe('string');
      expect(result).toContain('Azuro');
      expect(result).toContain('NBA');
      expect(result).toContain('Lakers');
      expect(result).toContain('Celtics');
    });

    it('selects Gnosis chain when query contains "gnosis"', async () => {
      stubFetch([{ data: { games: [] } }]);

      const result = await getAzuroSignal('soccer matches on gnosis');

      const mockFetch = vi.mocked(global.fetch);
      const calledUrl = (mockFetch.mock.calls[0][0] as string);
      expect(calledUrl).toBe(AZURO_SUBGRAPH_URLS[AzuroChain.GNOSIS]);
      expect(result).toContain('GNOSIS');
    });

    it('returns a no-games message when subgraph returns empty list', async () => {
      stubFetch([{ data: { games: [] } }]);

      const result = await getAzuroSignal('cricket world cup');
      expect(result).toContain('No upcoming games found');
    });

    it('returns an error string (not throws) when fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const result = await getAzuroSignal('NFL playoffs');
      expect(result).toContain('Failed to fetch');
      expect(result).toContain('Network error');
    });

    it('includes sport filter in formatted output when detected', async () => {
      stubFetch([
        { data: { games: [makeGame({ sportName: 'Soccer', leagueName: 'Premier League' })] } },
        { data: { conditions: [] } },
      ]);

      const result = await getAzuroSignal('soccer Premier League matches');
      expect(result).toContain('Soccer');
    });
  });

  // ── AzuroChain enum ───────────────────────────────────────────────────────

  describe('AzuroChain', () => {
    it('has correct chain IDs', () => {
      expect(AzuroChain.POLYGON).toBe(137);
      expect(AzuroChain.GNOSIS).toBe(100);
      expect(AzuroChain.CHILIZ).toBe(88888);
      expect(AzuroChain.ARBITRUM).toBe(42161);
    });
  });
});
