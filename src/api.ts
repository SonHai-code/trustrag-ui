import type { AgentStep, ChatResponse, Citation, Health, HistoryMessage, ModelInfo, SearchResponse } from "./types";

// dev: "/api" (proxied by vite.config.ts). Single-container build sets VITE_API_BASE="" (same origin).
const BASE: string = import.meta.env.VITE_API_BASE ?? "/api";

// The model the user picked (an id from GET /models). The server only accepts ids from its own list: never a URL or a key.
let selectedModel = "";
export const setModel = (id: string) => {
  selectedModel = id;
};
const withModel = <T extends object>(body: T): T & { model?: string } => (selectedModel ? { ...body, model: selectedModel } : body);

export async function getModels(): Promise<{ default: string; models: ModelInfo[] }> {
  const res = await fetch(`${BASE}/models`);
  if (!res.ok) return fail(res);
  return res.json();
}

async function fail(res: Response): Promise<never> {
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (typeof body.detail === "string") detail = body.detail;
    else if (body.detail) detail = JSON.stringify(body.detail);
  } catch {
    /* keep default */
  }
  throw new Error(detail);
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) return fail(res);
  return res.json() as Promise<T>;
}

export async function getHealth(): Promise<Health & { points?: number }> {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) return fail(res);
  const health: Health = await res.json();
  try {
    const ready = await fetch(`${BASE}/health/ready`);
    if (ready.ok) return { ...health, points: (await ready.json()).points };
  } catch {
    /* Qdrant may be down: still report the API as online */
  }
  return health;
}

export const chat = (question: string, top_k: number, signal?: AbortSignal) =>
  post<ChatResponse>("/chat", withModel({ question, top_k }), signal);

export const search = (question: string, top_k: number, signal?: AbortSignal) =>
  post<SearchResponse>("/search", { question, top_k }, signal);

export interface StreamHandlers {
  onSources: (sources: Citation[]) => void;
  onToken: (text: string) => void;
  onDone: (final: ChatResponse) => void;
  onStep?: (step: AgentStep) => void; // agent mode only
}

/** POST + Server-Sent Events (EventSource only supports GET, so we parse the stream by hand). */
export async function chatStream(
  question: string,
  top_k: number,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  path = "/chat/stream", // agent mode passes "/agent/chat/stream"
  history: HistoryMessage[] = [] // agent mode: earlier turns; the agent keeps no state of its own
): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withModel(history.length ? { question, top_k, history } : { question, top_k })),
    signal,
  });
  if (!res.ok) return fail(res);
  if (!res.body) throw new Error("Streaming is not supported by this browser");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const dispatch = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (!data.length) return;
    const payload = JSON.parse(data.join("\n"));
    if (event === "sources") handlers.onSources(payload.sources);
    else if (event === "token") handlers.onToken(payload.text);
    else if (event === "step") handlers.onStep?.(payload);
    else if (event === "done") {
      finished = true;
      handlers.onDone(payload);
    }
    else if (event === "error") throw new Error(payload.detail ?? "Stream error");
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (block.trim()) dispatch(block);
    }
  }
  // the connection closed without a final answer (server crash, proxy timeout): say so instead of freezing silently
  if (!finished) throw new Error("Kết nối bị ngắt trước khi có câu trả lời. Vui lòng thử lại.");
}

export const agentStream = (
  question: string,
  top_k: number,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  history: HistoryMessage[] = []
) => chatStream(question, top_k, handlers, signal, "/agent/chat/stream", history);
