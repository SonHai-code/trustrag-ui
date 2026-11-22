import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { agentStream, chat, chatStream, getHealth, search } from "./api";
import type { StreamHandlers } from "./api";
import { Markdown } from "./Markdown";
import type { AgentInfo, AgentStep, ChatResponse, Citation, Health, HistoryMessage, TraceCall } from "./types";

type Mode = "chat" | "agent" | "search";

interface Message {
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

const EXAMPLES = [
  "Mức lương tối thiểu vùng I là bao nhiêu?",
  "Thời hiệu xử phạt vi phạm hành chính là bao lâu?",
  "Giảm 30% thuế thu nhập doanh nghiệp áp dụng cho ai?",
];

let nextId = 1;

const MAX_HISTORY = 12; // messages (6 turns) sent to the agent with each question

/** Conversation memory: the agent keeps no state, so every question carries the earlier turns. Failed, refused-by-guard
 *  and search-only turns are left out (they are not part of the conversation the model should follow). */
function buildHistory(all: Message[]): HistoryMessage[] {
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

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("chat");
  const [stream, setStream] = useState(true);
  const [topK, setTopK] = useState(5);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<(Health & { points?: number }) | null>(null);
  const [offline, setOffline] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  const refreshHealth = useCallback(() => {
    getHealth()
      .then((h) => {
        setHealth(h);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, []);

  useEffect(refreshHealth, [refreshHealth]);
  // Follow the text only while the reader is at (or near) the bottom; never fight a reader who scrolled up.
  const scrollToBottom = useCallback((force = false) => {
    const el = mainRef.current;
    if (el && (force || el.scrollHeight - el.scrollTop - el.clientHeight < 140)) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(() => scrollToBottom(), [messages, scrollToBottom]);

  const patch = (id: number, changes: Partial<Message>) =>
    setMessages((all) => all.map((m) => (m.id === id ? { ...m, ...changes } : m)));

  async function send(question: string) {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    const history = mode === "agent" ? buildHistory(messages) : [];
    setInput("");
    setBusy(true);
    // Ids must be created OUTSIDE the state updater: React StrictMode runs updaters twice in dev.
    const userId = nextId++;
    const answerId = nextId++;
    setMessages((all) => [
      ...all,
      { id: userId, role: "user", text: q },
      { id: answerId, role: "assistant", text: "", pending: true, animate: mode === "agent" || (mode === "chat" && stream) },
    ]);
    requestAnimationFrame(() => scrollToBottom(true));
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (mode === "search") {
        const res = await search(q, topK, controller.signal);
        patch(answerId, { text: `${res.results.length} đoạn liên quan nhất`, citations: res.results, searchMs: res.latency_ms, pending: false });
      } else if (mode === "agent" || stream) {
        let text = "";
        const steps: AgentStep[] = [];
        const handlers: StreamHandlers = {
            onStep: (step) => {
              steps.push(step);
              patch(answerId, { steps: [...steps] });
            },
            onSources: (sources) => patch(answerId, { citations: sources, candidates: true }),
            onToken: (t) => {
              text += t;
              patch(answerId, { text });
            },
            onDone: (final) =>
              patch(answerId, { text: final.answer, citations: final.citations, candidates: false, meta: final, pending: false, steps: final.agent?.steps ?? steps }),
        };
        if (mode === "agent") await agentStream(q, topK, handlers, controller.signal, history);
        else await chatStream(q, topK, handlers, controller.signal);
      } else {
        const res = await chat(q, topK, controller.signal);
        patch(answerId, { text: res.answer, citations: res.citations, meta: res, pending: false });
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      patch(answerId, { error: aborted ? "Đã dừng." : (err as Error).message, pending: false });
      if (!aborted) refreshHealth();
    } finally {
      patch(answerId, { pending: false });
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>TrustRAG</h1>
          <p className="subtitle">Tra cứu văn bản pháp luật có trích dẫn nguồn</p>
        </div>
        <div className={`status ${offline ? "bad" : "ok"}`} title="Bấm để kiểm tra lại" onClick={refreshHealth}>
          <span className="dot" />
          {offline
            ? "API offline"
            : health
              ? `${health.llm_provider} · ${health.model}${health.points != null ? ` · ${health.points} chunks` : ""}`
              : "Đang kết nối…"}
        </div>
      </header>

      <main ref={mainRef}>
        {messages.length === 0 && (
          <div className="empty">
            <p>Hãy đặt một câu hỏi về các văn bản đã nạp. Ví dụ:</p>
            {EXAMPLES.map((ex) => (
              <button key={ex} className="example" onClick={() => send(ex)} disabled={busy}>
                {ex}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} message={m} onGrow={scrollToBottom} />
        ))}
      </main>

      <footer>
        <div className="options">
          <div className="seg">
            <button className={mode === "chat" ? "on" : ""} onClick={() => setMode("chat")}>Hỏi đáp</button>
            <button className={mode === "agent" ? "on" : ""} onClick={() => setMode("agent")} title="Agent tự định tuyến, chấm điểm bằng chứng, thử lại, kiểm tra câu trả lời và nhớ cuộc trò chuyện (6 lượt gần nhất)">Agent</button>
            <button className={mode === "search" ? "on" : ""} onClick={() => setMode("search")}>Chỉ tìm kiếm</button>
          </div>
          <label className={mode !== "chat" ? "disabled" : ""}>
            <input type="checkbox" checked={mode === "chat" ? stream : mode === "agent"} disabled={mode !== "chat"} onChange={(e) => setStream(e.target.checked)} /> Streaming
          </label>
          <label>
            Top-k
            <select value={topK} onChange={(e) => setTopK(Number(e.target.value))}>
              {[3, 5, 8, 10].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          {messages.length > 0 && (
            <button className="link" onClick={() => setMessages([])} disabled={busy}>Xóa hội thoại</button>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            value={input}
            rows={2}
            placeholder="Nhập câu hỏi… (Enter để gửi, Shift+Enter xuống dòng)"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          {busy ? (
            <button type="button" className="stop" onClick={() => abortRef.current?.abort()}>Dừng</button>
          ) : (
            <button type="submit" disabled={input.trim().length < 3}>Gửi</button>
          )}
        </form>
      </footer>
    </div>
  );
}

/** Reveals `target` progressively (~60 fps). Tokens arrive in bursts; this turns them into an even flow.
 *  Speed adapts to the backlog (ceil(backlog/18) chars per frame), so it never falls far behind the stream. */
function useSmoothText(target: string, enabled: boolean) {
  const [len, setLen] = useState(enabled ? 0 : target.length);
  const lenRef = useRef(len);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (!enabled) {
      lenRef.current = target.length;
      setLen(target.length);
      return;
    }
    let raf = 0;
    const tick = () => {
      const t = targetRef.current;
      const cur = Math.min(lenRef.current, t.length);
      const next = cur < t.length ? Math.min(t.length, cur + Math.max(1, Math.ceil((t.length - cur) / 18))) : cur;
      lenRef.current = next;
      setLen(next);
      if (next < t.length) raf = requestAnimationFrame(tick); // stops when caught up; restarts when target grows
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);

  const shown = Math.min(len, target.length);
  return { text: target.slice(0, shown), typing: enabled && shown < target.length };
}

function MessageView({ message: m, onGrow }: { message: Message; onGrow: () => void }) {
  const [active, setActive] = useState<number | null>(null);
  const { text, typing } = useSmoothText(m.text, !!m.animate);
  // hide a half-written marker such as "[" or "[1" until it is complete
  const display = typing ? text.replace(/\[\d*$/, "") : text;

  useLayoutEffect(onGrow, [display, typing, onGrow]);

  if (m.role === "user") {
    return <div className="msg user">{m.text}</div>;
  }

  const cited = new Set((m.citations ?? []).map((c) => c.id));
  const settled = !m.pending && !typing; // details appear once the text has finished

  return (
    <div className="msg assistant">
      {!!m.steps?.length && <StepTrace steps={m.steps} agent={m.meta?.agent} open={!!m.pending} />}
      {m.error ? (
        <div className="error">⚠ {m.error}</div>
      ) : (
        <div className="answer">
          <Markdown
            text={display}
            typing={!!m.pending || typing}
            cite={{ cited, active, onCite: (id) => setActive(active === id ? null : id) }}
          />
        </div>
      )}

      {m.meta && settled && (
        <div className="meta">
          {answerBadge(m.meta) && (
            <span className={`badge ${answerBadge(m.meta)!.cls}`} title={answerBadge(m.meta)!.title}>
              {answerBadge(m.meta)!.text}
            </span>
          )}
          {!["knowledge", "knowledge_fallback", "chat", "web", "web_unavailable", "blocked"].includes(m.meta.answer_mode ?? "") && (
            <span title="Điểm truy xuất top-1, chỉ là heuristic">độ liên quan {m.meta.confidence.toFixed(2)}</span>
          )}
          <span>
            {Math.round(m.meta.latency_ms.total_ms)} ms (tìm {Math.round(m.meta.latency_ms.retrieval_ms)} · sinh {Math.round(m.meta.latency_ms.generation_ms)})
          </span>
          <span>{m.meta.model}</span>
          {m.meta.retrieval_mode && <span>{m.meta.retrieval_mode}</span>}
          {m.meta.cached && <span className="badge good" title="Trả lời từ bộ nhớ đệm của gateway">cache</span>}
          {m.meta.agent?.verification?.status === "warning" && (
            <span className="badge warn" title="Có trích dẫn sai hoặc số liệu không có trong nguồn">Cần kiểm chứng</span>
          )}
          {m.meta.agent && <span>{m.meta.agent.llm_calls} lần gọi LLM · công cụ: {m.meta.agent.tools || "?"}</span>}
        </div>
      )}
      {m.meta && settled && <LatencyBreakdown latency={m.meta.latency_ms} />}
      {m.meta?.search_query && settled && (
        <div className="meta">
          <span>Truy vấn tìm kiếm: {m.meta.search_query}</span>
        </div>
      )}
      {m.searchMs != null && settled && <div className="meta"><span>{Math.round(m.searchMs)} ms</span></div>}

      {!!m.citations?.length && (
        <div className="sources">
          <h4>{m.candidates ? "Nguồn đã truy xuất (đang tạo câu trả lời…)" : m.meta ? "Nguồn được trích dẫn" : "Kết quả"}</h4>
          {m.citations.map((c) => (
            <SourceCard key={c.id} c={c} active={active === c.id} onClick={() => setActive(active === c.id ? null : c.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

const short = (v: unknown) => {
  const t = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v) ?? String(v);
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
};

/** get_weather(location="hà nội", days=2): what the agent asked the tool, readable at a glance. */
const fmtArgs = (name: string, args: Record<string, unknown>) =>
  `${name}(${Object.entries(args)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${short(v)}`)
    .join(", ")})`;

function CallView({ call }: { call: TraceCall }) {
  if (call.type === "tool") {
    return (
      <details className={`call ${call.ok ? "" : "failed"}`}>
        <summary>
          <span className="tag tool">công cụ</span> <code>{fmtArgs(call.name, call.args)}</code>{" "}
          <span className={call.ok ? "okmark" : "badmark"}>{call.ok ? "✓" : "✗"}</span>
          <span className="ms">
            {Math.round(call.ms)} ms{call.backend ? ` · ${call.backend}` : ""}
          </span>
        </summary>
        {call.ok ? (
          <>
            <div className="kv"><b>Kết quả:</b> {call.result}</div>
            {call.preview && <pre className="trace-pre">{call.preview}</pre>}
          </>
        ) : (
          <div className="kv bad"><b>Lỗi:</b> {call.error}</div>
        )}
      </details>
    );
  }
  return (
    <details className={`call ${call.ok ? "" : "failed"}`}>
      <summary>
        <span className="tag llm">LLM</span> {call.purpose} · {call.model}{" "}
        <span className={call.ok ? "okmark" : "badmark"}>{call.ok ? "✓" : "✗"}</span>
        <span className="ms">{Math.round(call.ms)} ms</span>
      </summary>
      <div className="kv"><b>Gửi đi:</b></div>
      <pre className="trace-pre">{call.prompt}</pre>
      <div className="kv"><b>Trả về:</b></div>
      <pre className="trace-pre">{call.error ? `Lỗi: ${call.error}` : call.reply || "(rỗng)"}</pre>
      {call.note && <div className="kv bad">⚠ {call.note}</div>}
      {!!call.history_messages && <div className="kv">kèm {call.history_messages} tin nhắn trước đó của cuộc trò chuyện</div>}
    </details>
  );
}

function StepDetail({ step }: { step: AgentStep }) {
  const d = step.decision;
  if (!d && !step.calls?.length) return null;
  return (
    <div className="detail">
      {d && (
        <div className="kv decision">
          <b>Quyết định:</b>{" "}
          {d.route && <span className="tag route">{d.route}</span>}
          {d.by && <span className="tag by">{d.by === "llm" ? "bởi LLM" : "bởi quy tắc"}</span>}
          {d.tool !== undefined && (
            <span>
              {" "}công cụ tiếp theo: <code>{d.tool ?? "không gọi công cụ"}</code>
            </span>
          )}
          {d.why && <div>Lý do: {d.why}</div>}
          {d.rewritten && (
            <div>
              «{d.from}» → «{d.to}»
            </div>
          )}
        </div>
      )}
      {step.calls?.map((c, i) => <CallView key={i} call={c} />)}
    </div>
  );
}

/** The agent's visible reasoning, for debugging: one line per graph step with its duration; each step expands to
 *  WHY it went that way (rule or LLM, which tool is next) and every tool / LLM call it made with arguments and results. */
function StepTrace({ steps, agent, open }: { steps: AgentStep[]; agent?: AgentInfo; open: boolean }) {
  const [copied, setCopied] = useState(false);
  const notes: string[] = [];
  if (agent?.history_messages) notes.push(`nhớ ${agent.history_messages} tin nhắn trước`);
  if (agent?.guard && agent.guard.verdict !== "ok") notes.push(`an toàn: ${agent.guard.verdict}`);
  if (agent?.guard?.output_leak) notes.push("đã chặn rò rỉ chỉ dẫn hệ thống");
  if (agent?.skills?.length) notes.push(`kỹ năng: ${agent.skills.join(", ")}`);
  const copy = () => {
    navigator.clipboard
      ?.writeText(JSON.stringify({ route: agent?.route, guard: agent?.guard, standalone_question: agent?.standalone_question, steps }, null, 2))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <details className="steps" open={open}>
      <summary>
        Quá trình xử lý · {steps.length} bước · {Math.round(steps.reduce((t, s) => t + s.ms, 0))} ms
        {notes.length > 0 && <span className="notes"> · {notes.join(" · ")}</span>}
      </summary>
      {agent?.standalone_question && (
        <div className="kv">Câu hỏi sau khi ghép với ngữ cảnh: <i>{agent.standalone_question}</i></div>
      )}
      <ol>
        {steps.map((s, i) => (
          <li key={i}>
            <b>{STEP_LABELS[s.node] ?? s.node}</b> {s.summary}
            {s.ms > 0 && <span className="ms">{Math.round(s.ms)} ms</span>}
            <StepDetail step={s} />
          </li>
        ))}
      </ol>
      {!open && (
        <button className="link small" onClick={copy} title="Sao chép toàn bộ trace dạng JSON để gửi khi báo lỗi">
          {copied ? "Đã sao chép" : "Sao chép trace (JSON)"}
        </button>
      )}
    </details>
  );
}

const STEP_LABELS: Record<string, string> = {
  guard: "Kiểm tra an toàn",
  contextualize: "Nhớ hội thoại",
  skills: "Kỹ năng",
  output_check: "Kiểm tra đầu ra",
  plan: "Lập kế hoạch",
  retrieve: "Truy xuất",
  grade: "Chấm bằng chứng",
  rewrite: "Viết lại truy vấn",
  web: "Tra cứu internet",
  select: "Chọn nguồn",
  fallback: "Chuyển hướng",
  generate: "Sinh câu trả lời",
  verify: "Kiểm tra",
};

/** Where the time went: first token, then every stage the server measured. This is what you tune against. */
function LatencyBreakdown({ latency }: { latency: ChatResponse["latency_ms"] }) {
  const stages = Object.entries(latency.stages ?? {});
  if (latency.ttft_ms == null && !stages.length) return null;
  return (
    <div className="meta">
      {latency.ttft_ms != null && <span title="Từ lúc gửi đến token đầu tiên">token đầu {Math.round(latency.ttft_ms)} ms</span>}
      {stages.map(([k, v]) => (
        <span key={k}>
          {k.replace(/_ms$/, "")} {Math.round(v)} ms
        </span>
      ))}
    </div>
  );
}

function SourceCard({ c, active, onClick }: { c: Citation; active: boolean; onClick: () => void }) {
  return (
    <div className={`source ${active ? "active" : ""}`} onClick={onClick}>
      <div className="source-head">
        <span className="cite static">{c.id}</span>
        {c.kind === "web" ? (
          <>
            <strong>{c.doc_label}</strong>
            {c.article_title ? ` · ${c.article_title}` : ""}
          </>
        ) : (
          <>
            <strong>{c.doc_label}</strong> · Điều {c.article}
            {c.article_title ? `. ${c.article_title}` : ""}
          </>
        )}
        {c.kind !== "web" && <span className="score">{c.score.toFixed(3)}</span>}
      </div>
      {c.chapter && <div className="chapter">{c.chapter}</div>}
      {c.kind === "web" && c.url && (
        <div className="chapter">
          <a href={c.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            {c.url}
          </a>
        </div>
      )}
      {active && <pre className="snippet">{c.snippet}</pre>}
    </div>
  );
}

/** The label that tells the reader where the answer came from (documents with citations vs. the model's own knowledge). */
function answerBadge(meta: ChatResponse): { cls: string; text: string; title: string } | null {
  switch (meta.answer_mode) {
    case "chat":
      return null;
    case "blocked":
      return { cls: "warn", text: "Đã từ chối (an toàn)", title: "Yêu cầu bị chặn bởi lớp bảo vệ: có dấu hiệu tấn công prompt hoặc đòi hướng dẫn gây hại" };
    case "web":
      return { cls: "info", text: "Từ internet", title: "Dữ liệu tra cứu trực tiếp từ các trang web ở phần nguồn; có thể khác nhau giữa các nguồn, hãy kiểm tra thời điểm cập nhật" };
    case "web_unavailable":
      if (meta.agent?.web_note === "no_location") {
        return { cls: "info", text: "Cần thêm địa điểm", title: "Câu hỏi thời tiết chưa nói rõ địa điểm nên trợ lý hỏi lại, không đoán" };
      }
      return { cls: "warn", text: "Không lấy được dữ liệu internet", title: "Cần dữ liệu hiện tại nhưng công cụ tra cứu không trả kết quả; trợ lý không đoán số liệu" };
    case "knowledge":
      return { cls: "info", text: "Kiến thức chung", title: "Không lấy từ tài liệu nên không có trích dẫn; hãy kiểm chứng nếu cần" };
    case "knowledge_fallback":
      return { cls: "warn", text: "Không có trong tài liệu · kiến thức chung", title: "Đã tra cứu tài liệu nhưng không thấy nội dung phù hợp; câu trả lời dựa trên kiến thức của mô hình, chưa được kiểm chứng" };
    case "mixed":
      return { cls: "good", text: "Có trích dẫn + bổ sung ngoài tài liệu", title: "Phần có [số] lấy từ tài liệu; đoạn 💡 cuối là kiến thức chung, chưa được kiểm chứng" };
    default:
      return meta.grounded
        ? { cls: "good", text: "Có trích dẫn", title: "" }
        : { cls: "warn", text: refusalText(meta.refusal_reason), title: "" };
  }
}

function refusalText(reason: string | null): string {
  switch (reason) {
    case "low_retrieval_score":
      return "Ngoài phạm vi tài liệu";
    case "insufficient_evidence":
      return "Không đủ bằng chứng";
    case "model_declined":
      return "Không tìm thấy thông tin";
    case "no_citation":
      return "Chưa có trích dẫn, cần kiểm chứng";
    default:
      return "Không có trích dẫn";
  }
}
