/**
 * Vector Database & RAG System
 * Stores and retrieves knowledge from open-source datasets
 */

import * as fs from 'fs';
import * as path from 'path';

interface VectorDoc {
  id: string;
  text: string;
  source: string;
  category: string;
  metadata?: Record<string, any>;
  vector?: number[];
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

  async initialize() {
    try {
      // Load persisted knowledge base
      if (fs.existsSync(this.storePath)) {
        const data = fs.readFileSync(this.storePath, 'utf-8');
        this.docs = JSON.parse(data);
        console.log(`Loaded ${this.docs.length} documents from knowledge base`);
      }
    } catch (error) {
      console.error('Error loading knowledge base:', error);
    }
  }

  async addDocument(doc: VectorDoc) {
    this.docs.push(doc);
    await this.persist();
  }

  async addDocuments(docs: VectorDoc[]) {
    this.docs.push(...docs);
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
   * Simple text similarity search (BM25-like)
   */
  search(query: string, topK: number = 5): RAGResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/);

    const scoredDocs = this.docs
      .map((doc) => {
        const docTerms = doc.text.toLowerCase().split(/\s+/);
        let score = 0;

        for (const term of queryTerms) {
          const matches = docTerms.filter((dt) => dt.includes(term)).length;
          score += matches;
        }

        // Boost score for exact matches
        if (doc.text.toLowerCase().includes(query.toLowerCase())) {
          score *= 2;
        }

        return { doc, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scoredDocs.map((item) => ({
      content: item.doc.text,
      source: item.doc.source,
      relevance: Math.min(1, item.score / 10),
      category: item.doc.category,
    }));
  }

  getStats() {
    const categories = new Set(this.docs.map((d) => d.category));
    const sources = new Set(this.docs.map((d) => d.source));

    return {
      totalDocuments: this.docs.length,
      categories: Array.from(categories),
      sources: Array.from(sources),
    };
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
export async function ingestDocument(text: string, source: string, category: string) {
  const doc: VectorDoc = {
    id: `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    text,
    source,
    category,
    metadata: { timestamp: new Date().toISOString() },
  };

  await vectorStore.addDocument(doc);
  return doc.id;
}
