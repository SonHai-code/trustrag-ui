import { useEffect, useState } from "react";
import * as api from "./api";
import { checkPassword, relativeTime } from "./lib";
import { Modal } from "./Modal";
import type { AuthUser, SessionInfo, Settings } from "./types";

type Tab = "account" | "security" | "data";

interface Props {
  user: AuthUser;
  theme: NonNullable<Settings["theme"]>;
  onTheme: (t: NonNullable<Settings["theme"]>) => void;
  onUser: (u: AuthUser) => void;
  onClose: () => void;
  onSignedOut: () => void;
  onConversationsCleared: () => void;
  notify: (msg: string) => void;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SettingsDialog(p: Props) {
  const [tab, setTab] = useState<Tab>("account");
  return (
    <Modal title="Cài đặt" onClose={p.onClose} wide>
      <div className="tabs" role="tablist">
        {([["account", "Tài khoản"], ["security", "Bảo mật"], ["data", "Dữ liệu"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "account" && <AccountTab {...p} />}
      {tab === "security" && <SecurityTab {...p} />}
      {tab === "data" && <DataTab {...p} />}
    </Modal>
  );
}

function AccountTab({ user, theme, onTheme, onUser, notify }: Props) {
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      onUser(await api.updateProfile(name));
      notify("Đã lưu tên hiển thị.");
    } catch (e) {
      notify(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel">
      <label>Tên hiển thị<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label>Email<input value={user.email} disabled /></label>
      <button className="primary inline" disabled={busy || !name.trim() || name.trim() === user.name} onClick={save}>Lưu</button>
      <hr />
      <label>
        Giao diện
        <select value={theme} onChange={(e) => onTheme(e.target.value as Props["theme"])}>
          <option value="system">Theo hệ thống</option>
          <option value="light">Sáng</option>
          <option value="dark">Tối</option>
        </select>
      </label>
    </div>
  );
}

function SecurityTab({ user, notify, onSignedOut }: Props) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const check = checkPassword(next, user.email);

  const load = () => api.listSessions().then(setSessions).catch((e) => notify(msg(e)));
  useEffect(() => void load(), []);

  const change = async () => {
    setBusy(true);
    try {
      await api.changePassword(cur, next);
      setCur("");
      setNext("");
      setAgain("");
      notify("Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.");
      load();
    } catch (e) {
      notify(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h3>Đổi mật khẩu</h3>
      <label>Mật khẩu hiện tại<input type="password" value={cur} autoComplete="current-password" onChange={(e) => setCur(e.target.value)} /></label>
      <label>Mật khẩu mới<input type="password" value={next} autoComplete="new-password" onChange={(e) => setNext(e.target.value)} /></label>
      {next && (
        <div className="strength">
          <div className={`bar s${check.score}`}><i /><i /><i /><i /></div>
          <span>{check.problems.length ? check.problems.join(" · ") : ["", "Yếu", "Khá", "Tốt", "Rất tốt"][check.score]}</span>
        </div>
      )}
      <label>Nhập lại mật khẩu mới<input type="password" value={again} autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} /></label>
      {again && again !== next && <div className="form-error">Hai mật khẩu chưa khớp.</div>}
      <button className="primary inline" disabled={busy || !cur || !check.ok || again !== next} onClick={change}>Đổi mật khẩu</button>
      <hr />
      <h3>Thiết bị đang đăng nhập</h3>
      {!sessions && <p className="muted">Đang tải…</p>}
      <ul className="sessions">
        {sessions?.map((s) => (
          <li key={s.id}>
            <div>
              <b>{shortAgent(s.userAgent)}</b> {s.current && <span className="badge good">thiết bị này</span>}
              <small>{s.ip} · dùng {relativeTime(s.lastUsedAt, new Date())}</small>
            </div>
            {!s.current && (
              <button className="ghost small danger" onClick={() => api.revokeSession(s.id).then(load).catch((e) => notify(msg(e)))}>Đăng xuất</button>
            )}
          </li>
        ))}
      </ul>
      <button className="ghost danger inline" onClick={() => api.logoutAll().then(onSignedOut).catch((e) => notify(msg(e)))}>Đăng xuất khỏi mọi thiết bị</button>
    </div>
  );
}

/** "Mozilla/5.0 (Windows NT 10.0...) Chrome/120" -> "Chrome · Windows" */
export function shortAgent(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Trình duyệt";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

function DataTab({ onConversationsCleared, onSignedOut, notify }: Props) {
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmAcct, setConfirmAcct] = useState(false);
  const [pw, setPw] = useState("");
  return (
    <div className="panel">
      <h3>Lịch sử trò chuyện</h3>
      <p className="muted">Xóa toàn bộ cuộc trò chuyện đã lưu. Không thể khôi phục.</p>
      {!confirmAll ? (
        <button className="ghost danger inline" onClick={() => setConfirmAll(true)}>Xóa tất cả cuộc trò chuyện</button>
      ) : (
        <div className="confirm">
          Chắc chắn xóa tất cả?
          <button className="danger-btn" onClick={() => api.deleteAllConversations().then(() => { onConversationsCleared(); setConfirmAll(false); notify("Đã xóa tất cả cuộc trò chuyện."); }).catch((e) => notify(msg(e)))}>Xóa</button>
          <button className="ghost" onClick={() => setConfirmAll(false)}>Hủy</button>
        </div>
      )}
      <hr />
      <h3>Xóa tài khoản</h3>
      <p className="muted">Xóa vĩnh viễn tài khoản cùng toàn bộ lịch sử. Nhập mật khẩu để xác nhận.</p>
      {!confirmAcct ? (
        <button className="ghost danger inline" onClick={() => setConfirmAcct(true)}>Xóa tài khoản…</button>
      ) : (
        <div className="confirm col">
          <input type="password" placeholder="Mật khẩu" value={pw} autoComplete="current-password" onChange={(e) => setPw(e.target.value)} />
          <div>
            <button className="danger-btn" disabled={!pw} onClick={() => api.deleteAccount(pw).then(onSignedOut).catch((e) => notify(msg(e)))}>Xóa vĩnh viễn</button>
            <button className="ghost" onClick={() => { setConfirmAcct(false); setPw(""); }}>Hủy</button>
          </div>
        </div>
      )}
    </div>
  );
}
