/**
 * Data Ingestion Pipeline
 * Downloads and ingests open-source datasets into knowledge base
 */

import { ingestDocument, loadOpenSourceData } from '../rag/vectorStore';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const FETCH_TIMEOUT_MS = 30000;

async function fetchWithTimeout(url: string, opts: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface DataSource {
  name: string;
  url?: string;
  type: 'wikipedia' | 'arxiv' | 'github' | 'stackoverflow' | 'builtin' | 'coingecko' | 'defillama' | 'cryptonews' | 'feargreed' | 'onchain';
  status: 'available' | 'not-configured' | 'processing';
}

const availableDataSources: DataSource[] = [
  {
    name: 'Wikipedia Snapshots',
    type: 'wikipedia',
    url: 'https://en.wikipedia.org',
    status: 'available',
  },
  {
    name: 'ArXiv Papers',
    type: 'arxiv',
    url: 'https://arxiv.org',
    status: 'available',
  },
  {
    name: 'Stack Overflow Q&A',
    type: 'stackoverflow',
    url: 'https://stackoverflow.com',
    status: 'available',
  },
  {
    name: 'GitHub Documentation',
    type: 'github',
    url: 'https://github.com',
    status: 'available',
  },
  {
    name: 'CoinGecko Market Data',
    type: 'coingecko',
    url: 'https://api.coingecko.com',
    status: 'available',
  },
  {
    name: 'DeFiLlama Protocol Data',
    type: 'defillama',
    url: 'https://api.llama.fi',
    status: 'available',
  },
  {
    name: 'CryptoCompare News',
    type: 'cryptonews',
    url: 'https://min-api.cryptocompare.com',
    status: 'available',
  },
  {
    name: 'Fear & Greed Index',
    type: 'feargreed',
    url: 'https://api.alternative.me',
    status: 'available',
  },
  {
    name: 'On-Chain Analytics',
    type: 'onchain',
    url: 'https://blockchain.info',
    status: 'available',
  },
];

// ── Crypto-specific constants ──────────────────────────────────────────
const TRADE_ASSETS = ['bitcoin', 'ethereum', 'solana', 'dogecoin', 'avalanche-2', 'chainlink', 'ripple', 'arbitrum', 'optimism'];
const TRADE_SYMBOLS = ['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'XRP', 'ARB', 'OP'];

const WIKIPEDIA_CATEGORIES = [
  'Cryptocurrency', 'Blockchain', 'Decentralized_finance',
  'Cryptocurrency_exchanges', 'Bitcoin', 'Ethereum',
  'Smart_contracts', 'Algorithmic_trading', 'Technical_analysis',
  'Quantitative_finance', 'Financial_risk_management', 'Market_microstructure',
];

const ARXIV_CATEGORIES = [
  { cat: 'q-fin.TR', label: 'Trading & Market Microstructure' },
  { cat: 'q-fin.PM', label: 'Portfolio Management' },
  { cat: 'q-fin.RM', label: 'Risk Management' },
  { cat: 'q-fin.ST', label: 'Statistical Finance' },
  { cat: 'q-fin.CP', label: 'Computational Finance' },
  { cat: 'cs.AI', label: 'Artificial Intelligence' },
  { cat: 'cs.LG', label: 'Machine Learning' },
  { cat: 'stat.ML', label: 'Statistics - ML' },
];

const MAX_ARTICLES_PER_WIKI_CATEGORY = 30;
const MAX_ARXIV_PAPERS_PER_CATEGORY = 15;

const CURSOR_FILE = path.join(process.cwd(), 'data', 'ingestion-cursors.json');
const MIN_SOURCE_INTERVAL_MINUTES = Math.max(5, Number(process.env.KB_INGEST_MIN_INTERVAL_MINUTES || 60));

type CursorState = Record<string, { lastRunAt: number }>;

function readCursors(): CursorState {
  try {
    if (!fs.existsSync(CURSOR_FILE)) return {};
    const raw = fs.readFileSync(CURSOR_FILE, 'utf8');
    return JSON.parse(raw) as CursorState;
  } catch {
    return {};
  }
}

function writeCursors(next: CursorState) {
  try {
    const dir = path.dirname(CURSOR_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Atomic write: tmp + rename
    const tmpPath = CURSOR_FILE + '.tmp.' + process.pid + '.' + crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmpPath, CURSOR_FILE);
  } catch (err) {
    console.error('[dataLoader] writeCursors failed:', (err as Error).message);
  }
}

function shouldRunSource(sourceId: string) {
  const cursors = readCursors();
  const lastRunAt = cursors[sourceId]?.lastRunAt || 0;
  const minIntervalMs = MIN_SOURCE_INTERVAL_MINUTES * 60 * 1000;
  return Date.now() - lastRunAt >= minIntervalMs;
}

function markSourceRun(sourceId: string) {
  const cursors = readCursors();
  cursors[sourceId] = { lastRunAt: Date.now() };
  writeCursors(cursors);
}

/**
 * Load built-in datasets
 */
export async function loadBuiltInDatasets() {
  console.log('📦 Loading built-in datasets...');
  await loadOpenSourceData();
  console.log('✅ Built-in datasets loaded');
}

/**
 * Get list of available data sources
 */
export function getAvailableDataSources(): DataSource[] {
  return availableDataSources;
}

/**
 * Sample Wikipedia dataset ingestion
 * In production, you would use Wikipedia API or dumps
 */
export async function fetchAndIngestWikipediaCategory(category: string) {
  if (!shouldRunSource(`wikipedia:${category}`)) {
    console.log(`⏭️ Skipping Wikipedia ${category}; source cooldown active`);
    return 0;
  }

  console.log(`📖 Fetching Wikipedia category: ${category}...`);

  try {
    // This is a placeholder - in production use wikipedia-js or mwclient
    const response = await fetchWithTimeout(
      `https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:${encodeURIComponent(category)}&format=json&origin=*`
    );
    if (!response.ok) throw new Error(`Wikipedia category: ${response.status}`);

    const data = await response.json();

    if (!data.query?.categorymembers) {
      console.log('No results found');
      return 0;
    }

    const articles = data.query.categorymembers.slice(0, MAX_ARTICLES_PER_WIKI_CATEGORY);

    for (const article of articles) {
      // Fetch article content
      const articleResponse = await fetchWithTimeout(
        `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&titles=${encodeURIComponent(article.title)}&format=json&origin=*`
      );
      if (!articleResponse.ok) continue;

      const articleData = await articleResponse.json();
      const pages = articleData.query.pages;
      const pageContent = pages[Object.keys(pages)[0]]?.extract;

      if (pageContent) {
        // Strip HTML tags
        const cleanContent = pageContent.replace(/<[^>]*>/g, '');

        await ingestDocument(cleanContent, 'Wikipedia', 'Reference', {
          qualityScore: 0.78,
          sourceReliability: 0.76,
          metadata: {
            title: article.title,
            category,
            fetchedAt: new Date().toISOString(),
          },
        });
        console.log(`  ✓ Ingested: ${article.title}`);
      }
    }

    markSourceRun(`wikipedia:${category}`);
    console.log(`✅ Ingested ${articles.length} articles from ${category}`);
    return articles.length;
  } catch (error) {
    console.error('Error fetching Wikipedia:', error);
    return 0;
  }
}

/**
 * Sample ArXiv paper ingestion
 * Fetches recent papers from arXiv API
 */
export async function fetchAndIngestArXivPapers(category: string = 'cs.AI', limit: number = 5) {
  if (!shouldRunSource(`arxiv:${category}`)) {
    console.log(`⏭️ Skipping ArXiv ${category}; source cooldown active`);
    return 0;
  }

  console.log(`📚 Fetching ArXiv papers from ${category}...`);

  try {
    const response = await fetchWithTimeout(
      `https://export.arxiv.org/api/query?search_query=cat:${encodeURIComponent(category)}&start=0&max_results=${limit}`
    );
    if (!response.ok) throw new Error(`ArXiv: ${response.status}`);

    const text = await response.text();

    // Parse Atom XML (simple regex-based parsing for MVP)
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    let count = 0;

    while ((match = entryRegex.exec(text)) !== null) {
      const entry = match[1];

      const titleMatch = /<title>(.*?)<\/title>/.exec(entry);
      const summaryMatch = /<summary>(.*?)<\/summary>/.exec(entry);

      if (titleMatch && summaryMatch) {
        const title = titleMatch[1];
        const summary = summaryMatch[1].replace(/\n/g, ' ').trim();

        await ingestDocument(
          `Title: ${title}\n${summary}`,
          'ArXiv',
          'Research Paper',
          {
            qualityScore: 0.9,
            sourceReliability: 0.9,
            metadata: {
              title,
              category,
              fetchedAt: new Date().toISOString(),
            },
          }
        );
        console.log(`  ✓ Ingested: ${title.substring(0, 50)}...`);
        count++;
      }
    }

    markSourceRun(`arxiv:${category}`);
    console.log(`✅ Ingested ${count} papers from ArXiv`);
    return count;
  } catch (error) {
    console.error('Error fetching ArXiv:', error);
    return 0;
  }
}

/**
 * Ingest GitHub trending repositories info
 */
export async function fetchAndIngestGitHubTrending() {
  if (!shouldRunSource('github:trending')) {
    console.log('⏭️ Skipping GitHub trending; source cooldown active');
    return 0;
  }

  console.log('🐙 Fetching GitHub trending repositories...');
  let ghCount = 0;

  try {
    // Crypto & trading-specific repos
    const queries = [
      'cryptocurrency+trading+bot',
      'defi+protocol',
      'algorithmic+trading',
      'quantitative+finance+python',
      'blockchain+analytics',
    ];

    for (const q of queries) {
      try {
        await new Promise(r => setTimeout(r, 1000)); // Rate limit
        const response = await fetchWithTimeout(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=5`, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
          },
        });
        if (!response.ok) continue;

        const data = await response.json();

        for (const repo of data.items || []) {
          const content = `
Repository: ${repo.full_name}
Description: ${repo.description || 'N/A'}
Language: ${repo.language || 'N/A'}
Stars: ${repo.stargazers_count}
URL: ${repo.html_url}
Topics: ${repo.topics?.join(', ') || 'N/A'}
Search Category: ${q.replace(/\+/g, ' ')}
Last Updated: ${repo.updated_at}
`;

          await ingestDocument(content, 'GitHub', 'Repository', {
            qualityScore: 0.7,
            sourceReliability: 0.72,
            metadata: {
              fullName: repo.full_name,
              stars: repo.stargazers_count,
              query: q,
              fetchedAt: new Date().toISOString(),
            },
          });
          console.log(`  ✓ Ingested: ${repo.full_name}`);
          ghCount++;
        }
      } catch (e) {
        console.warn(`  ⚠️ GitHub query "${q}" failed:`, (e as Error).message);
      }
    }

    markSourceRun('github:trending');
    console.log(`✅ Ingested ${ghCount} crypto GitHub repositories`);
    return ghCount;
  } catch (error) {
    console.error('Error fetching GitHub:', error);
    return 0;
  }
}

/**
 * Run full data ingestion pipeline
 */
export async function runFullDataIngestionPipeline() {
  console.log('🚀 Starting full data ingestion pipeline...\n');

  const results: Record<string, number> = {
    builtin: 0,
    wikipedia: 0,
    arxiv: 0,
    github: 0,
    coingecko: 0,
    defillama: 0,
    cryptonews: 0,
    feargreed: 0,
    onchain: 0,
  };

  try {
    // Load built-in datasets
    await loadBuiltInDatasets();
    results.builtin = 3;

    // ── Wikipedia (expanded crypto + finance categories) ──────────────
    for (const cat of WIKIPEDIA_CATEGORIES) {
      try {
        results.wikipedia += await fetchAndIngestWikipediaCategory(cat);
      } catch (e) {
        console.warn(`⚠️ Wikipedia category ${cat} failed:`, (e as Error).message);
      }
    }

    // ── ArXiv (quant finance + ML categories) ────────────────────────
    for (const { cat, label } of ARXIV_CATEGORIES) {
      try {
        console.log(`📚 ArXiv category: ${label} (${cat})`);
        results.arxiv += await fetchAndIngestArXivPapers(cat, MAX_ARXIV_PAPERS_PER_CATEGORY);
      } catch (e) {
        console.warn(`⚠️ ArXiv category ${cat} failed:`, (e as Error).message);
      }
    }

    // ── GitHub trending crypto repos ─────────────────────────────────
    results.github = await fetchAndIngestGitHubTrending();

    // ── CoinGecko market intelligence ────────────────────────────────
    results.coingecko = await fetchAndIngestCoinGeckoData();

    // ── DeFiLlama protocol analytics ─────────────────────────────────
    results.defillama = await fetchAndIngestDeFiLlamaData();

    // ── Crypto news ──────────────────────────────────────────────────
    results.cryptonews = await fetchAndIngestCryptoNews();

    // ── Fear & Greed Index ───────────────────────────────────────────
    results.feargreed = await fetchAndIngestFearGreed();

    // ── On-chain analytics ───────────────────────────────────────────
    results.onchain = await fetchAndIngestOnChainData();

    const total = Object.values(results).reduce((a, b) => a + b, 0);

    console.log('\n📊 Data Ingestion Summary:');
    console.log(`   Built-in datasets:   ${results.builtin}`);
    console.log(`   Wikipedia articles:   ${results.wikipedia}`);
    console.log(`   ArXiv papers:         ${results.arxiv}`);
    console.log(`   GitHub repos:         ${results.github}`);
    console.log(`   CoinGecko assets:     ${results.coingecko}`);
    console.log(`   DeFiLlama protocols:  ${results.defillama}`);
    console.log(`   Crypto news articles: ${results.cryptonews}`);
    console.log(`   Fear & Greed data:    ${results.feargreed}`);
    console.log(`   On-chain datapoints:  ${results.onchain}`);
    console.log(`   ────────────────────────────`);
    console.log(`   Total ingested:       ${total}`);

    return results;
  } catch (error) {
    console.error('Data ingestion pipeline error:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// NEW: Crypto-Specific Deep Ingestion Sources
// ═══════════════════════════════════════════════════════════════════════

/**
 * CoinGecko Market Intelligence
 * Fetches detailed market data, descriptions, and developer stats for our trade assets
 */
export async function fetchAndIngestCoinGeckoData(): Promise<number> {
  if (!shouldRunSource('coingecko:markets')) {
    console.log('⏭️ Skipping CoinGecko; source cooldown active');
    return 0;
  }

  console.log('🦎 Fetching CoinGecko market intelligence...');
  let count = 0;

  try {
    // 1) Global market overview
    const globalResp = await fetchWithTimeout('https://api.coingecko.com/api/v3/global');
    if (globalResp.ok) {
      const globalData = await globalResp.json();
      const g = globalData.data;
      const globalContent = `
CRYPTO GLOBAL MARKET OVERVIEW (${new Date().toISOString()})
Total Market Cap: $${(g.total_market_cap?.usd / 1e12)?.toFixed(2)}T
24h Volume: $${(g.total_volume?.usd / 1e9)?.toFixed(2)}B
BTC Dominance: ${g.market_cap_percentage?.btc?.toFixed(1)}%
ETH Dominance: ${g.market_cap_percentage?.eth?.toFixed(1)}%
Active Cryptocurrencies: ${g.active_cryptocurrencies}
Market Cap Change 24h: ${g.market_cap_change_percentage_24h_usd?.toFixed(2)}%
`;
      await ingestDocument(globalContent, 'CoinGecko', 'Market Data', {
        qualityScore: 0.92,
        sourceReliability: 0.90,
        metadata: { type: 'global_overview', fetchedAt: new Date().toISOString() },
      });
      count++;
    }

    // 2) Detailed data for each trade asset
    for (const coinId of TRADE_ASSETS) {
      try {
        await new Promise(r => setTimeout(r, 1200)); // Rate limit: ~50 req/min
        const resp = await fetchWithTimeout(
          `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=true&developer_data=true`
        );
        if (!resp.ok) continue;

        const coin = await resp.json();
        const mkt = coin.market_data || {};

        const content = `
ASSET INTELLIGENCE: ${coin.name} (${coin.symbol?.toUpperCase()})
─────────────────────────────────────────────
Description: ${(coin.description?.en || '').replace(/<[^>]*>/g, '').substring(0, 2000)}

Market Data:
  Current Price: $${mkt.current_price?.usd?.toLocaleString()}
  Market Cap: $${(mkt.market_cap?.usd / 1e9)?.toFixed(2)}B
  Market Cap Rank: #${coin.market_cap_rank}
  24h Volume: $${(mkt.total_volume?.usd / 1e6)?.toFixed(2)}M
  24h Change: ${mkt.price_change_percentage_24h?.toFixed(2)}%
  7d Change: ${mkt.price_change_percentage_7d?.toFixed(2)}%
  30d Change: ${mkt.price_change_percentage_30d?.toFixed(2)}%
  60d Change: ${mkt.price_change_percentage_60d?.toFixed(2)}%
  200d Change: ${mkt.price_change_percentage_200d?.toFixed(2)}%
  1y Change: ${mkt.price_change_percentage_1y?.toFixed(2)}%
  ATH: $${mkt.ath?.usd?.toLocaleString()} (${mkt.ath_change_percentage?.usd?.toFixed(1)}% from ATH)
  ATL: $${mkt.atl?.usd}
  Circulating Supply: ${mkt.circulating_supply?.toLocaleString()}
  Total Supply: ${mkt.total_supply?.toLocaleString() || 'Unlimited'}
  Max Supply: ${mkt.max_supply?.toLocaleString() || 'N/A'}

Sentiment & Community:
  Sentiment Up: ${coin.sentiment_votes_up_percentage}%
  Sentiment Down: ${coin.sentiment_votes_down_percentage}%
  Twitter Followers: ${coin.community_data?.twitter_followers?.toLocaleString() || 'N/A'}
  Reddit Subscribers: ${coin.community_data?.reddit_subscribers?.toLocaleString() || 'N/A'}

Developer Activity:
  GitHub Stars: ${coin.developer_data?.stars || 0}
  GitHub Forks: ${coin.developer_data?.forks || 0}
  Commit Count (4w): ${coin.developer_data?.commit_count_4_weeks || 0}
  Contributors: ${coin.developer_data?.pull_request_contributors || 0}

Categories: ${coin.categories?.join(', ') || 'N/A'}
Genesis Date: ${coin.genesis_date || 'Unknown'}
Hashing Algorithm: ${coin.hashing_algorithm || 'N/A'}
`;

        await ingestDocument(content, 'CoinGecko', 'Asset Intelligence', {
          qualityScore: 0.93,
          sourceReliability: 0.91,
          metadata: {
            coinId,
            symbol: coin.symbol,
            marketCapRank: coin.market_cap_rank,
            fetchedAt: new Date().toISOString(),
          },
        });
        console.log(`  ✓ Ingested: ${coin.name} (${coin.symbol?.toUpperCase()})`);
        count++;
      } catch (e) {
        console.warn(`  ⚠️ Failed ${coinId}:`, (e as Error).message);
      }
    }

    // 3) Trending coins (what the market is watching)
    try {
      const trendResp = await fetchWithTimeout('https://api.coingecko.com/api/v3/search/trending');
      if (trendResp.ok) {
        const trendData = await trendResp.json();
        const coins = trendData.coins?.map((c: any) => c.item) || [];
        const trendContent = `
TRENDING COINS (${new Date().toISOString()})
${coins.map((c: any, i: number) => `${i + 1}. ${c.name} (${c.symbol}) — Market Cap Rank #${c.market_cap_rank}, Score: ${c.score}`).join('\n')}
`;
        await ingestDocument(trendContent, 'CoinGecko', 'Market Trends', {
          qualityScore: 0.80,
          sourceReliability: 0.85,
          metadata: { type: 'trending', fetchedAt: new Date().toISOString() },
        });
        count++;
      }
    } catch { /* non-critical */ }

    markSourceRun('coingecko:markets');
    console.log(`✅ CoinGecko: Ingested ${count} documents`);
    return count;
  } catch (error) {
    console.error('Error fetching CoinGecko:', error);
    return count;
  }
}

/**
 * DeFiLlama Protocol Analytics
 * Fetches TVL data for major DeFi protocols & chain breakdowns
 */
export async function fetchAndIngestDeFiLlamaData(): Promise<number> {
  if (!shouldRunSource('defillama:protocols')) {
    console.log('⏭️ Skipping DeFiLlama; source cooldown active');
    return 0;
  }

  console.log('🦙 Fetching DeFiLlama protocol data...');
  let count = 0;

  try {
    // 1) Chain TVL overview
    const chainsResp = await fetchWithTimeout('https://api.llama.fi/v2/chains');
    if (chainsResp.ok) {
      const chains = await chainsResp.json();
      const top20 = chains.slice(0, 20);
      const chainContent = `
DEFI CHAIN TVL RANKINGS (${new Date().toISOString()})
${top20.map((c: any, i: number) => `${i + 1}. ${c.name}: $${(c.tvl / 1e9).toFixed(2)}B TVL`).join('\n')}
`;
      await ingestDocument(chainContent, 'DeFiLlama', 'Chain Analytics', {
        qualityScore: 0.88,
        sourceReliability: 0.92,
        metadata: { type: 'chain_tvl', chains: top20.length, fetchedAt: new Date().toISOString() },
      });
      count++;
    }

    // 2) Top protocols by TVL
    const protocolsResp = await fetchWithTimeout('https://api.llama.fi/protocols');
    if (protocolsResp.ok) {
      const protocols = await protocolsResp.json();
      const top50 = protocols.slice(0, 50);

      // Batch into a single doc for top protocols overview
      const overviewContent = `
TOP 50 DEFI PROTOCOLS BY TVL (${new Date().toISOString()})
${top50.map((p: any, i: number) => {
        const tvlB = (p.tvl / 1e9).toFixed(2);
        const change1d = p.change_1d?.toFixed(2) || 'N/A';
        const change7d = p.change_7d?.toFixed(2) || 'N/A';
        return `${i + 1}. ${p.name} (${p.symbol || 'N/A'}) — $${tvlB}B TVL — 1d: ${change1d}% — 7d: ${change7d}% — Chain: ${p.chain || 'Multi'} — Category: ${p.category || 'N/A'}`;
      }).join('\n')}
`;
      await ingestDocument(overviewContent, 'DeFiLlama', 'Protocol Rankings', {
        qualityScore: 0.90,
        sourceReliability: 0.93,
        metadata: { type: 'protocol_rankings', count: top50.length, fetchedAt: new Date().toISOString() },
      });
      count++;

      // Detailed docs for top 15 protocols (chains relevant to our assets)
      const relevantChains = ['Ethereum', 'Solana', 'Avalanche', 'Arbitrum', 'Optimism'];
      const relevantProtos = top50.filter((p: any) =>
        relevantChains.some(c => p.chains?.includes(c) || p.chain === c)
      ).slice(0, 15);

      for (const proto of relevantProtos) {
        const detailContent = `
DEFI PROTOCOL: ${proto.name} (${proto.symbol || 'N/A'})
─────────────────────────────────────────────
Category: ${proto.category || 'N/A'}
TVL: $${(proto.tvl / 1e9).toFixed(3)}B
1d Change: ${proto.change_1d?.toFixed(2) || 'N/A'}%
7d Change: ${proto.change_7d?.toFixed(2) || 'N/A'}%
1m Change: ${proto.change_1m?.toFixed(2) || 'N/A'}%
Chains: ${proto.chains?.join(', ') || proto.chain || 'N/A'}
Description: ${proto.description || 'N/A'}
Audits: ${proto.audits || 'Unknown'}
URL: ${proto.url || 'N/A'}
`;
        await ingestDocument(detailContent, 'DeFiLlama', 'Protocol Detail', {
          qualityScore: 0.87,
          sourceReliability: 0.90,
          metadata: {
            protocol: proto.name,
            tvl: proto.tvl,
            category: proto.category,
            fetchedAt: new Date().toISOString(),
          },
        });
        count++;
      }
    }

    // 3) Stablecoin metrics (market indicator)
    try {
      const stableResp = await fetchWithTimeout('https://stablecoins.llama.fi/stablecoins?includePrices=true');
      if (stableResp.ok) {
        const stableData = await stableResp.json();
        const stables = stableData.peggedAssets?.slice(0, 10) || [];
        const stableContent = `
TOP STABLECOINS BY MARKET CAP (${new Date().toISOString()})
${stables.map((s: any, i: number) => {
          const mcap = s.circulating?.peggedUSD;
          return `${i + 1}. ${s.name} (${s.symbol}) — $${((mcap || 0) / 1e9).toFixed(2)}B — Price Type: ${s.pegType}`;
        }).join('\n')}

INSIGHT: Stablecoin supply is a leading indicator of crypto market liquidity.
Rising aggregate stablecoin supply = capital inflows = bullish market signal.
`;
        await ingestDocument(stableContent, 'DeFiLlama', 'Stablecoin Metrics', {
          qualityScore: 0.86,
          sourceReliability: 0.91,
          metadata: { type: 'stablecoins', fetchedAt: new Date().toISOString() },
        });
        count++;
      }
    } catch { /* non-critical */ }

    markSourceRun('defillama:protocols');
    console.log(`✅ DeFiLlama: Ingested ${count} documents`);
    return count;
  } catch (error) {
    console.error('Error fetching DeFiLlama:', error);
    return count;
  }
}

/**
 * CryptoCompare News Feed
 * Fetches latest crypto news articles for sentiment analysis and context
 */
export async function fetchAndIngestCryptoNews(): Promise<number> {
  if (!shouldRunSource('cryptonews:latest')) {
    console.log('⏭️ Skipping CryptoNews; source cooldown active');
    return 0;
  }

  console.log('📰 Fetching crypto news...');
  let count = 0;

  try {
    // CryptoCompare news API (free, no key required for basic access)
    const categories = ['BTC', 'ETH', 'Trading', 'Regulation', 'Technology', 'Market'];

    for (const cat of categories) {
      try {
        await new Promise(r => setTimeout(r, 500));
        const resp = await fetchWithTimeout(
          `https://min-api.cryptocompare.com/data/v2/news/?categories=${cat}&excludeCategories=Sponsored&lang=EN`
        );
        if (!resp.ok) continue;

        const data = await resp.json();
        const articles = data.Data?.slice(0, 10) || [];

        for (const article of articles) {
          const content = `
CRYPTO NEWS: ${article.title}
Source: ${article.source_info?.name || article.source}
Category: ${cat}
Published: ${new Date(article.published_on * 1000).toISOString()}

${article.body?.substring(0, 3000) || ''}

Tags: ${article.tags || 'N/A'}
URL: ${article.url}
`;
          await ingestDocument(content, 'CryptoCompare', 'News', {
            qualityScore: 0.72,
            sourceReliability: 0.70,
            metadata: {
              title: article.title,
              source: article.source,
              category: cat,
              publishedAt: new Date(article.published_on * 1000).toISOString(),
              fetchedAt: new Date().toISOString(),
            },
          });
          count++;
        }
        console.log(`  ✓ ${cat}: ${articles.length} articles`);
      } catch (e) {
        console.warn(`  ⚠️ News category ${cat} failed:`, (e as Error).message);
      }
    }

    markSourceRun('cryptonews:latest');
    console.log(`✅ Crypto News: Ingested ${count} articles`);
    return count;
  } catch (error) {
    console.error('Error fetching crypto news:', error);
    return count;
  }
}

/**
 * Fear & Greed Index
 * Historical sentiment data — leading indicator for market reversals
 */
export async function fetchAndIngestFearGreed(): Promise<number> {
  if (!shouldRunSource('feargreed:index')) {
    console.log('⏭️ Skipping Fear & Greed; source cooldown active');
    return 0;
  }

  console.log('😱 Fetching Fear & Greed Index...');

  try {
    const resp = await fetchWithTimeout('https://api.alternative.me/fng/?limit=30&format=json');
    if (!resp.ok) throw new Error(`Fear & Greed: ${resp.status}`);

    const data = await resp.json();
    const entries = data.data || [];

    if (entries.length === 0) return 0;

    const latest = entries[0];
    const avg7d = entries.slice(0, 7).reduce((s: number, e: any) => s + Number(e.value), 0) / Math.min(7, entries.length);
    const avg30d = entries.reduce((s: number, e: any) => s + Number(e.value), 0) / entries.length;

    const content = `
CRYPTO FEAR & GREED INDEX (${new Date().toISOString()})
─────────────────────────────────────────────
Current Value: ${latest.value} — ${latest.value_classification}
7-day Average: ${avg7d.toFixed(1)}
30-day Average: ${avg30d.toFixed(1)}

Historical (last 30 days):
${entries.map((e: any) => `  ${new Date(Number(e.timestamp) * 1000).toISOString().split('T')[0]}: ${e.value} (${e.value_classification})`).join('\n')}

INTERPRETATION:
- 0-24: Extreme Fear (potential buying opportunity — market oversold)
- 25-49: Fear (caution, but contrarian signal for accumulation)
- 50-74: Greed (bullish sentiment, but risk of correction rising)
- 75-100: Extreme Greed (high risk of correction — reduce exposure)

TRADING SIGNAL: ${
  Number(latest.value) < 25 ? 'EXTREME FEAR — Historically a strong buy signal. Smart money accumulates here.'
    : Number(latest.value) < 50 ? 'FEAR — Market uncertainty. Consider selective accumulation.'
    : Number(latest.value) < 75 ? 'GREED — Bullish but tighten stops. Potential for local top.'
    : 'EXTREME GREED — High probability of correction. Scale out positions.'
}

TREND: ${avg7d > avg30d ? 'Sentiment IMPROVING (7d avg > 30d avg)' : 'Sentiment DETERIORATING (7d avg < 30d avg)'}
`;

    await ingestDocument(content, 'Alternative.me', 'Sentiment Index', {
      qualityScore: 0.85,
      sourceReliability: 0.80,
      metadata: {
        currentValue: Number(latest.value),
        classification: latest.value_classification,
        avg7d,
        avg30d,
        fetchedAt: new Date().toISOString(),
      },
    });

    markSourceRun('feargreed:index');
    console.log(`✅ Fear & Greed Index: ${latest.value} (${latest.value_classification})`);
    return 1;
  } catch (error) {
    console.error('Error fetching Fear & Greed:', error);
    return 0;
  }
}

/**
 * On-Chain Analytics
 * Fetches blockchain network metrics from public APIs
 */
export async function fetchAndIngestOnChainData(): Promise<number> {
  if (!shouldRunSource('onchain:metrics')) {
    console.log('⏭️ Skipping On-Chain; source cooldown active');
    return 0;
  }

  console.log('⛓️ Fetching on-chain analytics...');
  let count = 0;

  try {
    // 1) Bitcoin blockchain stats (blockchain.info — free, no key)
    const btcResp = await fetchWithTimeout('https://blockchain.info/stats?format=json');
    if (btcResp.ok) {
      const btc = await btcResp.json();
      const content = `
BITCOIN ON-CHAIN METRICS (${new Date().toISOString()})
─────────────────────────────────────────────
Market Price (USD): $${btc.market_price_usd?.toLocaleString()}
Hash Rate: ${(btc.hash_rate / 1e6).toFixed(2)} EH/s
Difficulty: ${btc.difficulty?.toLocaleString()}
Blocks Mined (24h): ${btc.n_blocks_mined}
Block Size (avg): ${(btc.blocks_size / btc.n_blocks_mined / 1e6).toFixed(2)}MB
TX Count (24h): ${btc.n_tx?.toLocaleString()}
Total BTC Sent (24h): ${(btc.total_btc_sent / 1e8).toFixed(2)} BTC
Estimated TX Volume (USD): $${(btc.estimated_transaction_volume_usd / 1e6).toFixed(2)}M
Miners Revenue (24h): $${(btc.miners_revenue_usd / 1e6).toFixed(2)}M
Trade Volume (USD): $${(btc.trade_volume_usd / 1e6).toFixed(2)}M
Mempool TX Count: ${btc.mempool_size || 'N/A'}
Minutes Between Blocks: ${btc.minutes_between_blocks?.toFixed(1)}

ANALYSIS:
- Hash rate trend indicates ${btc.hash_rate > 5e17 ? 'strong' : 'moderate'} network security
- Block interval of ${btc.minutes_between_blocks?.toFixed(1)} min (target: 10 min) suggests ${
  btc.minutes_between_blocks < 9.5 ? 'hash rate increasing (bullish for difficulty adjustment)'
    : btc.minutes_between_blocks > 10.5 ? 'hash rate declining (next difficulty may decrease)'
    : 'stable network conditions'
}
`;
      await ingestDocument(content, 'Blockchain.info', 'On-Chain Metrics', {
        qualityScore: 0.91,
        sourceReliability: 0.95,
        metadata: {
          asset: 'BTC',
          hashRate: btc.hash_rate,
          txCount24h: btc.n_tx,
          fetchedAt: new Date().toISOString(),
        },
      });
      count++;
    }

    // 2) ETH gas tracker (etherscan-free or public endpoint)
    try {
      const gasResp = await fetchWithTimeout('https://api.blocknative.com/gasprices/blockprices');
      if (gasResp.ok) {
        const gasData = await gasResp.json();
        const block = gasData.blockPrices?.[0];
        if (block) {
          const gasContent = `
ETHEREUM GAS METRICS (${new Date().toISOString()})
Block: ${block.blockNumber}
Base Fee: ${block.baseFeePerGas?.toFixed(2)} Gwei
Estimated Prices:
${block.estimatedPrices?.map((p: any) => `  ${p.confidence}% confidence: ${p.maxFeePerGas?.toFixed(1)} Gwei (priority: ${p.maxPriorityFeePerGas?.toFixed(1)} Gwei)`).join('\n') || '  N/A'}

INSIGHT: Gas prices reflect network demand. High gas = high activity = bullish.
Low gas = reduced activity = potential accumulation phase.
`;
          await ingestDocument(gasContent, 'Blocknative', 'Gas Metrics', {
            qualityScore: 0.83,
            sourceReliability: 0.85,
            metadata: { chain: 'ETH', blockNumber: block.blockNumber, fetchedAt: new Date().toISOString() },
          });
          count++;
        }
      }
    } catch { /* non-critical — gas API may rate limit */ }

    // 3) Bitcoin mempool stats (mempool.space — free)
    try {
      const mempoolResp = await fetchWithTimeout('https://mempool.space/api/v1/fees/recommended');
      if (mempoolResp.ok) {
        const fees = await mempoolResp.json();
        const mempoolContent = `
BITCOIN MEMPOOL FEE ESTIMATES (${new Date().toISOString()})
Fastest (next block): ${fees.fastestFee} sat/vB
Half Hour: ${fees.halfHourFee} sat/vB
1 Hour: ${fees.hourFee} sat/vB
Economy: ${fees.economyFee} sat/vB
Minimum: ${fees.minimumFee} sat/vB

HIGH FEE ALERT: ${fees.fastestFee > 50 ? 'YES — High on-chain demand' : 'NO — Normal conditions'}
`;
        await ingestDocument(mempoolContent, 'Mempool.space', 'BTC Fee Data', {
          qualityScore: 0.84,
          sourceReliability: 0.92,
          metadata: { fastestFee: fees.fastestFee, fetchedAt: new Date().toISOString() },
        });
        count++;
      }
    } catch { /* non-critical */ }

    markSourceRun('onchain:metrics');
    console.log(`✅ On-Chain: Ingested ${count} documents`);
    return count;
  } catch (error) {
    console.error('Error fetching on-chain:', error);
    return count;
  }
}

/**
 * Quick ingestion run for maintenance mode (crypto sources only, no env gate)
 * Called by the maintenance workforce during each cycle
 */
export async function runMaintenanceIngestion(): Promise<Record<string, number>> {
  console.log('🔄 Running maintenance-mode knowledge ingestion...');

  const results: Record<string, number> = {
    coingecko: 0,
    defillama: 0,
    cryptonews: 0,
    feargreed: 0,
    onchain: 0,
    arxiv: 0,
  };

  try {
    // Only run crypto-specific and finance sources (no env gate)
    results.coingecko = await fetchAndIngestCoinGeckoData();
    results.defillama = await fetchAndIngestDeFiLlamaData();
    results.cryptonews = await fetchAndIngestCryptoNews();
    results.feargreed = await fetchAndIngestFearGreed();
    results.onchain = await fetchAndIngestOnChainData();

    // Also run quantitative finance ArXiv papers
    for (const { cat } of ARXIV_CATEGORIES.filter(c => c.cat.startsWith('q-fin'))) {
      results.arxiv += await fetchAndIngestArXivPapers(cat, 5);
    }

    const total = Object.values(results).reduce((a, b) => a + b, 0);
    console.log(`✅ Maintenance ingestion complete: ${total} documents`);
    return results;
  } catch (error) {
    console.error('Maintenance ingestion error:', error);
    return results;
  }
}
