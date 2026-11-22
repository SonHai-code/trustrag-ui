import { useState } from "react";
import { useAuth } from "./auth";
import { checkPassword, isValidEmail } from "./lib";
import { ApiError } from "./session";

const FEATURES = [
  ["Trích dẫn nguồn", "Mỗi câu trả lời chỉ ra Điều, Khoản của văn bản gốc."],
  ["Agent kiểm chứng", "Tự định tuyến, chấm điểm bằng chứng và kiểm tra lại trước khi trả lời."],
  ["Lưu lịch sử", "Cuộc trò chuyện được lưu theo tài khoản, dùng được trên mọi thiết bị."],
];

export function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);

  const pw = checkPassword(password, email);
  const register = mode === "register";
  const problem = !isValidEmail(email)
    ? "Email chưa đúng định dạng."
    : register && !name.trim()
      ? "Hãy nhập tên hiển thị."
      : register && !pw.ok
        ? `Mật khẩu: ${pw.problems[0].toLowerCase()}.`
        : !register && !password
          ? "Hãy nhập mật khẩu."
          : "";

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setTouched(true);
    if (problem || busy) return;
    setBusy(true);
    setError("");
    try {
      if (register) await signUp(email.trim(), password, name.trim());
      else await signIn(email.trim(), password);
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2 instanceof TypeError || e2.message === "Failed to fetch" ? "Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại." : e2.message);
    } finally {
      setBusy(false);
    }
  }

  const switchMode = (m: "login" | "register") => {
    setMode(m);
    setError("");
    setTouched(false);
  };

  return (
    <div className="login">
      <aside className="login-brand">
        <div className="brand-mark">T</div>
        <h1>TrustRAG</h1>
        <p className="tagline">Trợ lý tra cứu văn bản pháp luật Việt Nam, có trích dẫn nguồn.</p>
        <ul>
          {FEATURES.map(([t, d]) => (
            <li key={t}>
              <b>{t}</b>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </aside>
      <main className="login-form">
        <form onSubmit={submit} noValidate>
          <h2>{register ? "Tạo tài khoản" : "Đăng nhập"}</h2>
          <p className="muted">{register ? "Chỉ mất một phút." : "Chào mừng quay lại."}</p>

          {register && (
            <label>
              Tên hiển thị
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} autoFocus />
            </label>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" inputMode="email" autoFocus={!register} />
          </label>
          <label>
            Mật khẩu
            <span className="pw">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={register ? "new-password" : "current-password"}
              />
              <button type="button" className="ghost small" onClick={() => setShow(!show)} aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
                {show ? "Ẩn" : "Hiện"}
              </button>
            </span>
          </label>
          {register && password && (
            <div className="strength" aria-live="polite">
              <div className={`bar s${pw.score}`}>
                <i /><i /><i /><i />
              </div>
              <span>{pw.problems.length ? pw.problems.join(" · ") : ["", "Yếu", "Khá", "Tốt", "Rất tốt"][pw.score]}</span>
            </div>
          )}

          {(error || (touched && problem)) && <div className="form-error" role="alert">{error || problem}</div>}

          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Đang xử lý…" : register ? "Đăng ký" : "Đăng nhập"}
          </button>
          <p className="switch">
            {register ? "Đã có tài khoản?" : "Chưa có tài khoản?"}{" "}
            <button type="button" className="link" onClick={() => switchMode(register ? "login" : "register")}>
              {register ? "Đăng nhập" : "Đăng ký"}
            </button>
          </p>
        </form>
      </main>
    </div>
  );
}
