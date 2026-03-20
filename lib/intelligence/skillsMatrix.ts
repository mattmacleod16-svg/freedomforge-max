/**
 * Skills Matrix & Limitless Knowledge Base — FreedomForge Max.
 * ═══════════════════════════════════════════════════════════════
 *
 * A self-expanding competency framework that tracks what FreedomForge can do,
 * how well it does it, and what it needs to learn next:
 *
 *  • Skill Registry — every capability with confidence scoring & validation
 *  • Domain Graph — interdependencies between skill domains
 *  • Knowledge Partitions — sharded storage for unlimited growth
 *  • Auto-Discovery — new skills registered when the system encounters novel domains
 *  • Proficiency Tracking — Elo-like scoring from real outcomes
 *  • Gap Analysis — identifies what FreedomForge can't yet do well
 *
 * This powers the "smartest and most robust AI Model" vision by:
 *  1. Knowing exactly where FreedomForge excels (route queries there)
 *  2. Knowing exactly where it's weak (route to stronger models or flag for learning)
 *  3. Growing without bound (partition-based storage, no hard caps on knowledge)
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

// ─── Configuration ────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SKILLS_DIR = path.join(DATA_DIR, 'skills');
const MATRIX_FILE = path.join(SKILLS_DIR, 'skills-matrix.json');
const KB_INDEX_FILE = path.join(SKILLS_DIR, 'kb-index.json');
const PARTITION_DIR = path.join(SKILLS_DIR, 'partitions');

const MAX_DOCS_PER_PARTITION = 2000;
const MAX_PARTITIONS = 500;  // 500 × 2000 = 1M documents capacity
const INITIAL_ELO = 1200;
const K_FACTOR = 32;

// ─── Types ────────────────────────────────────────────────────────────────────

export type SkillLevel = 'novice' | 'competent' | 'proficient' | 'expert' | 'master';
export type SkillStatus = 'active' | 'learning' | 'planned' | 'deprecated';

export interface Skill {
  id: string;
  name: string;
  domain: string;
  subdomain?: string;
  description: string;
  status: SkillStatus;
  level: SkillLevel;
  elo: number;                    // Elo-like proficiency rating
  confidence: number;             // 0-1 confidence in self-assessment
  successCount: number;
  failureCount: number;
  lastUsedAt: number;
  lastTrainedAt: number;
  prerequisites: string[];        // Skill IDs that must be mastered first
  relatedSkills: string[];        // Complementary skills
  modelAffinities: string[];      // Which AI models are best for this skill
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SkillDomain {
  id: string;
  name: string;
  description: string;
  skills: string[];               // Skill IDs in this domain
  parentDomain?: string;
  childDomains: string[];
  overallElo: number;
  createdAt: number;
}

export interface SkillsMatrixState {
  version: number;
  skills: Record<string, Skill>;
  domains: Record<string, SkillDomain>;
  updatedAt: number;
}

export interface KBDocument {
  id: string;
  title: string;
  content: string;
  domain: string;
  skillIds: string[];
  source: string;
  contentHash: string;
  qualityScore: number;
  accessCount: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface KBPartition {
  id: string;
  domain: string;
  docCount: number;
  sizeBytes: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface KBIndex {
  version: number;
  partitions: KBPartition[];
  totalDocs: number;
  totalSizeBytes: number;
  domainPartitionMap: Record<string, string[]>;  // domain -> partition IDs
  updatedAt: number;
}

// ─── Persistence Helpers ──────────────────────────────────────────────────────

function ensureDirs() {
  for (const dir of [SKILLS_DIR, PARTITION_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJSON<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { /* fallback */ }
  return fallback;
}

function saveJSON(filePath: string, data: unknown) {
  ensureDirs();
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ─── Elo Rating System ────────────────────────────────────────────────────────

function eloExpected(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function eloUpdate(rating: number, expected: number, actual: number): number {
  return Math.round(rating + K_FACTOR * (actual - expected));
}

function eloToLevel(elo: number): SkillLevel {
  if (elo >= 2000) return 'master';
  if (elo >= 1700) return 'expert';
  if (elo >= 1400) return 'proficient';
  if (elo >= 1100) return 'competent';
  return 'novice';
}

// ─── Skills Matrix ────────────────────────────────────────────────────────────

function loadMatrix(): SkillsMatrixState {
  return loadJSON<SkillsMatrixState>(MATRIX_FILE, {
    version: 1,
    skills: {},
    domains: {},
    updatedAt: 0,
  });
}

function saveMatrix(state: SkillsMatrixState) {
  state.updatedAt = Date.now();
  state.version++;
  saveJSON(MATRIX_FILE, state);
}

/**
 * Register a new skill in the matrix.
 */
export function registerSkill(input: {
  name: string;
  domain: string;
  subdomain?: string;
  description: string;
  prerequisites?: string[];
  relatedSkills?: string[];
  modelAffinities?: string[];
  tags?: string[];
}): Skill {
  const state = loadMatrix();
  const id = `skill_${hashContent(input.name + input.domain)}`;

  if (state.skills[id]) {
    // Update existing
    const existing = state.skills[id];
    existing.description = input.description;
    existing.tags = input.tags || existing.tags;
    existing.updatedAt = Date.now();
    saveMatrix(state);
    return existing;
  }

  const skill: Skill = {
    id,
    name: input.name,
    domain: input.domain,
    subdomain: input.subdomain,
    description: input.description,
    status: 'active',
    level: 'novice',
    elo: INITIAL_ELO,
    confidence: 0.5,
    successCount: 0,
    failureCount: 0,
    lastUsedAt: 0,
    lastTrainedAt: 0,
    prerequisites: input.prerequisites || [],
    relatedSkills: input.relatedSkills || [],
    modelAffinities: input.modelAffinities || [],
    tags: input.tags || [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  state.skills[id] = skill;

  // Ensure domain exists
  if (!state.domains[input.domain]) {
    state.domains[input.domain] = {
      id: input.domain,
      name: input.domain,
      description: `Skills in the ${input.domain} domain`,
      skills: [],
      childDomains: [],
      overallElo: INITIAL_ELO,
      createdAt: Date.now(),
    };
  }
  if (!state.domains[input.domain].skills.includes(id)) {
    state.domains[input.domain].skills.push(id);
  }

  saveMatrix(state);
  return skill;
}

/**
 * Record an outcome for a skill (success or failure) and update Elo.
 */
export function recordOutcome(skillId: string, success: boolean, difficulty = 1200): Skill | null {
  const state = loadMatrix();
  const skill = state.skills[skillId];
  if (!skill) return null;

  const expected = eloExpected(skill.elo, difficulty);
  const actual = success ? 1 : 0;
  skill.elo = eloUpdate(skill.elo, expected, actual);
  skill.level = eloToLevel(skill.elo);

  if (success) {
    skill.successCount++;
  } else {
    skill.failureCount++;
  }

  skill.confidence = skill.successCount / Math.max(1, skill.successCount + skill.failureCount);
  skill.lastUsedAt = Date.now();
  skill.updatedAt = Date.now();

  // Update domain Elo
  const domain = state.domains[skill.domain];
  if (domain) {
    const domainSkills = domain.skills.map((id) => state.skills[id]).filter(Boolean);
    domain.overallElo = domainSkills.length > 0
      ? Math.round(domainSkills.reduce((sum, s) => sum + s.elo, 0) / domainSkills.length)
      : INITIAL_ELO;
  }

  saveMatrix(state);
  return skill;
}

/**
 * Auto-discover a skill from a query context.
 * Called when the system encounters a novel domain.
 */
export function autoDiscoverSkill(query: string, domain: string, modelUsed: string): Skill {
  const name = query.slice(0, 60).replace(/[^a-zA-Z0-9\s-]/g, '').trim();
  return registerSkill({
    name: name || 'Unnamed Skill',
    domain,
    description: `Auto-discovered from query: "${query.slice(0, 100)}"`,
    modelAffinities: [modelUsed],
    tags: ['auto-discovered'],
  });
}

/**
 * Find the best model for a given skill based on historical affinities.
 */
export function getBestModelForSkill(skillId: string): string[] {
  const state = loadMatrix();
  const skill = state.skills[skillId];
  if (!skill) return [];
  return skill.modelAffinities;
}

/**
 * Gap analysis — find skills below a threshold or never used.
 */
export function getSkillGaps(options?: { minElo?: number; maxAge?: number }): Skill[] {
  const state = loadMatrix();
  const minElo = options?.minElo || 1200;
  const maxAge = options?.maxAge || 30 * 24 * 60 * 60 * 1000; // 30 days

  return Object.values(state.skills).filter((skill) => {
    if (skill.elo < minElo) return true;
    if (skill.lastUsedAt === 0) return true;
    if (Date.now() - skill.lastUsedAt > maxAge) return true;
    return false;
  }).sort((a, b) => a.elo - b.elo);
}

/**
 * Get full skills matrix summary.
 */
export function getMatrixSummary() {
  const state = loadMatrix();
  const skills = Object.values(state.skills);
  const domains = Object.values(state.domains);

  const byLevel: Record<SkillLevel, number> = { novice: 0, competent: 0, proficient: 0, expert: 0, master: 0 };
  for (const s of skills) byLevel[s.level]++;

  return {
    version: state.version,
    totalSkills: skills.length,
    totalDomains: domains.length,
    byLevel,
    avgElo: skills.length > 0 ? Math.round(skills.reduce((sum, s) => sum + s.elo, 0) / skills.length) : 0,
    topSkills: skills.sort((a, b) => b.elo - a.elo).slice(0, 10).map((s) => ({
      name: s.name,
      domain: s.domain,
      elo: s.elo,
      level: s.level,
      confidence: s.confidence,
    })),
    weakestSkills: skills.sort((a, b) => a.elo - b.elo).slice(0, 10).map((s) => ({
      name: s.name,
      domain: s.domain,
      elo: s.elo,
      level: s.level,
      confidence: s.confidence,
    })),
    domains: domains.map((d) => ({
      name: d.name,
      skillCount: d.skills.length,
      overallElo: d.overallElo,
    })),
    updatedAt: state.updatedAt,
  };
}

// ─── Partitioned Knowledge Base ───────────────────────────────────────────────

function loadKBIndex(): KBIndex {
  return loadJSON<KBIndex>(KB_INDEX_FILE, {
    version: 1,
    partitions: [],
    totalDocs: 0,
    totalSizeBytes: 0,
    domainPartitionMap: {},
    updatedAt: 0,
  });
}

function saveKBIndex(index: KBIndex) {
  index.updatedAt = Date.now();
  index.version++;
  saveJSON(KB_INDEX_FILE, index);
}

function getPartitionPath(partitionId: string): string {
  return path.join(PARTITION_DIR, `${partitionId}.json`);
}

function loadPartitionDocs(partitionId: string): KBDocument[] {
  return loadJSON<KBDocument[]>(getPartitionPath(partitionId), []);
}

function savePartitionDocs(partitionId: string, docs: KBDocument[]) {
  saveJSON(getPartitionPath(partitionId), docs);
}

/**
 * Find or create a partition for a given domain.
 */
function getOrCreatePartition(domain: string): string {
  const index = loadKBIndex();
  const existingIds = index.domainPartitionMap[domain] || [];

  // Find a partition with space
  for (const pid of existingIds) {
    const part = index.partitions.find((p) => p.id === pid);
    if (part && part.docCount < MAX_DOCS_PER_PARTITION) return pid;
  }

  // Create new partition
  if (index.partitions.length >= MAX_PARTITIONS) {
    // Evict oldest unused partition
    index.partitions.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    const evicted = index.partitions.shift();
    if (evicted) {
      try { fs.unlinkSync(getPartitionPath(evicted.id)); } catch { /* ok */ }
    }
  }

  const newId = `kb_${domain.replace(/[^a-z0-9]/gi, '_').slice(0, 20)}_${Date.now().toString(36)}`;
  const newPartition: KBPartition = {
    id: newId,
    domain,
    docCount: 0,
    sizeBytes: 0,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  };

  index.partitions.push(newPartition);
  if (!index.domainPartitionMap[domain]) index.domainPartitionMap[domain] = [];
  index.domainPartitionMap[domain].push(newId);
  saveKBIndex(index);

  return newId;
}

/**
 * Ingest a document into the partitioned knowledge base.
 */
export function ingestKnowledge(input: {
  title: string;
  content: string;
  domain: string;
  skillIds?: string[];
  source: string;
  qualityScore?: number;
  ttlDays?: number;
}): KBDocument {
  const contentHash = hashContent(input.content);
  const partitionId = getOrCreatePartition(input.domain);
  const docs = loadPartitionDocs(partitionId);

  // Dedup by content hash
  const existing = docs.find((d) => d.contentHash === contentHash);
  if (existing) {
    existing.accessCount++;
    existing.updatedAt = Date.now();
    savePartitionDocs(partitionId, docs);
    return existing;
  }

  const doc: KBDocument = {
    id: `doc_${Date.now().toString(36)}_${contentHash}`,
    title: input.title,
    content: input.content,
    domain: input.domain,
    skillIds: input.skillIds || [],
    source: input.source,
    contentHash,
    qualityScore: input.qualityScore || 0.5,
    accessCount: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + (input.ttlDays || 365) * 24 * 60 * 60 * 1000,
  };

  docs.push(doc);
  savePartitionDocs(partitionId, docs);

  // Update index
  const index = loadKBIndex();
  const part = index.partitions.find((p) => p.id === partitionId);
  if (part) {
    part.docCount = docs.length;
    part.sizeBytes = Buffer.byteLength(JSON.stringify(docs));
    part.lastAccessedAt = Date.now();
  }
  index.totalDocs++;
  saveKBIndex(index);

  return doc;
}

/**
 * Search the knowledge base across all partitions for a domain.
 */
export function searchKnowledge(query: string, domain?: string, limit = 10): KBDocument[] {
  const index = loadKBIndex();
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const results: { doc: KBDocument; score: number }[] = [];

  const partitionIds = domain
    ? (index.domainPartitionMap[domain] || [])
    : index.partitions.map((p) => p.id);

  for (const pid of partitionIds) {
    const docs = loadPartitionDocs(pid);
    for (const doc of docs) {
      if (doc.expiresAt < Date.now()) continue;

      const text = `${doc.title} ${doc.content}`.toLowerCase();
      const matchCount = queryTerms.filter((t) => text.includes(t)).length;
      if (matchCount === 0) continue;

      const termScore = matchCount / queryTerms.length;
      const qualityBonus = doc.qualityScore * 0.2;
      const accessBonus = Math.min(0.1, doc.accessCount / 100);
      const score = termScore * 0.7 + qualityBonus + accessBonus;

      results.push({ doc, score });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.doc);
}

/**
 * Get knowledge base summary.
 */
export function getKBSummary() {
  const index = loadKBIndex();
  return {
    version: index.version,
    totalDocs: index.totalDocs,
    totalPartitions: index.partitions.length,
    maxCapacity: MAX_PARTITIONS * MAX_DOCS_PER_PARTITION,
    utilizationPct: index.partitions.length > 0
      ? Number(((index.totalDocs / (MAX_PARTITIONS * MAX_DOCS_PER_PARTITION)) * 100).toFixed(2))
      : 0,
    totalSizeBytes: index.partitions.reduce((sum, p) => sum + p.sizeBytes, 0),
    domains: Object.entries(index.domainPartitionMap).map(([domain, pids]) => ({
      domain,
      partitions: pids.length,
      docs: index.partitions.filter((p) => pids.includes(p.id)).reduce((sum, p) => sum + p.docCount, 0),
    })),
    updatedAt: index.updatedAt,
  };
}

// ─── Bootstrap Core Skills ────────────────────────────────────────────────────

/**
 * Initialize the skills matrix with FreedomForge's core competencies.
 */
export function bootstrapCoreSkills() {
  const coreSkills = [
    // Financial Intelligence
    { name: 'Market Analysis', domain: 'finance', description: 'Real-time market regime detection, trend analysis, and signal generation', modelAffinities: ['grok', 'openai'], tags: ['core'] },
    { name: 'Portfolio Optimization', domain: 'finance', description: 'Multi-asset portfolio construction with risk-adjusted returns', modelAffinities: ['claude', 'openai'], tags: ['core'] },
    { name: 'Prediction Markets', domain: 'finance', description: 'Polymarket, Augur, Kalshi, and Overtime prediction market analysis', modelAffinities: ['grok', 'claude'], tags: ['core'] },
    { name: 'DeFi Yield Optimization', domain: 'finance', description: 'Cross-chain yield farming, liquidity provision, and APY maximization', modelAffinities: ['openai'], tags: ['core'] },
    { name: 'Risk Management', domain: 'finance', description: 'Circuit breakers, drawdown guards, position sizing, VaR calculation', modelAffinities: ['claude', 'openai'], tags: ['core'] },
    { name: 'Arbitrage Detection', domain: 'finance', description: 'Cross-exchange and cross-chain arbitrage opportunity scanning', modelAffinities: ['groq'], tags: ['core'] },

    // Blockchain Operations
    { name: 'Ethereum Operations', domain: 'blockchain', description: 'EVM transaction execution, gas optimization, smart contract interaction', modelAffinities: ['openai'], tags: ['core'] },
    { name: 'Solana Operations', domain: 'blockchain', description: 'Solana transaction execution and SPL token management', modelAffinities: ['openai'], tags: ['core'] },
    { name: 'Multi-Chain Routing', domain: 'blockchain', description: 'Cross-chain bridging, routing, and settlement across 7+ chains', modelAffinities: ['openai'], tags: ['core'] },
    { name: 'Wallet Management', domain: 'blockchain', description: 'Revenue wallet operations, balance tracking, and distribution', modelAffinities: ['openai'], tags: ['core'] },

    // AI & Reasoning
    { name: 'Multi-Model Consensus', domain: 'ai-reasoning', description: 'Route queries across 13+ models and synthesize agreement-scored responses', modelAffinities: ['claude', 'openai', 'grok'], tags: ['core'] },
    { name: 'Adaptive Complexity', domain: 'ai-reasoning', description: 'Lean/balanced/deep reasoning modes based on query impact', modelAffinities: ['claude'], tags: ['core'] },
    { name: 'Knowledge Synthesis', domain: 'ai-reasoning', description: 'Combine RAG, web search, and multi-model outputs into coherent answers', modelAffinities: ['claude', 'openai'], tags: ['core'] },
    { name: 'Forecasting', domain: 'ai-reasoning', description: 'Multi-horizon (6h/24h/72h) ensemble forecasts with Brier calibration', modelAffinities: ['grok', 'openai'], tags: ['core'] },

    // Intelligence & Monitoring
    { name: 'Geopolitical Risk', domain: 'intelligence', description: 'GDELT integration for real-time geopolitical event monitoring', modelAffinities: ['grok', 'claude'], tags: ['core'] },
    { name: 'Anomaly Detection', domain: 'intelligence', description: 'Market microstructure anomaly detection and alert generation', modelAffinities: ['openai'], tags: ['core'] },
    { name: 'Behavioral Analysis', domain: 'intelligence', description: 'Market participant behavior patterns and sentiment analysis', modelAffinities: ['claude'], tags: ['core'] },

    // Infrastructure
    { name: 'Self-Healing', domain: 'infrastructure', description: 'Automatic failover, health monitoring, and self-repair', modelAffinities: [], tags: ['core'] },
    { name: 'Data Ingestion', domain: 'infrastructure', description: 'Wikipedia, ArXiv, GitHub data loading and indexing', modelAffinities: [], tags: ['core'] },
    { name: 'Cross-Device Sync', domain: 'infrastructure', description: 'State reconciliation across iOS, web, and desktop platforms', modelAffinities: [], tags: ['core'] },

    // Global Reach
    { name: 'Multi-Language Support', domain: 'global', description: 'Query processing and response generation in multiple languages', modelAffinities: ['openai', 'gemini', 'claude'], tags: ['planned'] },
    { name: 'Regional Model Routing', domain: 'global', description: 'Route to region-appropriate models (US/EU/Asia) for compliance', modelAffinities: ['mistral', 'gemini'], tags: ['core'] },
    { name: 'Local Inference', domain: 'global', description: 'Ollama-based local model execution for air-gapped environments', modelAffinities: ['ollama'], tags: ['core'] },
  ];

  for (const skill of coreSkills) {
    registerSkill(skill);
  }
}
