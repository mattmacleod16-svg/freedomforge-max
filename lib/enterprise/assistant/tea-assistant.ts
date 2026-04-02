/* ═══════════════════════════════════════════════════════════════════════════
   Trane Enterprise Assistant (TEA) — AI Assistant Engine
   ═══════════════════════════════════════════════════════════════════════════

   The TEA assistant answers Trane Technologies employee questions about
   Apriso, Oracle ERP, Oracle Database, and manufacturing operations.

   Design principles:
   • Public-domain knowledge only — no proprietary Trane config details
   • RAG-first: always retrieve grounding context before generating
   • Persona-consistent: professional, concise, manufacturing-fluent
   • Safety guardrails: HR/injury redirect, no legal/medical/financial advice
   • Prompt templates: structured, reusable, testable
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  retrieveChunks,
  retrieveQA,
  type KnowledgeChunk,
  type QAPair,
  type KnowledgeCategory,
} from './knowledge-base';

// ─────────────────────────────────────────────────────────────────────────────
// Persona Definition
// ─────────────────────────────────────────────────────────────────────────────

export const TEA_PERSONA = {
  name: 'Trane Enterprise Assistant (TEA)',
  version: '2.0.0',

  personality: [
    'Helpful, concise, and professional',
    'Respectful and compliance-aware',
    'Uses public knowledge only — never internal Trane configurations',
    'Confident in manufacturing, supply chain, ERP, and IT topics',
    'Prefers bullet lists for clarity; offers summaries when content is long',
    'Provides actionable next steps when relevant',
  ],

  knowledgeDomains: [
    'DELMIA Apriso MOM/MES — high-level public functionality',
    'Oracle Database SQL and PL/SQL — general language reference',
    'Oracle ERP (E-Business Suite / Cloud) — public module capabilities',
    'General supply chain, manufacturing, and IT concepts',
    'ASHRAE standards, ISO 50001, BACnet protocols',
  ],

  knowledgeLimits: [
    'No access to internal Trane systems or configuration details',
    'No access to employee HR records, payroll, or personal data',
    'Will not speculate about proprietary Trane business rules',
    'Will not provide legal, medical, or financial advice',
  ],

  safetyRules: [
    'If asked about internal system configurations: clarify limitation, then give general info',
    'If user mentions injury: express sympathy, direct to HR/supervisor immediately',
    'If asked for legal/medical/financial advice: decline and suggest appropriate professional',
    'Never fabricate internal Trane system details',
    'Prefer citations to public Trane or vendor documentation when available',
  ],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt (inject at conversation root)
// ─────────────────────────────────────────────────────────────────────────────

export const TEA_SYSTEM_PROMPT = `You are the Trane Enterprise Assistant (TEA), version 2.0.
Your role is to assist Trane Technologies employees with public, general information about:

  • Manufacturing processes and operations management
  • DELMIA Apriso MOM/MES — high-level, public functionality
  • Oracle Database SQL and PL/SQL — general language reference
  • Oracle ERP / Cloud modules — public capabilities only
  • General supply chain, industrial IoT, and IT concepts

RULES (non-negotiable):
1. Never provide internal, proprietary, or confidential Trane information.
2. If asked about internal system configurations, respond:
   "I don't have access to internal system configurations, but here is general information: ..."
3. If a user mentions being injured:
   - Express sympathy immediately.
   - Direct them to contact HR or their supervisor.
   - Do not attempt to provide medical advice.
4. Use clear, professional language. Avoid jargon unless the user is clearly technical.
5. Do not provide legal, medical, or financial advice under any circumstances.
6. Only use public-domain information about Apriso, Oracle, or manufacturing systems.
7. Cite your limitations when you are uncertain.
8. Prefer bullet lists for multi-item answers; use numbered lists for sequences.
9. Provide actionable next steps when the user needs to do something.
10. If you use retrieved context, attribute it naturally (e.g., "According to Oracle documentation...").

RESPONSE FORMAT GUIDELINES:
- Keep answers concise unless detail is explicitly requested.
- For "what is X" questions: one-paragraph definition + 3-5 bullets.
- For "how do I" questions: numbered steps with warnings highlighted.
- For "what is the difference between" questions: brief comparison table or side-by-side bullets.
- Always end with an offer to elaborate: "Would you like more detail on any of these points?"`;

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Templates
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptTemplateVars {
  [key: string]: string;
}

/** Fill a template string with {{variable}} placeholders */
export function fillTemplate(template: string, vars: PromptTemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export const PROMPT_TEMPLATES = {
  /** PT-1: General employee question */
  GENERAL_QUESTION: `You are the Trane Enterprise Assistant. Answer the following question clearly and concisely using only public, non-proprietary information. If you are uncertain, say so.

Question: {{employee_question}}`,

  /** PT-2: Structured troubleshooting */
  TROUBLESHOOTING: `Provide a structured, step-by-step explanation using public information only.
Identify possible causes, likely scenarios, and the actions the user can take.
Format your response with these sections:
  1. Likely Cause(s)
  2. Diagnostic Steps
  3. Recommended Actions
  4. When to Escalate

Issue: {{problem_description}}`,

  /** PT-3: Concept definition */
  DEFINITION: `Define the following concept in clear, simple terms suitable for a Trane Technologies employee.
Include: what it is, why it matters, a practical example, and its role in manufacturing or ERP.

Topic: {{topic}}`,

  /** PT-4: RAG-enabled answering (inject retrieved context) */
  RAG_ANSWER: `Use the following retrieved context to answer the user's question accurately.
If the context does not contain sufficient information, say "Based on available information..." and answer from general knowledge.

RULES:
- Only use information from the context or well-established general knowledge.
- Do not fabricate internal Trane system details.
- Cite specific context sections when possible (e.g., "According to the Apriso MES section...").

Context:
{{retrieved_chunks}}

User Question: {{question}}`,

  /** PT-5: HR / policy redirect */
  HR_REDIRECT: `I'm sorry you're experiencing that situation. Because I don't have access to internal HR systems or records, I'm not able to directly resolve HR matters.

Here is what you can do:
• Contact your HR Business Partner or HR Service Center directly.
• Reach out to your direct supervisor or their manager.
• Follow official Trane Technologies procedures for this type of situation.
• If this is urgent or involves a safety concern, please use the appropriate emergency channels.

Is there any general, public-domain information I can help with in the meantime?`,

  /** PT-6: Technical integration question */
  INTEGRATION_QUESTION: `You are a manufacturing integration expert assisting a Trane Technologies employee.
Answer using public knowledge of Apriso, Oracle ERP, and standard integration patterns only.
Provide: the integration approach, data flows, technologies typically used, and common pitfalls.

Integration scenario: {{scenario}}`,

  /** PT-7: SQL/PL/SQL assistance */
  SQL_HELP: `You are an Oracle Database expert. Provide accurate, well-explained Oracle SQL or PL/SQL guidance.
Include: syntax, example usage, and any important caveats or Oracle-specific behavior.
Do not reference any internal Trane database schemas — use generic example table and column names.

SQL/PL/SQL request: {{sql_request}}`,
} as const;

export type PromptTemplateName = keyof typeof PROMPT_TEMPLATES;

// ─────────────────────────────────────────────────────────────────────────────
// Intent Classification
// ─────────────────────────────────────────────────────────────────────────────

export type QueryIntent =
  | 'apriso_question'
  | 'oracle_db_question'
  | 'oracle_erp_question'
  | 'integration_question'
  | 'troubleshooting'
  | 'definition'
  | 'sql_help'
  | 'hr_safety'
  | 'general';

interface IntentPattern {
  intent: QueryIntent;
  patterns: RegExp[];
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: 'hr_safety',
    patterns: [
      /\b(injur|hurt|accident|unsafe|emergency|medical|hospital|ambulance)\b/i,
      /\b(hr|human resources|payroll|vacation|pto|leave|fmla|disciplin|fired|terminat)\b/i,
    ],
  },
  {
    intent: 'sql_help',
    patterns: [
      /\b(select|insert|update|delete|join|where|having|group by|order by)\b/i,
      /\b(pl\/sql|plsql|procedure|function|trigger|cursor|exception|dbms_)\b/i,
      /\b(sql|query|database|oracle db|varchar|number|clob|blob|index)\b/i,
    ],
  },
  {
    intent: 'apriso_question',
    patterns: [
      /\b(apriso|delmia|mes|mom|work order|wip|routing|operation|shop floor)\b/i,
      /\b(oee|downtime|scrap|rework|nonconformance|ncr|genealogy|traceability|spc)\b/i,
      /\b(process builder|screen builder|kanban|kitting|supermarket)\b/i,
    ],
  },
  {
    intent: 'oracle_erp_question',
    patterns: [
      /\b(oracle erp|ebs|e-business suite|cloud erp|fusion|otbi|bi publisher|frs)\b/i,
      /\b(general ledger|accounts payable|accounts receivable|fixed assets|cash mgmt)\b/i,
      /\b(purchase order|po matching|invoice|receipt|inventory|bom|mrp|mps|drp)\b/i,
      /\b(hcm|payroll|time and labor|talent|recruiting|order management|atp)\b/i,
    ],
  },
  {
    intent: 'oracle_db_question',
    patterns: [
      /\b(oracle database|oracle db|oracle sql|pl\/sql)\b/i,
      /\b(dbms_output|dbms_scheduler|utl_file|utl_http|v\$session|data dictionary)\b/i,
    ],
  },
  {
    intent: 'integration_question',
    patterns: [
      /\b(integrat|api|rest|soap|web service|oic|mulesoft|message queue|etl|interface)\b/i,
      /\b(apriso.*oracle|oracle.*apriso|erp.*mes|mes.*erp)\b/i,
    ],
  },
  {
    intent: 'troubleshooting',
    patterns: [
      /\b(error|problem|issue|not working|fail|broke|wrong|incorrect|help)\b/i,
      /\b(troubleshoot|debug|diagnose|fix|resolve|why is|why does|how come)\b/i,
    ],
  },
  {
    intent: 'definition',
    patterns: [
      /\b(what is|what are|define|explain|describe|tell me about|overview of)\b/i,
    ],
  },
];

export function classifyIntent(query: string): QueryIntent {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some(p => p.test(query))) {
      return intent;
    }
  }
  return 'general';
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG Context Builder
// ─────────────────────────────────────────────────────────────────────────────

export interface RAGContext {
  chunks: KnowledgeChunk[];
  qaPairs: QAPair[];
  formattedContext: string;
  tokenEstimate: number;
}

/**
 * Build a RAG context block from the knowledge base for a given query.
 * Returns structured context ready for injection into the RAG_ANSWER template.
 */
export function buildRAGContext(query: string, maxChunks = 4, maxQA = 2): RAGContext {
  const chunks = retrieveChunks(query, maxChunks);
  const qaPairs = retrieveQA(query, maxQA);

  const chunkText = chunks
    .map(c => `### ${c.title}\n${c.content}\n${(c.bullets ?? []).map(b => `  • ${b}`).join('\n')}`)
    .join('\n\n');

  const qaText = qaPairs.length > 0
    ? '\n\n### Related Q&A\n' + qaPairs.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join('\n\n')
    : '';

  const formattedContext = chunkText + qaText;
  // Rough token estimate: ~4 chars per token
  const tokenEstimate = Math.ceil(formattedContext.length / 4);

  return { chunks, qaPairs, formattedContext, tokenEstimate };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEA Request / Response Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TEARequest {
  query: string;
  userId?: string;
  siteId?: string;
  /** Override intent classification */
  intentOverride?: QueryIntent;
  /** Max knowledge chunks to retrieve */
  maxChunks?: number;
}

export interface TEAResponse {
  intent: QueryIntent;
  templateUsed: PromptTemplateName;
  /** Filled prompt ready to send to Claude */
  prompt: string;
  /** Grounding context that was retrieved */
  context: RAGContext | null;
  /** Matched Q&A pairs for direct lookup */
  directAnswers: QAPair[];
  /** Category of the primary retrieved chunk */
  primaryCategory: KnowledgeCategory | null;
  /** Estimated token count for the full prompt */
  estimatedTokens: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEA Assistant Engine
// ─────────────────────────────────────────────────────────────────────────────

export class TEAAssistant {
  private readonly systemPrompt: string;
  private readonly maxChunks: number;

  constructor(options: { maxChunks?: number } = {}) {
    this.systemPrompt = TEA_SYSTEM_PROMPT;
    this.maxChunks = options.maxChunks ?? 4;
  }

  /**
   * Process a user query and return a fully prepared TEAResponse containing
   * the filled prompt, retrieved context, and intent classification.
   */
  process(request: TEARequest): TEAResponse {
    const intent = request.intentOverride ?? classifyIntent(request.query);

    // HR/safety → hard redirect, no RAG needed
    if (intent === 'hr_safety') {
      return this._hrRedirectResponse(request.query);
    }

    // Retrieve knowledge base context
    const maxChunks = request.maxChunks ?? this.maxChunks;
    const context = buildRAGContext(request.query, maxChunks);
    const directAnswers = retrieveQA(request.query, 3);

    // Select prompt template based on intent
    const templateName = this._selectTemplate(intent);
    const templateStr = PROMPT_TEMPLATES[templateName];

    // Build filled prompt
    const vars: PromptTemplateVars = {
      employee_question: request.query,
      question: request.query,
      problem_description: request.query,
      topic: request.query,
      scenario: request.query,
      sql_request: request.query,
      retrieved_chunks: context.formattedContext,
    };

    let prompt: string;
    if (templateName === 'RAG_ANSWER' || context.chunks.length > 0) {
      // Use RAG template when we have grounding context
      prompt = fillTemplate(PROMPT_TEMPLATES.RAG_ANSWER, vars);
    } else {
      prompt = fillTemplate(templateStr as string, vars);
    }

    const primaryCategory = context.chunks[0]?.category ?? null;
    const estimatedTokens =
      Math.ceil(this.systemPrompt.length / 4) +
      Math.ceil(prompt.length / 4);

    return {
      intent,
      templateUsed: templateName === 'RAG_ANSWER' ? 'RAG_ANSWER' : templateName,
      prompt,
      context,
      directAnswers,
      primaryCategory,
      estimatedTokens,
    };
  }

  /** Build the full messages array for the Claude API */
  buildMessages(request: TEARequest): Array<{ role: 'system' | 'user'; content: string }> {
    const response = this.process(request);
    return [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: response.prompt },
    ];
  }

  /** Get the system prompt */
  get systemPromptText(): string {
    return this.systemPrompt;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private _hrRedirectResponse(query: string): TEAResponse {
    return {
      intent: 'hr_safety',
      templateUsed: 'HR_REDIRECT',
      prompt: PROMPT_TEMPLATES.HR_REDIRECT,
      context: null,
      directAnswers: [],
      primaryCategory: null,
      estimatedTokens: Math.ceil(PROMPT_TEMPLATES.HR_REDIRECT.length / 4),
    };
  }

  private _selectTemplate(intent: QueryIntent): PromptTemplateName {
    switch (intent) {
      case 'sql_help':           return 'SQL_HELP';
      case 'integration_question': return 'INTEGRATION_QUESTION';
      case 'troubleshooting':    return 'TROUBLESHOOTING';
      case 'definition':         return 'DEFINITION';
      case 'hr_safety':          return 'HR_REDIRECT';
      default:                   return 'GENERAL_QUESTION';
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

export const teaAssistant = new TEAAssistant();

/** Convenience function: process a query and return filled prompt + context */
export function askTEA(query: string, options?: Partial<TEARequest>): TEAResponse {
  return teaAssistant.process({ query, ...options });
}
