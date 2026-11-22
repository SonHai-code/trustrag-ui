import { Icon } from "./Icon";
import { useMemo, useState } from "react";
import { groupConversations, initials } from "./lib";
import type { AuthUser, ConvSummary } from "./types";

interface Props {
  conversations: ConvSummary[];
  loading: boolean;
  activeId: string | null;
  user: AuthUser;
  open: boolean; // mobile drawer
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
  onAdmin: () => void;
  onLogout: () => void;
  accounts: boolean; // false in the no-accounts demo build
}

export function Sidebar(p: Props) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const groups = useMemo(() => groupConversations(p.conversations, new Date(), query), [p.conversations, query]);

  const startRename = (c: ConvSummary) => {
    setEditing(c.id);
    setDraft(c.title);
    setConfirming(null);
  };
  const commitRename = (c: ConvSummary) => {
    const t = draft.trim();
    setEditing(null);
    if (t && t !== c.title) p.onRename(c.id, t);
  };

  return (
    <>
      {p.open && <div className="scrim" onClick={p.onClose} />}
      <aside className={`sidebar ${p.open ? "open" : ""}`} aria-label="Lịch sử trò chuyện">
        <div className="side-top">
          <div className="logo"><span className="brand-mark sm">T</span> TrustRAG</div>
          <button className="primary new" onClick={p.onNew}><Icon name="plus" /> Cuộc trò chuyện mới</button>
          {p.accounts && (
            <input className="search" type="search" placeholder="Tìm cuộc trò chuyện…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Tìm cuộc trò chuyện" />
          )}
        </div>

        <nav className="side-list">
          {p.loading && <div className="skeletons" aria-busy="true"><i /><i /><i /><i /></div>}
          {!p.loading && p.accounts && !groups.length && (
            <p className="muted pad">{query ? "Không có cuộc trò chuyện nào khớp." : "Chưa có cuộc trò chuyện nào. Hãy đặt câu hỏi đầu tiên."}</p>
          )}
          {!p.accounts && <p className="muted pad">Bản demo không có tài khoản: hội thoại không được lưu.</p>}
          {groups.map((g) => (
            <section key={g.label}>
              <h3>{g.label}</h3>
              {g.items.map((c) => (
                <div key={c.id} className={`conv ${c.id === p.activeId ? "active" : ""}`}>
                  {editing === c.id ? (
                    <input
                      className="rename"
                      value={draft}
                      autoFocus
                      maxLength={120}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(c)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(c);
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <button className="conv-title" onClick={() => p.onSelect(c.id)} onDoubleClick={() => startRename(c)} title={c.title}>
                      {c.pinned && <span className="pin" aria-label="đã ghim"><Icon name="pin" size={12} /></span>}
                      <span>{c.title}</span>
                    </button>
                  )}
                  {editing !== c.id &&
                    (confirming === c.id ? (
                      <span className="conv-actions show">
                        <button className="ghost small danger" onClick={() => { setConfirming(null); p.onDelete(c.id); }}>Xóa</button>
                        <button className="ghost small" onClick={() => setConfirming(null)}>Hủy</button>
                      </span>
                    ) : (
                      <span className="conv-actions">
                        <button className="ghost icon" onClick={() => p.onPin(c.id, !c.pinned)} title={c.pinned ? "Bỏ ghim" : "Ghim"} aria-label={c.pinned ? "Bỏ ghim" : "Ghim"}><Icon name="pin" size={14} /></button>
                        <button className="ghost icon" onClick={() => startRename(c)} title="Đổi tên" aria-label="Đổi tên"><Icon name="edit" size={14} /></button>
                        <button className="ghost icon" onClick={() => setConfirming(c.id)} title="Xóa" aria-label="Xóa"><Icon name="trash" size={14} /></button>
                      </span>
                    ))}
                </div>
              ))}
            </section>
          ))}
        </nav>

        {p.accounts && (
          <div className="side-user">
            {menu && (
              <div className="user-menu" role="menu">
                <button role="menuitem" onClick={() => { setMenu(false); p.onSettings(); }}><Icon name="settings" /> Cài đặt</button>
                {p.user.role === "admin" && <button role="menuitem" onClick={() => { setMenu(false); p.onAdmin(); }}><Icon name="users" /> Quản trị người dùng</button>}
                <button role="menuitem" onClick={() => { setMenu(false); p.onLogout(); }}><Icon name="logout" /> Đăng xuất</button>
              </div>
            )}
            <button className="user-btn" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
              <span className="avatar user">{initials(p.user.name)}</span>
              <span className="who">
                <b>{p.user.name}</b>
                <small>{p.user.email}</small>
              </span>
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
