import { authFetch, clearSession, fail, startSession } from "./session";
import type {
  AdminUser, AgentStep, AuthPayload, AuthUser, ChatResponse, Citation, ConvSummary, Health, HistoryMessage, ModelInfo, SearchResponse,
  SessionInfo, Settings, StoredMessage, StoredMeta,
} from "./types";

// dev: "/api" (proxied by vite.config.ts). Single-container build sets VITE_API_BASE="" (same origin).
// Every call goes through authFetch (session.ts): it adds the login token and renews it when needed.

// The model the user picked (an id from GET /models). The server only accepts ids from its own list: never a URL or a key.
let selectedModel = "";
export const setModel = (id: string) => {
  selectedModel = id;
};
const withModel = <T extends object>(body: T): T & { model?: string } => (selectedModel ? { ...body, model: selectedModel } : body);

export async function getModels(): Promise<{ default: string; models: ModelInfo[] }> {
  const res = await authFetch("/models");
  if (!res.ok) return fail(res);
  return res.json();
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await authFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) return fail(res);
  return res.json() as Promise<T>;
}

export async function getHealth(): Promise<Health & { points?: number }> {
  const res = await authFetch("/health");
  if (!res.ok) return fail(res);
  const health: Health = await res.json();
  try {
    const ready = await authFetch("/health/ready");
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
  const res = await authFetch(path, {
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


// ---------------- accounts ----------------

async function json<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await authFetch(path, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!res.ok) return fail(res);
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const p = await json<AuthPayload>("/auth/login", "POST", { email, password });
  startSession(p);
  return p.user;
}

export async function register(email: string, password: string, name: string): Promise<AuthUser> {
  const p = await json<AuthPayload>("/auth/register", "POST", { email, password, name });
  startSession(p);
  return p.user;
}

export async function logout(): Promise<void> {
  try {
    await json<void>("/auth/logout", "POST", {});
  } finally {
    clearSession(); // even if the server cannot be reached the browser forgets the token
  }
}

export const logoutAll = () => json<void>("/auth/logout-all", "POST", {}).finally(clearSession);
export const listSessions = () => json<{ sessions: SessionInfo[] }>("/auth/sessions", "GET").then((r) => r.sessions);
export const revokeSession = (id: string) => json<void>(`/auth/sessions/${encodeURIComponent(id)}`, "DELETE");

export const updateProfile = (name: string) => json<{ user: AuthUser }>("/users/me", "PATCH", { name }).then((r) => r.user);
export const saveSettings = (s: Settings) => json<{ settings: Settings }>("/users/me/settings", "PUT", s).then((r) => r.settings);
export const changePassword = (currentPassword: string, newPassword: string) => json<void>("/users/me/password", "POST", { currentPassword, newPassword });
export const deleteAccount = (password: string) => json<void>("/users/me", "DELETE", { password }).finally(clearSession);

export const adminUsers = () => json<{ users: AdminUser[] }>("/admin/users?limit=200", "GET").then((r) => r.users);
export const adminPatch = (id: string, patch: { role?: "user" | "admin"; disabled?: boolean }) =>
  json<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}`, "PATCH", patch).then((r) => r.user);

// ---------------- saved conversations ----------------

export const listConversations = () => json<{ conversations: ConvSummary[] }>("/conversations", "GET").then((r) => r.conversations);
export const createConversation = (title?: string) => json<{ conversation: ConvSummary }>("/conversations", "POST", title ? { title } : {}).then((r) => r.conversation);
export const getConversation = (id: string) =>
  json<{ conversation: ConvSummary; messages: StoredMessage[] }>(`/conversations/${encodeURIComponent(id)}`, "GET");
export const patchConversation = (id: string, patch: { title?: string; pinned?: boolean }) =>
  json<{ conversation: ConvSummary }>(`/conversations/${encodeURIComponent(id)}`, "PATCH", patch).then((r) => r.conversation);
export const deleteConversation = (id: string) => json<void>(`/conversations/${encodeURIComponent(id)}`, "DELETE");
export const deleteAllConversations = () => json<void>("/conversations", "DELETE");
export const appendMessages = (id: string, messages: { role: "user" | "assistant"; text: string; meta?: StoredMeta }[]) =>
  json<{ conversation: ConvSummary }>(`/conversations/${encodeURIComponent(id)}/messages`, "POST", { messages }).then((r) => r.conversation);
