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
    });

    const data = await response.json();

    return (data.results || []).map((result: any) => ({
      title: result.title,
      url: result.url,
      snippet: result.content || result.description,
      source: new URL(result.url).hostname,
    }));
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
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`
    );
    const data = await response.json();

    return (data.Results || [])
      .slice(0, 5)
      .map((result: any) => ({
        title: result.Text,
        url: result.FirstURL,
        snippet: result.Text,
        source: 'duckduckgo',
      }));
  } catch (error) {
    console.error('Fallback search error:', error);
    return [];
  }
}

/**
 * Enhance prompt with web search context
 */
export async function enhancePromptWithWebSearch(prompt: string): Promise<EnhancedPrompt> {
  // Extract key terms from prompt for better search
  const searchQuery = extractSearchTerms(prompt);

  // Perform web search
  let results = await webSearch(searchQuery, 5);

  // Fallback if Tavily not configured
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
