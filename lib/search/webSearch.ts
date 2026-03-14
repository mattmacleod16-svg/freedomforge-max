/**
 * Real-time Web Search Integration
 * Fetches latest information from web to enhance AI responses
 */

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface EnhancedPrompt {
  original: string;
  withContext: string;
  sources: SearchResult[];
}

/**
 * Use Tavily API for real-time web search
 * Tavily is optimized for AI/LLM search results
 */
export async function webSearch(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    console.warn('Tavily API key not configured. Install from: https://tavily.com');
    return [];
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: query,
          max_results: maxResults,
          include_answer: true,
          include_raw_content: true,
        }),
        signal: controller.signal,
      });

      const data = await response.json();
      if (!response.ok) return [];

      return (data.results || []).map((result: any) => ({
        title: result.title,
        url: result.url,
        snippet: result.content || result.description,
        source: new URL(result.url).hostname,
      }));
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.error('Web search error:', error);
    return [];
  }
}

/**
 * Fallback using DuckDuckGo (no API key needed)
 */
export async function webSearchFallback(query: string): Promise<SearchResult[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`,
        { signal: controller.signal }
      );
      if (!response.ok) return [];
      const data = await response.json();

      return (data.Results || [])
        .slice(0, 5)
        .map((result: any) => ({
          title: result.Text,
          url: result.FirstURL,
          snippet: result.Text,
          source: 'duckduckgo',
        }));
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.error('Fallback search error:', error);
    return [];
  }
}

/**
 * Perplexity Sonar Search — AI-native search with citations and real-time data.
 * Returns search-grounded answers with source citations.
 * Best for: market research, current prices, breaking news, regulatory updates.
 */
export async function perplexitySearch(query: string, options: {
  recencyFilter?: 'hour' | 'day' | 'week' | 'month';
  systemPrompt?: string;
} = {}): Promise<SearchResult[]> {
  const apiKey = process.env.PERPLEXITY_API_KEY || process.env.PPLX_API_KEY;

  if (!apiKey) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.PERPLEXITY_SEARCH_MODEL || 'sonar',
          messages: [
            {
              role: 'system',
              content: options.systemPrompt || 'You are a financial research assistant. Provide factual, data-rich answers with current market data. Be concise and cite sources.',
            },
            { role: 'user', content: query },
          ],
          temperature: 0.1,
          max_tokens: 1000,
          return_citations: true,
          search_recency_filter: options.recencyFilter || 'day',
        }),
        signal: controller.signal,
      });

      if (!response.ok) return [];
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const citations: string[] = data.citations || [];

      // Track cost
      try {
        const costTracker = require('../funding/api-cost-tracker');
        const tokensApprox = Math.ceil((query.length + content.length) / 4);
        costTracker.recordApiCall('perplexity', tokensApprox / 1000, { type: 'search' });
      } catch { /* funding not available */ }

      // Convert Perplexity response + citations into SearchResult format
      const results: SearchResult[] = [];

      // The main answer as first result
      if (content) {
        results.push({
          title: 'Perplexity AI Research',
          url: citations[0] || 'https://perplexity.ai',
          snippet: content.slice(0, 500),
          source: 'perplexity',
        });
      }

      // Individual citations as additional results
      citations.slice(0, 4).forEach((citation, i) => {
        try {
          const hostname = new URL(citation).hostname;
          results.push({
            title: `Source ${i + 1}: ${hostname}`,
            url: citation,
            snippet: `Referenced in Perplexity analysis`,
            source: hostname,
          });
        } catch { /* invalid URL */ }
      });

      return results;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.error('Perplexity search error:', error);
    return [];
  }
}

/**
 * Deep research query using Perplexity sonar-pro.
 * Returns a comprehensive, citation-rich analysis. Use for high-stakes decisions.
 */
export async function perplexityDeepResearch(query: string): Promise<{
  answer: string;
  citations: string[];
  confidence: number;
}> {
  const apiKey = process.env.PERPLEXITY_API_KEY || process.env.PPLX_API_KEY;

  if (!apiKey) return { answer: '', citations: [], confidence: 0 };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.PERPLEXITY_MODEL || 'sonar-pro',
          messages: [
            {
              role: 'system',
              content: 'You are an elite financial research analyst for an autonomous trading system. Provide thorough analysis with specific data points, prices, percentages, dates, and risk factors. Always cite your sources inline.',
            },
            { role: 'user', content: query },
          ],
          temperature: 0.1,
          max_tokens: 2000,
          return_citations: true,
          search_recency_filter: 'day',
        }),
        signal: controller.signal,
      });

      if (!response.ok) return { answer: '', citations: [], confidence: 0 };
      const data = await response.json();
      const answer = data.choices?.[0]?.message?.content || '';
      const citations: string[] = data.citations || [];

      // Track cost (sonar-pro is more expensive)
      try {
        const costTracker = require('../funding/api-cost-tracker');
        const tokensApprox = Math.ceil((query.length + answer.length) / 4);
        costTracker.recordApiCall('perplexity_sonar_pro', tokensApprox / 1000, { type: 'deep_research', model: 'sonar-pro' });
      } catch { /* funding not available */ }

      // Confidence based on citation count and answer length
      const confidence = Math.min(0.95, 0.5 + (citations.length * 0.05) + (answer.length > 500 ? 0.15 : 0));

      return { answer, citations, confidence };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.error('Perplexity deep research error:', error);
    return { answer: '', citations: [], confidence: 0 };
  }
}

/**
 * Enhance prompt with web search context
 */
export async function enhancePromptWithWebSearch(prompt: string): Promise<EnhancedPrompt> {
  // Extract key terms from prompt for better search
  const searchQuery = extractSearchTerms(prompt);

  // Try Perplexity first for search-grounded answers (best quality)
  let results = await perplexitySearch(searchQuery);

  // Fallback to Tavily
  if (results.length === 0) {
    results = await webSearch(searchQuery, 5);
  }

  // Fallback to DuckDuckGo
  if (results.length === 0) {
    results = await webSearchFallback(searchQuery);
  }

  // Build enhanced prompt with context
  const context =
    results.length > 0
      ? `\n\nRecent context from web search:\n${results.map((r) => `- ${r.title}: ${r.snippet}`).join('\n')}`
      : '';

  return {
    original: prompt,
    withContext: prompt + context,
    sources: results,
  };
}

/**
 * Extract meaningful search terms from user query
 */
function extractSearchTerms(prompt: string): string {
  // Remove common words and extract key terms
  const stopwords = new Set([
    'what',
    'how',
    'why',
    'when',
    'where',
    'is',
    'are',
    'the',
    'a',
    'an',
    'and',
    'or',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
  ]);

  const words = prompt
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => !stopwords.has(word) && word.length > 2)
    .slice(0, 5);

  return words.join(' ') || prompt;
}

/**
 * Format search results for inclusion in prompt
 */
export function formatSearchResultsForPrompt(results: SearchResult[]): string {
  if (results.length === 0) return '';

  const formatted = results
    .map(
      (result, i) =>
        `[${i + 1}] ${result.title}\nSource: ${result.source}\n"${result.snippet}"\nURL: ${result.url}`
    )
    .join('\n\n');

  return `Based on current web information:\n\n${formatted}`;
}
