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
  type: 'wikipedia' | 'arxiv' | 'github' | 'stackoverflow' | 'builtin';
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
];

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

    const articles = data.query.categorymembers.slice(0, 10); // Limit to 10 for MVP

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

  try {
    const response = await fetchWithTimeout('https://api.github.com/search/repositories?q=stars:>10000&sort=stars&order=desc&per_page=5', {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    if (!response.ok) throw new Error(`GitHub: ${response.status}`);

    const data = await response.json();

    for (const repo of data.items || []) {
      const content = `
Repository: ${repo.full_name}
Description: ${repo.description || 'N/A'}
Language: ${repo.language || 'N/A'}
Stars: ${repo.stargazers_count}
URL: ${repo.html_url}
Topics: ${repo.topics?.join(', ') || 'N/A'}
`;

      await ingestDocument(content, 'GitHub', 'Repository', {
        qualityScore: 0.7,
        sourceReliability: 0.72,
        metadata: {
          fullName: repo.full_name,
          stars: repo.stargazers_count,
          fetchedAt: new Date().toISOString(),
        },
      });
      console.log(`  ✓ Ingested: ${repo.full_name}`);
    }

    markSourceRun('github:trending');
    console.log(`✅ Ingested ${data.items?.length || 0} repositories from GitHub`);
    return data.items?.length || 0;
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

  const results = {
    builtin: 0,
    wikipedia: 0,
    arxiv: 0,
    github: 0,
  };

  try {
    // Load built-in datasets
    await loadBuiltInDatasets();
    results.builtin = 3; // Example count

    // Wikipedia
    if (process.env.KB_INCLUDE_WIKIPEDIA === 'true') {
      results.wikipedia = await fetchAndIngestWikipediaCategory('Artificial_intelligence');
    }

    // ArXiv
    if (process.env.KB_INCLUDE_ARXIV === 'true') {
      results.arxiv = await fetchAndIngestArXivPapers('cs.AI', 5);
    }

    // GitHub
    if (process.env.KB_INCLUDE_GITHUB === 'true') {
      results.github = await fetchAndIngestGitHubTrending();
    }

    console.log('\n📊 Data Ingestion Summary:');
    console.log(`   Built-in datasets: ${results.builtin}`);
    console.log(`   Wikipedia articles: ${results.wikipedia}`);
    console.log(`   ArXiv papers: ${results.arxiv}`);
    console.log(`   GitHub repos: ${results.github}`);
    console.log(`   Total: ${results.builtin + results.wikipedia + results.arxiv + results.github}`);

    return results;
  } catch (error) {
    console.error('Data ingestion pipeline error:', error);
    throw error;
  }
}
