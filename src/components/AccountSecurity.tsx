import { useEffect, useState } from "react";
import { KeyRound, RefreshCw, ShieldCheck, UserRoundCheck, UserRoundX } from "lucide-react";
import { changePassword, getManagedUsers, revokeManagedUserSessions, setManagedUserDisabled, type AuthUser, type ManagedUser } from "../api";

export function AccountSecurity({ user }: { user: AuthUser }) {
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const form = event.currentTarget, data = new FormData(form), currentPassword = String(data.get("currentPassword") ?? ""), newPassword = String(data.get("newPassword") ?? ""), confirmation = String(data.get("confirmation") ?? "");
    if (newPassword !== confirmation) { setError("两次输入的新密码不一致"); setBusy(false); return; }
    try { await changePassword(currentPassword, newPassword); setMessage("密码已修改，其他登录会话已全部撤销。当前设备已获得新会话。"); form.reset(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "PASSWORD_CHANGE_FAILED"); }
    finally { setBusy(false); }
  }
  return <section className="security-card"><h2><KeyRound /> 修改密码</h2><p>新密码至少10个字符。修改后，其他设备上的旧会话会立即失效。</p><form onSubmit={submit}><label>当前密码<input name="currentPassword" type="password" autoComplete="current-password" minLength={10} required /></label><label>新密码<input name="newPassword" type="password" autoComplete="new-password" minLength={10} required /></label><label>确认新密码<input name="confirmation" type="password" autoComplete="new-password" minLength={10} required /></label><button className="primary" disabled={busy}>{busy ? "正在修改…" : "修改密码"}</button></form>{message ? <p className="form-success">{message}</p> : null}{error ? <p className="form-error">{error}</p> : null}{user.role === "ADMIN" ? <UserManager currentUserId={user.id} /> : null}</section>;
}

function UserManager({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]), [error, setError] = useState(""), [busyId, setBusyId] = useState("");
  const load = async () => { try { setUsers((await getManagedUsers()).users); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "USER_LIST_FAILED"); } };
  useEffect(() => { let cancelled = false; void getManagedUsers().then((result) => { if (!cancelled) setUsers(result.users); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "USER_LIST_FAILED"); }); return () => { cancelled = true; }; }, []);
  async function toggle(target: ManagedUser) { setBusyId(target.id); try { await setManagedUserDisabled(target.id, !target.disabledAtUtc); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "USER_STATUS_UPDATE_FAILED"); } finally { setBusyId(""); } }
  async function revoke(target: ManagedUser) { setBusyId(target.id); try { await revokeManagedUserSessions(target.id); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "SESSION_REVOKE_FAILED"); } finally { setBusyId(""); } }
  return <div className="user-manager"><div className="user-manager-head"><h2><ShieldCheck /> 用户管理</h2><button title="刷新用户" onClick={() => void load()}><RefreshCw /></button></div>{error ? <p className="form-error">{error}</p> : null}<div className="user-list">{users.map((managed) => <article key={managed.id}><span><b>{managed.username} {managed.role === "ADMIN" ? "· 管理员" : ""}</b><small>{managed.disabledAtUtc ? "已停用" : "正常"} · 活跃会话 {managed.activeSessions} · 最近登录 {managed.lastLoginAtUtc ? new Date(managed.lastLoginAtUtc).toLocaleString() : "从未"}</small></span><div>{managed.id !== currentUserId ? <button disabled={busyId === managed.id} onClick={() => void toggle(managed)}>{managed.disabledAtUtc ? <UserRoundCheck /> : <UserRoundX />}{managed.disabledAtUtc ? "启用" : "停用"}</button> : null}<button disabled={busyId === managed.id || managed.activeSessions === 0} onClick={() => void revoke(managed)}>撤销会话</button></div></article>)}</div></div>;
}
