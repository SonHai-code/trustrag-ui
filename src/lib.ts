// Pure helpers (no React, no browser APIs) so they can be unit-tested with plain Node: tests/lib.test.mjs
import type { ChatResponse, Citation, ConvSummary, HistoryMessage, Message, StoredMessage, StoredMeta } from "./types";

// ---------------- text ----------------

/** Lower-case without accents ("Điều 5" -> "dieu 5"): searching the sidebar should not depend on typing diacritics. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function clip(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join("") + "…";
}

// ---------------- conversations list ----------------

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dayBucket(iso: string, now: Date): string {
  const days = Math.floor((startOfDay(now) - startOfDay(new Date(iso))) / DAY);
  if (days <= 0) return "Hôm nay";
  if (days === 1) return "Hôm qua";
  if (days <= 7) return "7 ngày qua";
  if (days <= 30) return "30 ngày qua";
  return "Cũ hơn";
}

/** Sidebar sections: pinned first, then by recency. Items keep the order they came in (the server sorts newest first). */
export function groupConversations(list: ConvSummary[], now: Date, query = ""): { label: string; items: ConvSummary[] }[] {
  const q = fold(query.trim());
  const shown = q ? list.filter((c) => fold(c.title).includes(q)) : list;
  const sections: { label: string; items: ConvSummary[] }[] = [];
  const add = (label: string, c: ConvSummary) => {
    let s = sections.find((x) => x.label === label);
    if (!s) sections.push((s = { label, items: [] }));
    s.items.push(c);
  };
  for (const c of shown.filter((x) => x.pinned)) add("Đã ghim", c);
  for (const c of shown.filter((x) => !x.pinned)) add(dayBucket(c.updatedAt, now), c);
  return sections;
}

export function relativeTime(iso: string, now: Date): string {
  const sec = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return "vừa xong";
  if (sec < 3600) return `${Math.floor(sec / 60)} phút trước`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} giờ trước`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)} ngày trước`;
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// ---------------- saving and restoring answers ----------------

/** The part of an answer worth keeping (see StoredMeta). Snippets are shortened so a conversation stays small. */
export function slimMeta(mode: "chat" | "agent" | "search", res: Partial<ChatResponse> & { citations?: Citation[] }): StoredMeta {
  const cites = (res.citations ?? []).slice(0, 10).map((c) => ({ ...c, snippet: clip(c.snippet ?? "", 400) }));
  const a = res.agent;
  return {
    v: 1,
    mode,
    model: res.model,
    answer_mode: res.answer_mode,
    grounded: res.grounded,
    confidence: res.confidence,
    refusal_reason: res.refusal_reason,
    retrieval_mode: res.retrieval_mode,
    search_query: res.search_query,
    retrieved: res.retrieved,
    total_ms: res.latency_ms?.total_ms,
    retrieval_ms: res.latency_ms?.retrieval_ms,
    generation_ms: res.latency_ms?.generation_ms,
    cached: res.cached,
    citations: cites,
    agent: a ? { route: a.route, llm_calls: a.llm_calls, tools: a.tools, verification: a.verification, web_note: a.web_note, skills: a.skills } : undefined,
  };
}

/** Meta objects larger than the server accepts (64 KB) are trimmed instead of failing the whole save. */
export function fitMeta(meta: StoredMeta, maxBytes = 60_000): StoredMeta {
  let m = meta;
  while (JSON.stringify(m).length > maxBytes && (m.citations?.length ?? 0) > 0) {
    m = { ...m, citations: m.citations!.slice(0, -1) };
  }
  return m;
}

export function restoreMessage(sm: StoredMessage, id: number): Message {
  if (sm.role === "user") return { id, role: "user", text: sm.text };
  const m = sm.meta;
  if (!m || m.v !== 1) return { id, role: "assistant", text: sm.text };
  if (m.mode === "search") return { id, role: "assistant", text: sm.text, citations: m.citations ?? [], searchMs: m.total_ms ?? 0 };
  const meta: ChatResponse = {
    answer: sm.text,
    grounded: m.grounded ?? true,
    confidence: m.confidence ?? 0,
    citations: m.citations ?? [],
    retrieved: m.retrieved ?? 0,
    refusal_reason: m.refusal_reason ?? null,
    retrieval_mode: m.retrieval_mode ?? "",
    search_query: m.search_query ?? null,
    latency_ms: { retrieval_ms: m.retrieval_ms ?? 0, generation_ms: m.generation_ms ?? 0, total_ms: m.total_ms ?? 0 },
    model: m.model ?? "",
    cached: m.cached,
    answer_mode: m.answer_mode as ChatResponse["answer_mode"],
    agent: m.agent
      ? { route: m.agent.route, attempts: 0, queries: [], steps: [], verification: m.agent.verification, llm_calls: m.agent.llm_calls, tools: m.agent.tools, web_note: m.agent.web_note, skills: m.agent.skills }
      : undefined,
  };
  return { id, role: "assistant", text: sm.text, citations: meta.citations, meta };
}

const MAX_HISTORY = 12; // messages (6 turns) sent to the agent with each question

/** Conversation memory: the agent keeps no state, so every question carries the earlier turns. Failed, refused-by-guard
 *  and search-only turns are left out (they are not part of the conversation the model should follow). */
export function buildHistory(all: Message[]): HistoryMessage[] {
  const out: HistoryMessage[] = [];
  for (let i = 0; i + 1 < all.length; i += 2) {
    const u = all[i];
    const a = all[i + 1];
    if (u.role !== "user" || a.role !== "assistant" || a.error || a.pending || !a.text.trim()) continue;
    if (a.searchMs != null || a.meta?.answer_mode === "blocked") continue;
    out.push({ role: "user", content: u.text }, { role: "assistant", content: a.text });
  }
  return out.slice(-MAX_HISTORY);
}

// ---------------- sign-in forms (the server checks again; this only gives instant feedback) ----------------

export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

export interface PasswordCheck {
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4; // for the strength bar
  problems: string[];
}

export function checkPassword(pw: string, email = ""): PasswordCheck {
  const len = Array.from(pw).length;
  const problems: string[] = [];
  if (len < 10) problems.push("Ít nhất 10 ký tự");
  if (len > 128) problems.push("Tối đa 128 ký tự");
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && pw.toLowerCase().includes(local)) problems.push("Không chứa email của bạn");
  if (len > 0 && new Set(Array.from(pw.toLowerCase())).size === 1) problems.push("Không dùng một ký tự lặp lại");
  const base = pw.toLowerCase().replace(/[0-9!@#.]+$/, "");
  if (["password", "matkhau", "qwerty", "qwertyuiop", "iloveyou", "letmein", "welcome", "admin", "trustrag"].includes(base)) {
    problems.push("Mật khẩu quá phổ biến");
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  let score = 0;
  if (len >= 10) score++;
  if (len >= 14) score++;
  if (classes >= 3) score++;
  if (len >= 18 || (len >= 14 && classes === 4)) score++;
  if (problems.length) score = Math.min(score, 1);
  return { ok: problems.length === 0, score: score as PasswordCheck["score"], problems };
}

// ---------------- token timing ----------------

/** When to refresh: a minute before the access token expires (never sooner than 5 s, never beyond what setTimeout accepts). */
export function refreshDelayMs(expiresInSec: number): number {
  return Math.min(2_000_000_000, Math.max(5_000, (expiresInSec - 60) * 1000));
}
