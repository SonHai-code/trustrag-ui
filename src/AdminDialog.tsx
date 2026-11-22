import { useEffect, useState } from "react";
import * as api from "./api";
import { relativeTime } from "./lib";
import { Modal } from "./Modal";
import type { AdminUser } from "./types";

export function AdminDialog({ selfId, onClose, notify }: { selfId: string; onClose: () => void; notify: (m: string) => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const load = () => api.adminUsers().then(setUsers).catch((e) => notify((e as Error).message));
  useEffect(() => void load(), []);

  const patch = (id: string, p: { role?: "user" | "admin"; disabled?: boolean }) =>
    api.adminPatch(id, p).then((u) => setUsers((all) => (all ?? []).map((x) => (x.id === u.id ? u : x)))).catch((e) => notify((e as Error).message));

  return (
    <Modal title="Quản trị người dùng" onClose={onClose} wide>
      {!users ? (
        <p className="muted">Đang tải…</p>
      ) : (
        <div className="table-wrap">
          <table className="users">
            <thead>
              <tr><th>Người dùng</th><th>Vai trò</th><th>Đăng nhập gần nhất</th><th>Trạng thái</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.disabled ? "off" : ""}>
                  <td><b>{u.name}</b><small>{u.email}</small></td>
                  <td>{u.role === "admin" ? "Quản trị" : "Người dùng"}</td>
                  <td>{u.lastLoginAt ? relativeTime(u.lastLoginAt, new Date()) : "—"}</td>
                  <td>{u.disabled ? <span className="badge warn">Đã khóa</span> : <span className="badge good">Hoạt động</span>}</td>
                  <td className="row-actions">
                    {u.id !== selfId && (
                      <>
                        <button className="ghost small" onClick={() => patch(u.id, { disabled: !u.disabled })}>{u.disabled ? "Mở khóa" : "Khóa"}</button>
                        <button className="ghost small" onClick={() => patch(u.id, { role: u.role === "admin" ? "user" : "admin" })}>{u.role === "admin" ? "Bỏ quyền quản trị" : "Cấp quyền quản trị"}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
