/**
 * Grok Grant Client — Uses xAI's Grok API to discover, summarize, and match grants.
 * Calls the xAI API (OpenAI-compatible) with the Grok model.
 */

export interface Grant {
  id: string;
  title: string;
  funder: string;
  amount: { min: number; max: number; currency: string };
  deadline: string | null;
  eligibility: string[];
  focus: string[];
  description: string;
  applicationUrl: string | null;
  location: string | null;
  type: 'federal' | 'state' | 'foundation' | 'corporate' | 'nonprofit' | 'other';
  category: string;
  score?: number;
}

export interface GrantSearchParams {
  query: string;
  location?: string;
  category?: string;
  maxResults?: number;
}

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-3-mini';

function getApiKey(): string {
  return (process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim();
}

const GRANT_SYSTEM_PROMPT = `You are an expert grant researcher specializing in finding funding opportunities.
When asked about grants, return a JSON array of grant objects with these fields:
{
  "id": "unique-slug",
  "title": "Grant Name",
  "funder": "Organization providing the grant",
  "amount": { "min": 0, "max": 50000, "currency": "USD" },
  "deadline": "YYYY-MM-DD or null if rolling",
  "eligibility": ["who can apply"],
  "focus": ["topic areas"],
  "description": "2-3 sentence description",
  "applicationUrl": "https://... or null",
  "location": "US/SC/local/national or null",
  "type": "federal|state|foundation|corporate|nonprofit|other",
  "category": "arts|education|health|environment|community|technology|other"
}
Return only valid JSON array. Include real, verifiable grants where possible.`;

/**
 * Search for grants using Grok AI.
 */
export async function searchGrants(params: GrantSearchParams): Promise<Grant[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return getMockGrants(params);
  }

  const userPrompt = buildSearchPrompt(params);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          { role: 'system', content: GRANT_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 4096,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.error('[grokGrantClient] API error', res.status);
      return getMockGrants(params);
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || '';
    return parseGrantsFromContent(content, params);
  } catch (err) {
    console.error('[grokGrantClient] fetch error', err);
    return getMockGrants(params);
  }
}

/**
 * Get a detailed summary and application guidance for a specific grant.
 */
export async function getGrantGuidance(grant: Grant, applicantContext: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return `To apply for "${grant.title}" from ${grant.funder}:\n\n1. Visit ${grant.applicationUrl || 'their official website'}\n2. Review eligibility requirements\n3. Prepare required documents\n4. Submit before the deadline: ${grant.deadline || 'rolling'}\n\nKey tips: Clearly articulate your mission alignment with ${grant.funder}'s focus areas: ${grant.focus.join(', ')}.`;
  }

  const prompt = `I need help applying for the following grant:

Grant: ${grant.title}
Funder: ${grant.funder}
Amount: $${grant.amount.min.toLocaleString()} - $${grant.amount.max.toLocaleString()}
Focus: ${grant.focus.join(', ')}
Deadline: ${grant.deadline || 'Rolling'}

About the applicant: ${applicantContext}

Please provide:
1. A step-by-step application guide
2. Key talking points to highlight
3. Common mistakes to avoid
4. Budget allocation suggestions
5. Follow-up strategy

Be specific and actionable.`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048,
        temperature: 0.5,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) return 'Unable to generate guidance at this time. Please check the funder\'s website directly.';
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || 'No guidance available.';
  } catch {
    return 'Unable to generate guidance at this time.';
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildSearchPrompt(params: GrantSearchParams): string {
  const parts = [`Find ${params.maxResults || 8} relevant grants for: "${params.query}"`];
  if (params.location) parts.push(`Location preference: ${params.location}`);
  if (params.category) parts.push(`Category: ${params.category}`);
  parts.push('Focus on currently open or rolling grants. Return JSON array only.');
  return parts.join('\n');
}

function parseGrantsFromContent(content: string, params: GrantSearchParams): Grant[] {
  try {
    // Extract JSON array from content (may have surrounding text)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return getMockGrants(params);
    const parsed = JSON.parse(jsonMatch[0]) as Grant[];
    if (!Array.isArray(parsed)) return getMockGrants(params);
    return parsed.slice(0, params.maxResults || 8).map((g, i) => ({
      ...g,
      id: g.id || `grant_${Date.now()}_${i}`,
      amount: g.amount || { min: 0, max: 50000, currency: 'USD' },
      eligibility: Array.isArray(g.eligibility) ? g.eligibility : [],
      focus: Array.isArray(g.focus) ? g.focus : [],
    }));
  } catch {
    return getMockGrants(params);
  }
}

function getMockGrants(params: GrantSearchParams): Grant[] {
  const location = params.location || 'South Carolina';
  const grants: Grant[] = [
    {
      id: 'sba-sbir-phase1',
      title: 'SBIR Phase I — Small Business Innovation Research',
      funder: 'U.S. Small Business Administration',
      amount: { min: 50000, max: 275000, currency: 'USD' },
      deadline: null,
      eligibility: ['US-based small businesses', 'For-profit entities', 'Majority US-owned'],
      focus: ['technology', 'innovation', 'R&D', 'commercialization'],
      description: 'Federal grants for small businesses engaged in R&D with high commercialization potential. Phase I funds feasibility studies; Phase II funds full R&D.',
      applicationUrl: 'https://www.sbir.gov/apply',
      location: 'National',
      type: 'federal',
      category: 'technology',
    },
    {
      id: 'sc-arts-commission-grant',
      title: 'Arts & Cultural Organizations Operating Grant',
      funder: 'South Carolina Arts Commission',
      amount: { min: 5000, max: 50000, currency: 'USD' },
      deadline: '2025-03-01',
      eligibility: ['SC-based nonprofits', '501(c)(3) organizations', 'Minimum 2 years operating history'],
      focus: ['arts', 'culture', 'community engagement', 'education'],
      description: 'Annual operating support for South Carolina arts and cultural organizations serving communities across the state.',
      applicationUrl: 'https://www.arts.sc.gov/grants',
      location: location,
      type: 'state',
      category: 'arts',
    },
    {
      id: 'knight-foundation-community',
      title: 'Knight Foundation Community & Economic Development',
      funder: 'John S. and James L. Knight Foundation',
      amount: { min: 25000, max: 500000, currency: 'USD' },
      deadline: null,
      eligibility: ['Nonprofits', 'Community organizations', 'Projects in Knight communities'],
      focus: ['community development', 'economic mobility', 'civic engagement', 'journalism'],
      description: 'Supports projects that create more informed and engaged communities. Strong focus on Columbia, SC and other Knight cities.',
      applicationUrl: 'https://knightfoundation.org/apply',
      location: 'Columbia, SC',
      type: 'foundation',
      category: 'community',
    },
    {
      id: 'forest-acres-community-fund',
      title: 'Forest Acres Community Development Fund',
      funder: 'City of Forest Acres',
      amount: { min: 2500, max: 25000, currency: 'USD' },
      deadline: null,
      eligibility: ['Forest Acres residents', 'Local nonprofits', 'Community groups'],
      focus: ['community development', 'local business', 'neighborhood improvement'],
      description: 'Local grants supporting economic development and community improvement projects in Forest Acres and surrounding Columbia areas.',
      applicationUrl: null,
      location: 'Forest Acres, SC',
      type: 'state',
      category: 'community',
    },
    {
      id: 'cdfi-fund-nmtc',
      title: 'New Markets Tax Credit Program',
      funder: 'U.S. Treasury CDFI Fund',
      amount: { min: 500000, max: 10000000, currency: 'USD' },
      deadline: null,
      eligibility: ['Community Development Entities', 'Low-income community investment projects'],
      focus: ['economic development', 'community facilities', 'small business', 'healthcare'],
      description: 'Tax credit program that attracts private investment to low-income communities, supporting businesses and revitalization projects.',
      applicationUrl: 'https://www.cdfifund.gov/programs-training/Programs/nmtc',
      location: 'National',
      type: 'federal',
      category: 'community',
    },
    {
      id: 'google-ai-social-good',
      title: 'Google.org AI for Social Good Grant',
      funder: 'Google.org',
      amount: { min: 100000, max: 2000000, currency: 'USD' },
      deadline: null,
      eligibility: ['Nonprofits', 'Social enterprises', 'Research institutions'],
      focus: ['AI', 'technology', 'social impact', 'economic mobility'],
      description: 'Grants for organizations using AI and technology to address social and economic challenges. Includes technical support from Google engineers.',
      applicationUrl: 'https://www.google.org/grants',
      location: 'Global',
      type: 'corporate',
      category: 'technology',
    },
    {
      id: 'stripe-atlas-grant',
      title: 'Stripe Atlas Startup Grant',
      funder: 'Stripe Foundation',
      amount: { min: 10000, max: 50000, currency: 'USD' },
      deadline: null,
      eligibility: ['Early-stage startups', 'Fintech companies', 'Economic empowerment projects'],
      focus: ['fintech', 'economic empowerment', 'payments', 'small business'],
      description: 'Support for entrepreneurs building financial tools that increase economic participation and create pathways to financial independence.',
      applicationUrl: 'https://stripe.com/atlas',
      location: 'Global',
      type: 'corporate',
      category: 'technology',
    },
    {
      id: 'eda-build-back-better',
      title: 'EDA Build Back Better Regional Challenge',
      funder: 'U.S. Economic Development Administration',
      amount: { min: 25000000, max: 100000000, currency: 'USD' },
      deadline: null,
      eligibility: ['Regional coalitions', 'Anchor institutions', 'Economic development organizations'],
      focus: ['regional development', 'manufacturing', 'clean energy', 'technology'],
      description: 'Major federal investment in regional economic development coalitions to drive job creation and economic recovery in underserved areas.',
      applicationUrl: 'https://www.eda.gov/funding',
      location: 'National',
      type: 'federal',
      category: 'community',
    },
  ];
  return grants.filter((g) => {
    if (!params.query) return true;
    const q = params.query.toLowerCase();
    return (
      g.title.toLowerCase().includes(q) ||
      g.description.toLowerCase().includes(q) ||
      g.focus.some((f) => f.toLowerCase().includes(q)) ||
      g.category.toLowerCase().includes(q) ||
      g.funder.toLowerCase().includes(q)
    );
  });
}
