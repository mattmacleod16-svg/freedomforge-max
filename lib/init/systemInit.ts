/**
 * System Initialization
 * Runs on app startup to initialize all systems
 */

import { initializeSynthesis } from '@/lib/synthesis/orchestrator';
import { loadBuiltInDatasets, fetchAndIngestWikipediaCategory, fetchAndIngestArXivPapers, fetchAndIngestGitHubTrending } from '@/lib/ingestion/dataLoader';
import { initAlchemy } from '@/lib/alchemy/connector';

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Full system initialization
 */
export async function initializeSystem(): Promise<void> {
  if (isInitialized) {
    return;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = performInitialization();
  return initializationPromise;
}

async function performInitialization(): Promise<void> {
  console.log('\n🚀 Initializing FreedomForge Max Intelligence System...\n');

  try {
    // 0. Initialize Alchemy if available
    if (process.env.ALCHEMY_API_KEY) {
      console.log('0️⃣  Initializing Alchemy connector...');
      initAlchemy();
      console.log('   ✅ Alchemy ready');
    }

    // 1. Initialize synthesis engine (models + RAG)
    console.log('1️⃣  Initializing synthesis engine...');
    await initializeSynthesis();
    console.log('   ✅ Synthesis engine ready\n');

    // 2. Load initial knowledge base
    console.log('2️⃣  Loading knowledge base...');
    await loadBuiltInDatasets();
    console.log('   ✅ Built-in datasets loaded\n');

    // 3. Optional: Load extended datasets if configured
    if (process.env.KB_AUTO_LOAD_DATASETS === 'true') {
      console.log('3️⃣  Loading extended datasets...\n');

      if (process.env.KB_INCLUDE_WIKIPEDIA === 'true') {
        try {
          console.log('   Fetching Wikipedia articles...');
          await fetchAndIngestWikipediaCategory('Machine_learning');
          console.log('   ✅ Wikipedia loaded');
        } catch (e) {
          console.log('   ⚠️  Wikipedia load skipped');
        }
      }

      if (process.env.KB_INCLUDE_ARXIV === 'true') {
        try {
          console.log('   Fetching ArXiv papers...');
          await fetchAndIngestArXivPapers('cs.AI', 3);
          console.log('   ✅ ArXiv loaded');
        } catch (e) {
          console.log('   ⚠️  ArXiv load skipped');
        }
      }

      if (process.env.KB_INCLUDE_GITHUB === 'true') {
        try {
          console.log('   Fetching GitHub repos...');
          await fetchAndIngestGitHubTrending();
          console.log('   ✅ GitHub loaded');
        } catch (e) {
          console.log('   ⚠️  GitHub load skipped');
        }
      }
    }

    isInitialized = true;

    console.log('\n✨ FreedomForge Max Ready! Intelligence systems online.\n');
    console.log('📊 System capabilities:');
    console.log('   🤖 Multiple AI Models (Grok, OpenAI, Anthropic, Local)');
    console.log('   🔍 Real-time Web Search (Tavily)');
    console.log('   📚 Knowledge Base with RAG');
    console.log('   🌐 Open-source Data Integration');
    console.log('   🧠 Knowledge Synthesis Engine\n');
  } catch (error) {
    console.error('❌ System initialization failed:', error);
    throw error;
  }
}

export function isSystemInitialized(): boolean {
  return isInitialized;
}
