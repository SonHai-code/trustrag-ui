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
}

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
