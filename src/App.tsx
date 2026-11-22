import { Icon } from "./Icon";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import * as api from "./api";
import type { StreamHandlers } from "./api";
import { AdminDialog } from "./AdminDialog";
import { AuthProvider, useAuth } from "./auth";
import { buildHistory, fitMeta, restoreMessage, slimMeta } from "./lib";
import { LoginPage } from "./LoginPage";
import { MessageView } from "./MessageView";
import { SettingsDialog } from "./SettingsDialog";
import { AUTH_ENABLED } from "./session";
import { Sidebar } from "./Sidebar";
import type { AgentStep, AuthUser, ChatResponse, ConvSummary, Health, Message, ModelInfo, Settings, StoredMeta } from "./types";

type Mode = "chat" | "agent" | "search";
type Theme = NonNullable<Settings["theme"]>;

const EXAMPLES = [
  { q: "Mức lương tối thiểu vùng I là bao nhiêu?", hint: "Tiền lương" },
  { q: "Thời hiệu xử phạt vi phạm hành chính là bao lâu?", hint: "Xử phạt" },
  { q: "Giảm 30% thuế thu nhập doanh nghiệp áp dụng cho ai?", hint: "Thuế" },
];

const MODE_LABEL: Record<Mode, string> = { chat: "Hỏi đáp", agent: "Agent", search: "Chỉ tìm kiếm" };

let nextId = 1;

// Light, per-browser conveniences: storage may be unavailable (private mode), so every access is guarded.
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { status, user, retry } = useAuth();
  if (status === "loading") return <div className="splash"><div className="brand-mark">T</div><p className="muted">Đang tải…</p></div>;
  if (status === "offline") {
    return (
      <div className="splash">
        <div className="brand-mark">T</div>
        <p>Không kết nối được máy chủ.</p>
        <button className="primary inline" onClick={retry}>Thử lại</button>
      </div>
    );
  }
  if (status === "anon" || !user) return <LoginPage />;
  return <Workspace key={user.id} />;
}

function Workspace() {
  const { user, setUser, signOut } = useAuth();
  const me = user as AuthUser;
  const accounts = AUTH_ENABLED;

  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [loadingList, setLoadingList] = useState(accounts);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingConv, setLoadingConv] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>((me.settings?.mode as Mode) ?? "agent");
  const [stream, setStream] = useState(me.settings?.stream ?? true);
  const [topK, setTopK] = useState(me.settings?.topK ?? 5);
  const [theme, setThemeState] = useState<Theme>((me.settings?.theme ?? (lsGet("trustrag.theme") as Theme)) || "system");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<(Health & { points?: number }) | null>(null);
  const [offline, setOffline] = useState(false);
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState<"settings" | "admin" | null>(null);
  const [toast, setToast] = useState("");
  const [showJump, setShowJump] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  activeRef.current = activeId;

  const notify = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? "" : t)), 4500);
  }, []);

  // ---------- theme ----------
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  // ---------- settings are saved to the account a moment after the last change ----------
  const saveSettingsSoon = useCallback((s: Settings) => {
    if (!accounts) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.saveSettings(s).catch(() => undefined); // a failed save only means the choice is not remembered on other devices
    }, 700);
  }, [accounts]);
  const current = (over: Settings): Settings => ({ model: modelId || undefined, mode, topK, stream, theme, ...over });

  const chooseModel = (id: string) => {
    setModelId(id);
    api.setModel(id);
    if (!accounts) lsSet("trustrag.model", id);
    saveSettingsSoon(current({ model: id }));
  };
  const chooseMode = (m: Mode) => {
    setMode(m);
    saveSettingsSoon(current({ mode: m }));
  };
  const chooseTheme = (t: Theme) => {
    setThemeState(t);
    lsSet("trustrag.theme", t);
    saveSettingsSoon(current({ theme: t }));
  };

  // ---------- start-up data ----------
  const refreshHealth = useCallback(() => {
    api.getHealth().then((h) => { setHealth(h); setOffline(false); }).catch(() => setOffline(true));
  }, []);
  useEffect(refreshHealth, [refreshHealth]);

  useEffect(() => {
    api.getModels()
      .then(({ default: def, models }) => {
        setModelList(models);
        const wanted = me.settings?.model || lsGet("trustrag.model");
        const id = models.some((m) => m.id === wanted) ? (wanted as string) : def;
        setModelId(id);
        api.setModel(id);
      })
      .catch(() => setModelList([])); // an older gateway without /models: the single default model is used
  }, []);

  useEffect(() => {
    if (!accounts) return;
    api.listConversations()
      .then(setConversations)
      .catch((e) => notify((e as Error).message))
      .finally(() => setLoadingList(false));
  }, []);

  // ---------- scrolling ----------
  const scrollToBottom = useCallback((force = false) => {
    const el = mainRef.current;
    if (el && (force || el.scrollHeight - el.scrollTop - el.clientHeight < 140)) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(() => scrollToBottom(), [messages, scrollToBottom]);
  const onScroll = () => {
    const el = mainRef.current;
    if (el) setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 300);
  };

  const patch = (id: number, changes: Partial<Message>) =>
    setMessages((all) => all.map((m) => (m.id === id ? { ...m, ...changes } : m)));

  // ---------- conversations ----------
  const stop = () => abortRef.current?.abort();

  const newChat = () => {
    stop();
    setActiveId(null);
    setMessages([]);
    setDrawer(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const openConversation = async (id: string) => {
    if (id === activeId) {
      setDrawer(false);
      return;
    }
    stop();
    setActiveId(id);
    setMessages([]);
    setDrawer(false);
    setLoadingConv(true);
    try {
      const { messages: stored } = await api.getConversation(id);
      if (activeRef.current !== id) return; // the user already moved on
      setMessages(stored.map((m) => restoreMessage(m, nextId++)));
      requestAnimationFrame(() => scrollToBottom(true));
    } catch (e) {
      notify((e as Error).message);
      if (activeRef.current === id) setActiveId(null);
    } finally {
      setLoadingConv(false);
    }
  };

  const upsert = (c: ConvSummary) =>
    setConversations((all) => [c, ...all.filter((x) => x.id !== c.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  const replace = (c: ConvSummary) => setConversations((all) => all.map((x) => (x.id === c.id ? c : x)));

  const renameConv = (id: string, title: string) => api.patchConversation(id, { title }).then(replace).catch((e) => notify((e as Error).message));
  const pinConv = (id: string, pinned: boolean) => api.patchConversation(id, { pinned }).then(replace).catch((e) => notify((e as Error).message));
  const deleteConv = (id: string) =>
    api.deleteConversation(id)
      .then(() => {
        setConversations((all) => all.filter((x) => x.id !== id));
        if (activeRef.current === id) newChat();
      })
      .catch((e) => notify((e as Error).message));

  /** Saves one finished question + answer; creates the conversation on the first answer (a failed question leaves nothing behind). */
  async function persistTurn(convId: string | null, q: string, answer: { text: string; meta: StoredMeta }) {
    if (!accounts) return;
    try {
      const id = convId ?? (await api.createConversation()).id;
      const saved = await api.appendMessages(id, [
        { role: "user", text: q },
        { role: "assistant", text: answer.text, meta: fitMeta(answer.meta) },
      ]);
      upsert(saved);
      if (convId === null && activeRef.current === null) setActiveId(id);
    } catch (e) {
      notify(`Không lưu được cuộc trò chuyện: ${(e as Error).message}`);
    }
  }

  // ---------- asking ----------
  async function send(question: string) {
    const q = question.trim();
    if (q.length < 3 || busy || loadingConv) return;
    const convId = activeId;
    const history = mode === "agent" ? buildHistory(messages) : [];
    const turnMode = mode;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setBusy(true);
    // Ids must be created OUTSIDE the state updater: React StrictMode runs updaters twice in dev.
    const userId = nextId++;
    const answerId = nextId++;
    setMessages((all) => [
      ...all,
      { id: userId, role: "user", text: q },
      { id: answerId, role: "assistant", text: "", pending: true, animate: turnMode === "agent" || (turnMode === "chat" && stream) },
    ]);
    requestAnimationFrame(() => scrollToBottom(true));
    const controller = new AbortController();
    abortRef.current = controller;
    let result: { text: string; meta: StoredMeta } | null = null;

    try {
      if (turnMode === "search") {
        const res = await api.search(q, topK, controller.signal);
        const text = `${res.results.length} đoạn liên quan nhất`;
        patch(answerId, { text, citations: res.results, searchMs: res.latency_ms, pending: false });
        result = { text, meta: slimMeta("search", { citations: res.results, latency_ms: { retrieval_ms: 0, generation_ms: 0, total_ms: res.latency_ms } }) };
      } else if (turnMode === "agent" || stream) {
        let text = "";
        const steps: AgentStep[] = [];
        let final: ChatResponse | null = null;
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
          onDone: (f) => {
            final = f;
            patch(answerId, { text: f.answer, citations: f.citations, candidates: false, meta: f, pending: false, steps: f.agent?.steps ?? steps });
          },
        };
        if (turnMode === "agent") await api.agentStream(q, topK, handlers, controller.signal, history);
        else await api.chatStream(q, topK, handlers, controller.signal);
        const f = final as ChatResponse | null;
        if (f) result = { text: f.answer, meta: slimMeta(turnMode, f) };
      } else {
        const res = await api.chat(q, topK, controller.signal);
        patch(answerId, { text: res.answer, citations: res.citations, meta: res, pending: false });
        result = { text: res.answer, meta: slimMeta("chat", res) };
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
    if (result && result.text.trim() && activeRef.current === convId) await persistTurn(convId, q, result);
  }

  const onInput = (v: string) => {
    setInput(v);
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  const active = conversations.find((c) => c.id === activeId);
  const firstName = me.name.trim().split(/\s+/).slice(-1)[0] ?? "";

  return (
    <div className="shell">
      <Sidebar
        conversations={conversations}
        loading={loadingList}
        activeId={activeId}
        user={me}
        open={drawer}
        accounts={accounts}
        onClose={() => setDrawer(false)}
        onNew={newChat}
        onSelect={openConversation}
        onRename={renameConv}
        onPin={pinConv}
        onDelete={deleteConv}
        onSettings={() => { setDrawer(false); setDialog("settings"); }}
        onAdmin={() => { setDrawer(false); setDialog("admin"); }}
        onLogout={() => { stop(); void signOut(); }}
      />

      <div className="chat">
        <header className="topbar">
          <button className="ghost icon menu-btn" onClick={() => setDrawer(true)} aria-label="Mở danh sách trò chuyện"><Icon name="menu" size={18} /></button>
          <div className="topbar-title">
            <h1>{active?.title ?? "Cuộc trò chuyện mới"}</h1>
            <p className="muted">Tra cứu văn bản pháp luật có trích dẫn nguồn</p>
          </div>
          <div className="topbar-controls">
            <div className="seg" role="tablist" aria-label="Chế độ">
              {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => chooseMode(m)}
                  title={m === "agent" ? "Agent tự định tuyến, chấm điểm bằng chứng, thử lại, kiểm tra câu trả lời và nhớ cuộc trò chuyện (6 lượt gần nhất)" : undefined}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            {modelList.length > 1 && (
              <select className="model-select" value={modelId} onChange={(e) => chooseModel(e.target.value)} disabled={busy} aria-label="Mô hình ngôn ngữ"
                title="Mô hình ngôn ngữ dùng để trả lời (và cho các bước của agent)">
                {modelList.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            )}
            <button className={`status ${offline ? "bad" : "ok"}`} onClick={refreshHealth} aria-label="Trạng thái hệ thống"
              title={offline ? "API offline. Bấm để kiểm tra lại" : health ? `${health.llm_provider} · ${health.model}${health.points != null ? ` · ${health.points} chunks` : ""}` : "Đang kết nối…"}>
              <span className="dot" />
            </button>
          </div>
        </header>

        <main ref={mainRef} onScroll={onScroll}>
          <div className="thread">
            {loadingConv && <div className="skeletons wide" aria-busy="true"><i /><i /><i /></div>}
            {!loadingConv && messages.length === 0 && (
              <div className="empty">
                <div className="brand-mark lg">T</div>
                <h2>Xin chào{firstName ? `, ${firstName}` : ""}</h2>
                <p className="muted">Hãy đặt một câu hỏi về các văn bản pháp luật đã nạp.</p>
                <div className="examples">
                  {EXAMPLES.map((ex) => (
                    <button key={ex.q} className="example" onClick={() => send(ex.q)} disabled={busy}>
                      <small>{ex.hint}</small>
                      {ex.q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => <MessageView key={m.id} message={m} onGrow={scrollToBottom} />)}
          </div>
          {showJump && <button className="jump" onClick={() => scrollToBottom(true)} aria-label="Xuống cuối"><Icon name="down" size={18} /></button>}
        </main>

        <footer className="composer">
          <div className="composer-box">
            <form onSubmit={(e) => { e.preventDefault(); void send(input); }}>
              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                placeholder={mode === "search" ? "Nhập từ khóa để tìm đoạn văn bản liên quan…" : "Nhập câu hỏi pháp luật…"}
                aria-label="Câu hỏi"
                onChange={(e) => onInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent?.isComposing) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
              />
              {busy ? (
                <button type="button" className="send stop" onClick={stop} aria-label="Dừng"><Icon name="stop" size={14} /></button>
              ) : (
                <button type="submit" className="send" disabled={input.trim().length < 3 || loadingConv} aria-label="Gửi"><Icon name="up" size={18} /></button>
              )}
            </form>
            <div className="composer-foot">
              <details className="opts">
                <summary>Tùy chọn</summary>
                <div className="opts-body">
                  <label className={mode !== "chat" ? "disabled" : ""}>
                    <input type="checkbox" checked={mode === "chat" ? stream : mode === "agent"} disabled={mode !== "chat"}
                      onChange={(e) => { setStream(e.target.checked); saveSettingsSoon(current({ stream: e.target.checked })); }} /> Streaming
                  </label>
                  <label>
                    Số đoạn tra cứu (top-k)
                    <select value={topK} onChange={(e) => { setTopK(Number(e.target.value)); saveSettingsSoon(current({ topK: Number(e.target.value) })); }}>
                      {[3, 5, 8, 10].map((k) => <option key={k}>{k}</option>)}
                    </select>
                  </label>
                </div>
              </details>
              <span className="muted">Enter để gửi · Shift+Enter xuống dòng · Kết quả chỉ mang tính tham khảo, hãy đối chiếu văn bản gốc.</span>
            </div>
          </div>
        </footer>
      </div>

      {dialog === "settings" && (
        <SettingsDialog
          user={me}
          theme={theme}
          onTheme={chooseTheme}
          onUser={setUser}
          onClose={() => setDialog(null)}
          onSignedOut={() => { setDialog(null); void signOut(); }}
          onConversationsCleared={() => { setConversations([]); newChat(); }}
          notify={notify}
        />
      )}
      {dialog === "admin" && <AdminDialog selfId={me.id} onClose={() => setDialog(null)} notify={notify} />}
      {toast && <div className="toast" role="status" onClick={() => setToast("")}>{toast}</div>}
    </div>
  );
}
