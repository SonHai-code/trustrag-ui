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
  kind?: "document" | "web"; // agent mode: a web source has a url and no article
  url?: string;
}

export interface Latency {
  retrieval_ms: number;
  generation_ms: number;
  total_ms: number;
  ttft_ms?: number | null; // time to first token (streaming)
  stages?: Record<string, number>; // embed_ms / vector_ms / rerank_ms (chat) or plan_ms / retrieve_ms / ... (agent)
}

/** A tool the agent called (an MCP tool): what it was asked and what came back. */
export interface ToolCall {
  type: "tool";
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
  backend?: string; // "mcp" | "http"
  result?: string; // one-line summary of what the tool returned
  preview?: string; // compact JSON of the result (passage texts left out)
  error?: string;
}

/** A call to the language model made during a step (router, grading, rewriting, memory, the answer itself). */
export interface LlmCall {
  type: "llm";
  purpose: string; // router | grade | rewrite | contextualize | answer·documents | answer·web | answer·knowledge
  model: string;
  ok: boolean;
  ms: number;
  prompt: string; // the user-side prompt, clipped (system prompts are not shown)
  reply: string;
  history_messages?: number;
  note?: string; // e.g. the fast model was rejected and the main model answered instead
  error?: string;
}

export type TraceCall = ToolCall | LlmCall;

/** Why a step went the way it did (plan: which route, decided by rules or by the LLM, which tool comes next). */
export interface Decision {
  route?: string;
  by?: "rules" | "llm";
  why?: string;
  tool?: string | null;
  router_intent?: string | null;
  verdict?: string; // guard
  rewritten?: boolean; // contextualize
  from?: string;
  to?: string;
}

/** One step of the agent graph (guard, contextualize, plan, web, retrieve, grade, rewrite, select, generate, verify). */
export interface AgentStep {
  node: string;
  summary: string;
  ms: number;
  decision?: Decision;
  calls?: TraceCall[];
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
  guard?: { verdict: string; reason?: string; output_leak?: boolean; output_blocked?: string };
  skills?: string[]; // skills added to the answer prompt
  standalone_question?: string | null; // a follow-up rewritten using the conversation history
  history_messages?: number; // earlier messages the agent was given
  memory?: { total: number; filtered: number; recent: number; relevant_older: number; summarized: number; summary_by: string; focus: string; summary: string };
  web_note?: string; // "no_location" | "error" | "empty" | "": why the internet lookup gave nothing
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** How an agent answer was produced. "documents", "mixed" and "web" carry citations. */
export type AnswerMode =
  | "documents"
  | "mixed"
  | "web"
  | "knowledge"
  | "knowledge_fallback"
  | "web_unavailable"
  | "chat"
  | "refused"
  | "blocked";

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

/** One selectable model from GET /models (ids and labels only). */
export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  model: string;
  default: boolean;
}

// ---------------- accounts, settings and saved conversations (trustrag-user-service) ----------------

export interface Settings {
  model?: string;
  mode?: "chat" | "agent" | "search";
  topK?: number;
  stream?: boolean;
  theme?: "light" | "dark" | "system";
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  settings?: Settings;
  createdAt: string;
}

export interface AuthPayload {
  user: AuthUser;
  access_token: string;
  token_type: "Bearer";
  expires_in: number; // seconds
}

export interface ConvSummary {
  id: string;
  title: string;
  pinned: boolean;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** What is saved with an answer: enough to show it again later (the agent trace is not kept: it is large and only for debugging). */
export interface StoredMeta {
  v: 1;
  mode: "chat" | "agent" | "search";
  model?: string;
  answer_mode?: string;
  grounded?: boolean;
  confidence?: number;
  refusal_reason?: string | null;
  retrieval_mode?: string;
  search_query?: string | null;
  retrieved?: number;
  total_ms?: number;
  retrieval_ms?: number;
  generation_ms?: number;
  cached?: boolean;
  citations?: Citation[];
  agent?: { route: string | null; llm_calls: number; tools: string; verification: Verification | null; web_note?: string; skills?: string[] };
}

export interface StoredMessage {
  id: string;
  seq: number;
  role: "user" | "assistant";
  text: string;
  meta?: StoredMeta;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface AdminUser extends AuthUser {
  disabled: boolean;
  lastLoginAt: string;
}

/** One message on screen (the stored ones and the ones being streamed share this shape). */
export interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  citations?: Citation[]; // sources shown under the answer
  candidates?: boolean; // true while citations are only "retrieved so far" (streaming)
  meta?: ChatResponse;
  steps?: AgentStep[]; // agent mode: what the agent did, in order
  searchMs?: number;
  error?: string;
  pending?: boolean;
  animate?: boolean; // reveal the text progressively (streamed answers only)
}
