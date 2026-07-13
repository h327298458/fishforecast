import { FormEvent, useState } from "react";
import { Fish, KeyRound, LogIn, UserPlus } from "lucide-react";
import { login, register, type AuthUser } from "../api";

export function AuthPage({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = mode === "login" ? await login(username, password) : await register(username, password, invitationCode);
      onAuthenticated(response.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "REQUEST_FAILED");
    } finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card">
    <div className="auth-brand"><Fish /><div><b>TideLine</b><span>澳大利亚个人钓鱼决策系统</span></div></div>
    <div className="auth-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button><button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>邀请码注册</button></div>
    <form onSubmit={(event) => void submit(event)}>
      <label>用户名<input autoComplete="username" value={username} minLength={3} maxLength={32} onChange={(event) => setUsername(event.target.value)} required /></label>
      <label>密码<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} minLength={10} maxLength={256} onChange={(event) => setPassword(event.target.value)} required /></label>
      {mode === "register" ? <label>邀请码<input value={invitationCode} placeholder="TL-..." autoCapitalize="characters" onChange={(event) => setInvitationCode(event.target.value.toUpperCase())} required /></label> : null}
      {error ? <p className="form-error">{error}</p> : null}
      <button className="primary auth-submit" disabled={busy}>{mode === "login" ? <LogIn /> : <UserPlus />}{busy ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}</button>
    </form>
    <small><KeyRound size={14} /> 密码采用服务器端哈希保存；邀请码只能由管理员生成。</small>
  </section></main>;
}
