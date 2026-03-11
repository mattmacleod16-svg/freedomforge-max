/**
 * Vector Database & RAG System
 * Stores and retrieves knowledge from open-source datasets
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

interface VectorDoc {
  id: string;
  text: string;
  source: string;
  category: string;
  metadata?: Record<string, unknown>;
  vector?: number[];
  contentHash?: string;
  createdAt?: number;
  updatedAt?: number;
  expiresAt?: number;
  qualityScore?: number;
  sourceReliability?: number;
}

interface RAGResult {
  content: string;
  source: string;
  relevance: number;
  category: string;
}

/**
 * Simple in-memory vector store (production should use Pinecone/Weaviate)
 * For MVP: stores documents with simple similarity search
 */
class VectorStore {
  private docs: VectorDoc[] = [];
  private storePath = path.join(process.cwd(), 'data', 'knowledge-base.json');
  private readonly vectorDimensions = 96;
  private readonly docTtlMs = Math.max(1, Number(process.env.KB_DOC_TTL_DAYS || 365)) * 24 * 60 * 60 * 1000;
  private readonly recencyHalfLifeDays = Math.max(1, Number(process.env.KB_RECENCY_HALF_LIFE_DAYS || 30));

  async initialize() {
    try {
      // Load persisted knowledge base
      if (fs.existsSync(this.storePath)) {
        const data = fs.readFileSync(this.storePath, 'utf-8');
        const raw = JSON.parse(data) as VectorDoc[];
        this.docs = raw.map((doc) => this.normalizeDoc(doc));
        const hadExpired = this.cleanupExpiredDocuments();
        if (hadExpired) await this.persist();
        console.log(`Loaded ${this.docs.length} documents from knowledge base`);
      }
    } catch (error) {
      console.error('Error loading knowledge base:', error);
    }
  }

  async addDocument(doc: VectorDoc) {
    const normalized = this.normalizeDoc(doc);
    const existingIndex = this.docs.findIndex((row) => row.contentHash === normalized.contentHash);

    if (existingIndex >= 0) {
      const existing = this.docs[existingIndex];
      this.docs[existingIndex] = {
        ...existing,
        ...normalized,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      };
    } else {
      this.docs.push(normalized);
    }

    await this.persist();
  }

  async addDocuments(docs: VectorDoc[]) {
    for (const doc of docs) {
      const normalized = this.normalizeDoc(doc);
      const existingIndex = this.docs.findIndex((row) => row.contentHash === normalized.contentHash);
      if (existingIndex >= 0) {
        const existing = this.docs[existingIndex];
        this.docs[existingIndex] = {
          ...existing,
          ...normalized,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: Date.now(),
        };
      } else {
        this.docs.push(normalized);
      }
    }
    await this.persist();
  }

  private async persist() {
    try {
      const docsDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
      }
      fs.writeFileSync(this.storePath, JSON.stringify(this.docs, null, 2));
    } catch (error) {
      console.error('Error persisting knowledge base:', error);
    }
  }

  /**
   * Hybrid search: lexical + vector + recency/reliability weighting
   */
  search(query: string, topK: number = 5): RAGResult[] {
    const normalizedQuery = this.normalizeText(query);
    const queryTerms = this.tokenize(normalizedQuery);
    const queryVector = this.embed(normalizedQuery);
    const now = Date.now();

    const scoredDocs = this.docs
      .map((doc) => {
        const normalizedDoc = this.normalizeText(doc.text);
        const docTerms = this.tokenize(normalizedDoc);

        const lexical = this.keywordScore(queryTerms, docTerms, normalizedDoc.includes(normalizedQuery));
        const semantic = this.cosineSimilarity(queryVector, doc.vector || this.embed(normalizedDoc));
        const recency = this.recencyScore(doc.updatedAt || doc.createdAt || now, now);
        const quality = this.clamp(doc.qualityScore ?? 0.72);
        const reliability = this.clamp(doc.sourceReliability ?? this.defaultSourceReliability(doc.source));

        const score = (0.42 * lexical) + (0.38 * semantic) + (0.12 * recency) + (0.08 * quality * reliability);
        return { doc, score };
      })
      .filter((item) => item.score >= 0.08)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scoredDocs.map((item) => ({
      content: item.doc.text,
      source: item.doc.source,
      relevance: this.clamp(item.score),
      category: item.doc.category,
    }));
  }

  getStats() {
    const categories = new Set(this.docs.map((d) => d.category));
    const sources = new Set(this.docs.map((d) => d.source));
    const now = Date.now();

    const averageAgeDays = this.docs.length > 0
      ? this.docs.reduce((sum, doc) => {
        const ts = doc.updatedAt || doc.createdAt || now;
        return sum + ((now - ts) / (24 * 60 * 60 * 1000));
      }, 0) / this.docs.length
      : 0;

    return {
      totalDocuments: this.docs.length,
      categories: Array.from(categories),
      sources: Array.from(sources),
      averageAgeDays: Number(averageAgeDays.toFixed(2)),
    };
  }

  private normalizeDoc(input: VectorDoc): VectorDoc {
    const text = input.text.trim();
    const now = Date.now();
    const createdAt = input.createdAt || now;
    const updatedAt = input.updatedAt || now;
    const contentHash = input.contentHash || this.hash(text);
    const expiresAt = input.expiresAt || (updatedAt + this.docTtlMs);
    const qualityScore = this.clamp(input.qualityScore ?? 0.72);
    const sourceReliability = this.clamp(input.sourceReliability ?? this.defaultSourceReliability(input.source));
    const vector = input.vector || this.embed(this.normalizeText(text));

    return {
      ...input,
      text,
      metadata: input.metadata || {},
      contentHash,
      createdAt,
      updatedAt,
      expiresAt,
      qualityScore,
      sourceReliability,
      vector,
    };
  }

  private cleanupExpiredDocuments() {
    const now = Date.now();
    const before = this.docs.length;
    this.docs = this.docs.filter((doc) => (doc.expiresAt || now + 1) > now);
    return this.docs.length !== before;
  }

  private hash(text: string) {
    return createHash('sha256').update(text).digest('hex').slice(0, 24);
  }

  private normalizeText(text: string) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private tokenize(text: string) {
    return text.split(' ').filter((token) => token.length > 1);
  }

  private embed(text: string) {
    const vector = new Array<number>(this.vectorDimensions).fill(0);
    const tokens = this.tokenize(text);
    if (tokens.length === 0) return vector;

    tokens.forEach((token, index) => {
      const digest = createHash('sha1').update(`${token}:${index % 17}`).digest();
      const slot = digest[0] % this.vectorDimensions;
      const sign = (digest[1] & 1) === 0 ? 1 : -1;
      const magnitude = (digest[2] / 255) + 0.5;
      vector[slot] += sign * magnitude;
    });

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
    if (norm === 0) return vector;
    return vector.map((value) => value / norm);
  }

  private keywordScore(queryTerms: string[], docTerms: string[], exactMatch: boolean) {
    if (queryTerms.length === 0 || docTerms.length === 0) return 0;
    const termSet = new Set(docTerms);
    let hits = 0;
    for (const term of queryTerms) {
      if (termSet.has(term)) {
        hits += 1;
        continue;
      }
      if (docTerms.some((token) => token.includes(term) || term.includes(token))) hits += 0.6;
    }

    const base = hits / queryTerms.length;
    return this.clamp(exactMatch ? base * 1.2 : base);
  }

  private cosineSimilarity(a: number[], b: number[]) {
    const size = Math.min(a.length, b.length);
    if (size === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < size; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return this.clamp(dot / (Math.sqrt(normA) * Math.sqrt(normB)));
  }

  private recencyScore(timestamp: number, now: number) {
    const ageDays = Math.max(0, (now - timestamp) / (24 * 60 * 60 * 1000));
    const decay = Math.exp(-Math.log(2) * (ageDays / this.recencyHalfLifeDays));
    return this.clamp(decay);
  }

  private defaultSourceReliability(source: string) {
    const normalized = source.toLowerCase();
    if (normalized.includes('arxiv') || normalized.includes('research')) return 0.9;
    if (normalized.includes('wikipedia')) return 0.76;
    if (normalized.includes('github')) return 0.72;
    if (normalized.includes('stack')) return 0.68;
    return 0.65;
  }

  private clamp(value: number, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }
}

const vectorStore = new VectorStore();

/**
 * Initialize RAG system
 */
export async function initializeRAG() {
  await vectorStore.initialize();
}

/**
 * Search knowledge base using RAG
 */
export async function queryKnowledgeBase(query: string): Promise<RAGResult[]> {
  return vectorStore.search(query, 5);
}

/**
 * Add context to prompt from knowledge base
 */
export async function enhancePromptWithKnowledgeBase(prompt: string): Promise<string> {
  const results = await queryKnowledgeBase(prompt);

  if (results.length === 0) {
    return prompt;
  }

  const context = results
    .map(
      (r) =>
        `[${r.category} - ${r.source}] (relevance: ${(r.relevance * 100).toFixed(0)}%)\n${r.content}`
    )
    .join('\n\n');

  return `${prompt}\n\n---\nRelevant knowledge base context:\n${context}`;
}

/**
 * Get stats about knowledge base
 */
export function getKnowledgeBaseStats() {
  return vectorStore.getStats();
}

/**
 * Add documents from various sources
 */
export async function loadOpenSourceData() {
  const datasets: VectorDoc[] = [];

  // Wikipedia summaries (you would download these)
  const wikiDocs = [
    {
      id: 'wiki-ai-001',
      text: 'Artificial Intelligence (AI) is intelligence demonstrated by machines, as opposed to natural intelligence displayed by animals and humans. AI research has been defined as the field of study of intelligent agents, which refers to any system that perceives its environment and takes actions that maximize its chance of success at some goal.',
      source: 'Wikipedia',
      category: 'AI/ML',
    },
    {
      id: 'wiki-ml-001',
      text: 'Machine learning is a subset of artificial intelligence that provides systems the ability to automatically learn and improve from experience without being explicitly programmed. Machine learning focuses on the development of algorithms and statistical models that computers use to perform specific tasks.',
      source: 'Wikipedia',
      category: 'AI/ML',
    },
  ];

  // Stack Overflow / GitHub insights
  const techDocs = [
    {
      id: 'tech-001',
      text: 'REST APIs (Representational State Transfer) are architectural styles for designing networked applications. They rely on a stateless, client-server communication protocol over HTTP. Best practices include using proper HTTP methods (GET, POST, PUT, DELETE), meaningful URLs, and consistent response formats.',
      source: 'Stack Overflow',
      category: 'Web Development',
    },
    {
      id: 'tech-002',
      text: 'React is a JavaScript library for building user interfaces using components. It uses a virtual DOM for efficient updates and follows a declarative programming style. Key concepts include hooks, state management, and lifecycle methods.',
      source: 'GitHub Docs',
      category: 'Frontend',
    },
  ];

  // ArXiv paper summaries (you would ingest actual papers)
  const researchDocs = [
    {
      id: 'arxiv-001',
      text: 'Transformer models have revolutionized natural language processing by introducing the attention mechanism. Instead of recurrent connections, transformers process sequences in parallel, making them more efficient and better suited for large-scale training.',
      source: 'ArXiv',
      category: 'Research',
    },
  ];

  datasets.push(...wikiDocs, ...techDocs, ...researchDocs);

  // Add to vector store
  await vectorStore.addDocuments(datasets);
  console.log(`Loaded ${datasets.length} documents into knowledge base`);
}

/**
 * Ingest custom documents
 */
export async function ingestDocument(
  text: string,
  source: string,
  category: string,
  options?: {
    metadata?: Record<string, unknown>;
    qualityScore?: number;
    sourceReliability?: number;
    expiresAt?: number;
  }
) {
  const doc: VectorDoc = {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    text,
    source,
    category,
    metadata: {
      timestamp: new Date().toISOString(),
      ...(options?.metadata || {}),
    },
    qualityScore: options?.qualityScore,
    sourceReliability: options?.sourceReliability,
    expiresAt: options?.expiresAt,
  };

  await vectorStore.addDocument(doc);
  return doc.id;
}
