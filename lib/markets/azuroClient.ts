/**
 * Azuro Protocol Client — Decentralized Prediction Market Integration
 * ════════════════════════════════════════════════════════════════════
 *
 * Lightweight TypeScript client (pure fetch, no SDK dependency) for the
 * Azuro Protocol GraphQL subgraph API.
 *
 * Supports: upcoming game discovery, live market odds, and an AI-friendly
 * natural-language wrapper for injecting market data into LLM context.
 *
 * Docs: https://gem.azuro.org/subgraph/overview
 */

// ── Chain Enum ────────────────────────────────────────────────────────────────

export enum AzuroChain {
  POLYGON  = 137,
  GNOSIS   = 100,
  CHILIZ   = 88888,
  ARBITRUM = 42161,
}

// ── Subgraph URLs ─────────────────────────────────────────────────────────────

export const AZURO_SUBGRAPH_URLS: Record<AzuroChain, string> = {
  [AzuroChain.POLYGON]:  'https://thegraph.azuro.org/subgraphs/name/azuro-protocol/azuro-api-polygon-v3',
  [AzuroChain.GNOSIS]:   'https://thegraph.azuro.org/subgraphs/name/azuro-protocol/azuro-api-gnosis-v3',
  [AzuroChain.CHILIZ]:   'https://thegraph.azuro.org/subgraphs/name/azuro-protocol/azuro-api-chiliz-v1',
  [AzuroChain.ARBITRUM]: 'https://thegraph.azuro.org/subgraphs/name/azuro-protocol/azuro-api-arbitrum-v3',
};

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface AzuroGame {
  id: string;
  sport: string;
  league: string;
  country: string;
  startsAt: number; // Unix timestamp
  status: string;
  homeTeam: string;
  awayTeam: string;
}

export interface AzuroOutcome {
  id: string;
  title: string;
  currentOdds: string;
}

export interface AzuroMarket {
  conditionId: string;
  marketName: string;
  outcomes: AzuroOutcome[];
}

// ── GraphQL Queries ───────────────────────────────────────────────────────────

const GAMES_QUERY = /* graphql */ `
  query Games($first: Int!, $sport: String) {
    games(first: $first, where: { status: Created, sport_contains_nocase: $sport }) {
      id
      sport { name }
      league { name }
      country { name }
      startsAt
      homeTeam { name }
      awayTeam { name }
    }
  }
`;

const MARKETS_QUERY = /* graphql */ `
  query Markets($gameId: String!) {
    conditions(where: { game: $gameId, status: Created }) {
      id
      marketName
      outcomes { id title currentOdds }
    }
  }
`;

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function querySubgraph<T>(
  chain: AzuroChain,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const url = AZURO_SUBGRAPH_URLS[chain];
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(
      `Azuro subgraph request failed [chain=${chain}]: HTTP ${response.status}`,
    );
  }

  const json = (await response.json()) as { data?: T; errors?: { message: string }[] };

  if (json.errors?.length) {
    throw new Error(`Azuro subgraph error: ${json.errors.map((e) => e.message).join('; ')}`);
  }

  if (!json.data) {
    throw new Error('Azuro subgraph returned no data');
  }

  return json.data;
}

// ── Raw response shapes ───────────────────────────────────────────────────────

interface RawGame {
  id: string;
  sport: { name: string };
  league: { name: string };
  country: { name: string };
  startsAt: string | number;
  homeTeam: { name: string };
  awayTeam: { name: string };
}

interface RawCondition {
  id: string;
  marketName: string;
  outcomes: { id: string; title: string; currentOdds: string }[];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch upcoming games from the Azuro subgraph.
 *
 * @param chain   - Target chain (default: Polygon).
 * @param sport   - Optional sport filter (e.g. "Basketball", "Soccer").
 * @param limit   - Maximum number of games to return (default: 20).
 */
export async function getUpcomingGames(
  chain: AzuroChain = AzuroChain.POLYGON,
  sport?: string,
  limit = 20,
): Promise<AzuroGame[]> {
  const data = await querySubgraph<{ games: RawGame[] }>(chain, GAMES_QUERY, {
    first: limit,
    sport: sport ?? '',
  });

  return (data.games ?? []).map((g) => ({
    id: g.id,
    sport: g.sport.name,
    league: g.league.name,
    country: g.country.name,
    startsAt: Number(g.startsAt),
    status: 'Created',
    homeTeam: g.homeTeam.name,
    awayTeam: g.awayTeam.name,
  }));
}

/**
 * Fetch current market odds for a specific game.
 *
 * @param chain  - Target chain.
 * @param gameId - The game ID returned by `getUpcomingGames`.
 */
export async function getMarketOdds(
  chain: AzuroChain,
  gameId: string,
): Promise<AzuroMarket[]> {
  const data = await querySubgraph<{ conditions: RawCondition[] }>(
    chain,
    MARKETS_QUERY,
    { gameId },
  );

  return (data.conditions ?? []).map((c) => ({
    conditionId: c.id,
    marketName: c.marketName,
    outcomes: c.outcomes.map((o) => ({
      id: o.id,
      title: o.title,
      currentOdds: o.currentOdds,
    })),
  }));
}

/**
 * AI-friendly wrapper: convert a natural language query into formatted
 * prediction market data suitable for injection into an LLM prompt.
 *
 * Examples:
 *   "NBA odds tonight"
 *   "Soccer matches this weekend on Gnosis"
 *   "Upcoming crypto event markets"
 *
 * @param query - Natural language market query.
 * @returns Formatted market snapshot string.
 */
export async function getAzuroSignal(query: string): Promise<string> {
  // Detect chain preference from query (default to Polygon)
  let chain = AzuroChain.POLYGON;
  if (/gnosis/i.test(query)) chain = AzuroChain.GNOSIS;
  else if (/arbitrum/i.test(query)) chain = AzuroChain.ARBITRUM;
  else if (/chiliz/i.test(query)) chain = AzuroChain.CHILIZ;

  // Extract sport hint from query
  const sportHints: Record<string, string> = {
    nba: 'Basketball',
    basketball: 'Basketball',
    soccer: 'Soccer',
    football: 'Soccer',
    nfl: 'American Football',
    baseball: 'Baseball',
    mlb: 'Baseball',
    tennis: 'Tennis',
    mma: 'MMA',
    esports: 'Esports',
    crypto: 'Crypto',
  };

  let sport: string | undefined;
  const lowerQuery = query.toLowerCase();
  for (const [keyword, sportName] of Object.entries(sportHints)) {
    if (lowerQuery.includes(keyword)) {
      sport = sportName;
      break;
    }
  }

  try {
    const games = await getUpcomingGames(chain, sport, 10);

    if (games.length === 0) {
      return `[Azuro Markets — ${AzuroChain[chain]}]\nNo upcoming games found matching "${query}".`;
    }

    const lines: string[] = [
      `[Azuro Prediction Markets — Chain: ${AzuroChain[chain]}${sport ? ` | Sport: ${sport}` : ''}]`,
      `Query: "${query}"`,
      `Found ${games.length} upcoming game(s):`,
      '',
    ];

    for (const game of games.slice(0, 5)) {
      const startDate = new Date(game.startsAt * 1000).toISOString();
      lines.push(`• ${game.sport} | ${game.league} (${game.country})`);
      lines.push(`  ${game.homeTeam} vs ${game.awayTeam}`);
      lines.push(`  Starts: ${startDate}`);
      lines.push(`  Game ID: ${game.id}`);

      try {
        const markets = await getMarketOdds(chain, game.id);
        if (markets.length > 0) {
          const m = markets[0];
          lines.push(`  Market: ${m.marketName}`);
          for (const outcome of m.outcomes) {
            lines.push(`    - ${outcome.title}: ${outcome.currentOdds}`);
          }
        }
      } catch {
        // Odds fetch failure is non-fatal; surface game without odds
        lines.push(`  (Odds unavailable)`);
      }

      lines.push('');
    }

    return lines.join('\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `[Azuro Markets] Failed to fetch data: ${message}`;
  }
}
