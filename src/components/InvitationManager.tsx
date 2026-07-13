import { useEffect, useState } from "react";
import { Copy, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { createInvitation, getInvitations, revokeInvitation, type Invitation } from "../api";

export function InvitationManager() {
  const [items, setItems] = useState<Invitation[]>([]), [maxUses, setMaxUses] = useState(1), [expiresAtUtc, setExpiresAtUtc] = useState(""), [issuedCode, setIssuedCode] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [now] = useState(() => Date.now());
  const load = async () => { try { setItems((await getInvitations()).invitations); } catch (reason) { setError(reason instanceof Error ? reason.message : "REQUEST_FAILED"); } };
  useEffect(() => { let cancelled = false; void getInvitations().then((result) => { if (!cancelled) setItems(result.invitations); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "REQUEST_FAILED"); }); return () => { cancelled = true; }; }, []);
  async function generate() { setBusy(true); setError(""); try { const result = await createInvitation(maxUses, expiresAtUtc ? new Date(expiresAtUtc).toISOString() : undefined); setIssuedCode(result.invitation.code); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "REQUEST_FAILED"); } finally { setBusy(false); } }
  async function revoke(id: string) { setBusy(true); try { await revokeInvitation(id); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "REQUEST_FAILED"); } finally { setBusy(false); } }
  async function copy() { if (issuedCode && navigator.clipboard) await navigator.clipboard.writeText(issuedCode); }
  return <section className="invitation-manager"><h2><KeyRound /> 邀请码管理</h2><p>生成后只显示一次明文邀请码。请通过可信渠道发送给受邀用户。</p>
    <div className="invite-form"><label>可使用次数<input type="number" min="1" max="1000" value={maxUses} onChange={(event) => setMaxUses(Number(event.target.value))} /></label><label>到期时间（可选）<input type="datetime-local" value={expiresAtUtc} onChange={(event) => setExpiresAtUtc(event.target.value)} /></label><button className="primary" disabled={busy} onClick={() => void generate()}><KeyRound />生成邀请码</button></div>
    {issuedCode ? <div className="issued-code"><b>新邀请码（仅现在显示）</b><code>{issuedCode}</code><button onClick={() => void copy()}><Copy />复制</button></div> : null}
    {error ? <p className="form-error">{error}</p> : null}
    <div className="invite-list"><div className="invite-list-head"><b>最近邀请码</b><button title="刷新" onClick={() => void load()}><RefreshCw /></button></div>{items.length ? items.map((item) => { const expired = item.expiresAtUtc && new Date(item.expiresAtUtc).getTime() <= now; const inactive = Boolean(item.revokedAtUtc || expired || item.uses >= item.maxUses); return <article key={item.id}><span><b>{item.uses}/{item.maxUses} 次</b><small>创建者 {item.createdByUsername} · {new Date(item.createdAtUtc).toLocaleString()}</small><small>{item.revokedAtUtc ? "已撤销" : expired ? "已过期" : item.uses >= item.maxUses ? "已用完" : item.expiresAtUtc ? `到期 ${new Date(item.expiresAtUtc).toLocaleString()}` : "不过期"}</small></span>{inactive ? null : <button title="撤销" disabled={busy} onClick={() => void revoke(item.id)}><Trash2 />撤销</button>}</article>; }) : <p>暂无邀请码。</p>}</div>
  </section>;
}
