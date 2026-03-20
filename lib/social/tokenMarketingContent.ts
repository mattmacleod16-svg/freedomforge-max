/**
 * $FORGE Token Marketing Content Library
 * Pre-built content templates for token launch promotion across X/Twitter
 * and all social channels. Integrates with the existing X automation pipeline.
 */

export type TokenContentCategory =
  | 'token-launch'
  | 'tokenomics'
  | 'staking'
  | 'governance'
  | 'revenue-share'
  | 'multi-chain'
  | 'community'
  | 'milestone'
  | 'educational';

export interface TokenMarketingPost {
  id: string;
  category: TokenContentCategory;
  template: string;
  hashtags: string[];
  targetAudience: string;
  priority: number; // 1-10, higher = more important
}

const TOKEN_HASHTAGS = ['#FORGE', '#FreedomForgeMax', '#DeFi', '#AI', '#Web3'];
const CRYPTO_HASHTAGS = ['#Crypto', '#ERC20', '#Ethereum', '#Base', '#DeFi'];
const AI_HASHTAGS = ['#AIToken', '#AutonomousAI', '#MultiModelAI', '#AITrading'];

/**
 * Token launch announcement posts.
 */
function getTokenLaunchPosts(): TokenMarketingPost[] {
  return [
    {
      id: 'launch-1',
      category: 'token-launch',
      template: `$FORGE is here.\n\n1 billion tokens. Fixed supply. No inflation.\n\nThe utility token powering the world's most comprehensive autonomous AI stack:\n→ 20+ AI providers\n→ 50+ models\n→ Multi-model consensus\n→ Autonomous trading\n\nThe future of AI is decentralized.`,
      hashtags: [...TOKEN_HASHTAGS, ...CRYPTO_HASHTAGS],
      targetAudience: 'crypto-natives, AI enthusiasts',
      priority: 10,
    },
    {
      id: 'launch-2',
      category: 'token-launch',
      template: `Why $FORGE?\n\nBecause no single AI model should have all the power.\n\nFreedomForge Max routes every query through 13+ AI models simultaneously.\n\n$FORGE lets you:\n• Stake for premium access\n• Earn from trading profits\n• Vote on model routing\n• Shape decentralized AI\n\nThis isn't a meme. It's infrastructure.`,
      hashtags: [...TOKEN_HASHTAGS, ...AI_HASHTAGS],
      targetAudience: 'DeFi users, AI power users',
      priority: 9,
    },
    {
      id: 'launch-3',
      category: 'token-launch',
      template: `Most AI tokens are vaporware.\n\n$FORGE is backed by a live, production-grade system:\n✓ 13+ AI providers integrated\n✓ Autonomous trading running 24/7\n✓ Revenue distribution every Friday\n✓ Self-healing infrastructure\n✓ 23 verified skills across 6 domains\n\nReal utility. Real revenue. Real AI.`,
      hashtags: [...TOKEN_HASHTAGS, '#BuildInPublic'],
      targetAudience: 'skeptics, builders',
      priority: 9,
    },
  ];
}

/**
 * Tokenomics explanation posts.
 */
function getTokenomicsPosts(): TokenMarketingPost[] {
  return [
    {
      id: 'tokenomics-1',
      category: 'tokenomics',
      template: `$FORGE Tokenomics breakdown:\n\n🟡 40% Community & Ecosystem\n🟣 20% Treasury & Operations\n🔵 15% Team (12-mo cliff)\n🟢 10% Liquidity\n🔷 10% Staking Rewards\n🔴 5% Strategic Partners\n\nCommunity gets the largest share. Always.\n\nFull details: freedomforge-max.up.railway.app/token`,
      hashtags: [...TOKEN_HASHTAGS, '#Tokenomics'],
      targetAudience: 'DeFi analysts, investors',
      priority: 8,
    },
    {
      id: 'tokenomics-2',
      category: 'tokenomics',
      template: `$FORGE is deflationary by design:\n\n• Query burns: 0.1% of premium AI queries\n• Accuracy burns: bad forecasts = token burns\n• Quarterly treasury burns\n• 15% of revenue goes to buyback & burn\n\nYear 5+: burns > emissions.\n\nFixed supply that gets smaller over time.`,
      hashtags: [...TOKEN_HASHTAGS, '#Deflationary', '#BurnMechanism'],
      targetAudience: 'tokenomics enthusiasts',
      priority: 7,
    },
  ];
}

/**
 * Staking promotion posts.
 */
function getStakingPosts(): TokenMarketingPost[] {
  return [
    {
      id: 'staking-1',
      category: 'staking',
      template: `Stake $FORGE. Unlock the full AI stack.\n\n🥉 Bronze (1K): 5-model consensus\n🥈 Silver (10K): 7-model + priority queue\n🥇 Gold (100K): 13+ model ensemble\n💎 Platinum (1M): Max Intelligence mode\n\nPlus: 20% of trading profits distributed weekly to all stakers.\n\nNo lockup. Unstake anytime.`,
      hashtags: [...TOKEN_HASHTAGS, '#Staking', '#PassiveIncome'],
      targetAudience: 'DeFi yield farmers, AI users',
      priority: 8,
    },
    {
      id: 'staking-2',
      category: 'staking',
      template: `What Platinum stakers get:\n\n→ Max Intelligence mode (5-model ensembles)\n→ Custom model routing per query\n→ Dedicated inference capacity\n→ Weekly revenue share (pro-rata)\n→ Priority governance voting weight\n\nThe most powerful AI access on Earth, gated by $FORGE.\n\nNo subscription. Just stake.`,
      hashtags: [...TOKEN_HASHTAGS, '#AIAccess'],
      targetAudience: 'power users, whales',
      priority: 7,
    },
  ];
}

/**
 * Governance posts.
 */
function getGovernancePosts(): TokenMarketingPost[] {
  return [
    {
      id: 'governance-1',
      category: 'governance',
      template: `$FORGE holders decide:\n\n• Which AI models get priority routing\n• Risk parameters (circuit breakers, limits)\n• Treasury allocation\n• New chain integrations\n• Fee structure changes\n\n1 FORGE = 1 vote.\n\nDecentralized AI governance isn't a concept. It's live.`,
      hashtags: [...TOKEN_HASHTAGS, '#Governance', '#DAO'],
      targetAudience: 'governance enthusiasts, DAO members',
      priority: 7,
    },
  ];
}

/**
 * Revenue share posts.
 */
function getRevenueSharePosts(): TokenMarketingPost[] {
  return [
    {
      id: 'revenue-1',
      category: 'revenue-share',
      template: `Every Friday, FreedomForge distributes trading profits.\n\n20% goes directly to $FORGE stakers.\n\nThis isn't a promise. The distribution system has been running autonomously with:\n• Multi-recipient payout\n• Gas-optimized execution\n• Sharded horizontal scaling\n• Fail-safe retry logic\n\nReal yield from real AI trading.`,
      hashtags: [...TOKEN_HASHTAGS, '#RealYield', '#PassiveIncome'],
      targetAudience: 'yield seekers, DeFi users',
      priority: 8,
    },
  ];
}

/**
 * Multi-chain expansion posts.
 */
function getMultiChainPosts(): TokenMarketingPost[] {
  return [
    {
      id: 'multichain-1',
      category: 'multi-chain',
      template: `$FORGE goes multi-chain:\n\nPhase 1 (Launch): Ethereum + Base\nPhase 2 (3 months): Polygon + Arbitrum\nPhase 3 (6 months): Solana + MultiversX\n\nMatching FreedomForge's existing multi-chain trading infrastructure.\n\nOne token. Every chain. Maximum reach.`,
      hashtags: [...TOKEN_HASHTAGS, '#MultiChain', '#Interoperability'],
      targetAudience: 'multi-chain users',
      priority: 6,
    },
  ];
}

/**
 * Community growth posts.
 */
function getCommunityPosts(): TokenMarketingPost[] {
  return [
    {
      id: 'community-1',
      category: 'community',
      template: `Earn $FORGE by making FreedomForge smarter.\n\nContribute knowledge to the skills matrix:\n• Ingest quality documents → earn tokens\n• Quality score multipliers (0.5x to 3x)\n• Auto-discover new skill domains → discovery bounties\n\nThe knowledge base has 1M document capacity.\n\nHelp build the world's smartest AI. Get rewarded.`,
      hashtags: [...TOKEN_HASHTAGS, '#ContributeToEarn', '#KnowledgeBase'],
      targetAudience: 'researchers, data scientists',
      priority: 7,
    },
    {
      id: 'community-2',
      category: 'community',
      template: `40% of $FORGE supply goes to the community.\n\nThat's 400,000,000 tokens for:\n• Early user airdrops\n• Knowledge base contributors\n• Prediction market participants\n• Ecosystem builders\n• Governance participants\n\nThe community IS the product.\n\nBuild with us: freedomforge-max.up.railway.app`,
      hashtags: [...TOKEN_HASHTAGS, '#Airdrop', '#Community'],
      targetAudience: 'airdrop hunters, community builders',
      priority: 8,
    },
  ];
}

/**
 * Educational posts about AI + crypto intersection.
 */
function getEducationalPosts(): TokenMarketingPost[] {
  return [
    {
      id: 'edu-1',
      category: 'educational',
      template: `Why multi-model consensus matters for trading:\n\nSingle AI model accuracy: ~72%\nMulti-model consensus (3): ~84%\nFull ensemble (13+): ~91%\n\n$FORGE stakers get access to the full ensemble.\n\nMore models = more agreement = higher confidence.\n\nThis is why we built FreedomForge Max.`,
      hashtags: [...TOKEN_HASHTAGS, '#AITrading', '#MachineLearning'],
      targetAudience: 'quant traders, AI researchers',
      priority: 6,
    },
    {
      id: 'edu-2',
      category: 'educational',
      template: `The AI app market is exploding:\n\n• $5B+ consumer spending in 2025 (3x YoY)\n• 48B hours spent in AI apps\n• $10B+ forecast for 2026\n• Gen AI rising to #4 in downloads\n\n$FORGE positions you at the center of this wave.\n\nNot another chatbot wrapper. A full autonomous intelligence stack.`,
      hashtags: [...TOKEN_HASHTAGS, '#AIMarket', '#Growth'],
      targetAudience: 'investors, market analysts',
      priority: 7,
    },
  ];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Ecosystem partnership posts.
 */
function getEcosystemPosts(): TokenMarketingPost[] {
  return [
    {
      id: 'eco-1',
      category: 'milestone',
      template: `FreedomForge ecosystem growing:\n\n→ Alchemy (live) — multi-chain wallet ops\n→ Polymarket (live) — prediction markets\n→ NVIDIA NIM (live) — GPU inference\n→ Helius (building) — Solana infrastructure\n→ MultiversX (live) — ESDT tokens\n→ Aethir (planned) — decentralized GPU\n→ AgentPay SDK (researching) — agent payments\n\n14 partners. 6 chains. One stack.`,
      hashtags: [...TOKEN_HASHTAGS, '#Ecosystem', '#DeFAI'],
      targetAudience: 'DeFi builders, infrastructure enthusiasts',
      priority: 8,
    },
    {
      id: 'eco-2',
      category: 'milestone',
      template: `The DeFAI market is $15B+ and growing 46% CAGR to $52B by 2030.\n\nFreedomForge Max is:\n✓ 13+ AI models live\n✓ Multi-chain trading active\n✓ Autonomous distribution running\n✓ Skills matrix learning 24/7\n✓ $FORGE token ready\n\nNot watching from the sidelines. Building the infrastructure.`,
      hashtags: [...TOKEN_HASHTAGS, '#DeFAI', '#AIAgents'],
      targetAudience: 'crypto investors, AI enthusiasts',
      priority: 9,
    },
    {
      id: 'eco-3',
      category: 'educational',
      template: `2026 AI agent standards FreedomForge is adopting:\n\n• ERC-8004: On-chain agent identity\n• EIP-7702: Safe trading without exposing keys\n• x402: Machine-to-machine payments\n• AgentPay SDK: Policy-enforced autonomy\n\nResponsible autonomous AI isn't optional. It's the foundation.\n\n$FORGE governance decides the guardrails.`,
      hashtags: [...TOKEN_HASHTAGS, '#AIAgents', '#ERC8004'],
      targetAudience: 'developers, standards enthusiasts',
      priority: 7,
    },
    {
      id: 'eco-4',
      category: 'milestone',
      template: `FreedomForge compute strategy:\n\nCloud: Claude, GPT-4, Gemini, Grok (13+ providers)\nEdge: NVIDIA NIM, Cerebras, Groq\nLocal: Ollama (zero data egress)\nDePIN: Aethir, Akash, Render (planned)\nOn-Device: Apple Foundation Models ready\n\nWhen centralized fails, decentralized catches.\nWhen cloud is expensive, local is free.\n\n$FORGE stakers choose the routing.`,
      hashtags: [...TOKEN_HASHTAGS, '#DePIN', '#AICompute'],
      targetAudience: 'AI infrastructure enthusiasts, DePIN community',
      priority: 8,
    },
  ];
}

/**
 * Get all token marketing posts, optionally filtered by category.
 */
export function getTokenMarketingPosts(category?: TokenContentCategory): TokenMarketingPost[] {
  const all = [
    ...getTokenLaunchPosts(),
    ...getTokenomicsPosts(),
    ...getStakingPosts(),
    ...getGovernancePosts(),
    ...getRevenueSharePosts(),
    ...getMultiChainPosts(),
    ...getCommunityPosts(),
    ...getEducationalPosts(),
    ...getEcosystemPosts(),
  ];

  if (category) return all.filter((p) => p.category === category);
  return all;
}

/**
 * Get a random token marketing post, weighted by priority.
 */
export function getRandomTokenPost(category?: TokenContentCategory): TokenMarketingPost {
  const posts = getTokenMarketingPosts(category);
  // Priority-weighted random selection
  const totalWeight = posts.reduce((sum, p) => sum + p.priority, 0);
  let random = Math.random() * totalWeight;

  for (const post of posts) {
    random -= post.priority;
    if (random <= 0) return post;
  }

  return posts[posts.length - 1];
}

/**
 * Format a post for X/Twitter (280 char limit awareness).
 */
export function formatForX(post: TokenMarketingPost): { text: string; hashtags: string } {
  const hashtagStr = post.hashtags.slice(0, 4).join(' ');
  const maxTextLen = 280 - hashtagStr.length - 2; // 2 for newlines
  const text = post.template.length > maxTextLen
    ? post.template.slice(0, maxTextLen - 3) + '...'
    : post.template;

  return { text: `${text}\n\n${hashtagStr}`, hashtags: hashtagStr };
}

/**
 * Get post count by category for analytics.
 */
export function getTokenContentStats() {
  const all = getTokenMarketingPosts();
  const byCategory: Record<string, number> = {};
  for (const post of all) {
    byCategory[post.category] = (byCategory[post.category] || 0) + 1;
  }
  return {
    totalPosts: all.length,
    byCategory,
    avgPriority: all.reduce((sum, p) => sum + p.priority, 0) / all.length,
  };
}
