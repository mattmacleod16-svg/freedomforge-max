/* Assistant module index */
export { ALL_KNOWLEDGE_CHUNKS, KNOWLEDGE_INDEX, QA_DATASET, QA_BY_TOPIC, APRISO_CHUNKS, ORACLE_DB_CHUNKS, ORACLE_ERP_CHUNKS, INTEGRATION_CHUNKS, retrieveChunks, retrieveQA, getChunksByCategory } from './knowledge-base';
export type { KnowledgeChunk, KnowledgeCategory, QAPair } from './knowledge-base';

export { TEAAssistant, teaAssistant, askTEA, classifyIntent, buildRAGContext, fillTemplate, TEA_PERSONA, TEA_SYSTEM_PROMPT, PROMPT_TEMPLATES } from './tea-assistant';
export type { TEARequest, TEAResponse, RAGContext, QueryIntent, PromptTemplateName, PromptTemplateVars } from './tea-assistant';
