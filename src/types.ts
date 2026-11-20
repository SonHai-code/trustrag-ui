// Mirrors api/schemas.py
export interface Citation {
  id: number;
  doc_name: string;
  doc_label: string;
  chapter: string;
  article: string;
  article_title: string;
  clause: string;
  score: number;
  snippet: string;
}

export interface Latency {
  retrieval_ms: number;
  generation_ms: number;
  total_ms: number;
  ttft_ms?: number | null; // time to first token (streaming)
  stages?: Record<string, number>; // embed_ms / vector_ms / rerank_ms (chat) or plan_ms / retrieve_ms / ... (agent)
}

/** One step of the agent graph (plan, retrieve, grade, rewrite, select, generate, verify). */
export interface AgentStep {
  node: string;
  summary: string;
  ms: number;
}

export interface Verification {
  status: "ok" | "warning";
  cited: number[];
  invalid_markers: number[];
  unsupported_numbers: string[];
}

export interface AgentInfo {
  route: string | null;
  attempts: number;
  queries: string[];
  steps: AgentStep[];
  verification: Verification | null;
  llm_calls: number;
  tools: string;
}

/** How an agent answer was produced. Only "documents" and "mixed" carry citations. */
export type AnswerMode = "documents" | "mixed" | "knowledge" | "knowledge_fallback" | "chat" | "refused";

export interface ChatResponse {
  answer: string;
  grounded: boolean;
  confidence: number;
  citations: Citation[];
  retrieved: number;
  refusal_reason: string | null;
  retrieval_mode: string;
  search_query: string | null;
  latency_ms: Latency;
  model: string;
  cached?: boolean; // replayed from the gateway's answer cache
  agent?: AgentInfo; // only in agent mode
  answer_mode?: AnswerMode; // only in agent mode
}

export interface SearchResponse {
  query: string;
  results: Citation[];
  latency_ms: number;
}

export interface Health {
  status: string;
  llm_provider: string;
  model: string;
}
