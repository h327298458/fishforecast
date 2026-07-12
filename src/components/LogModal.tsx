import { X } from "lucide-react";
import { useState } from "react";
import { saveLog } from "../api";
export function LogModal({
  spotId,
  forecastSnapshotId,
  onClose,
}: {
  spotId: string;
  forecastSnapshotId?: string | null;
  onClose: () => void;
}) {
  const [done, setDone] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const now = new Date();
    try {
      await saveLog({
        spotId,
        forecastSnapshotId,
        startedAtUtc: new Date(now.getTime() - 2 * 3600000).toISOString(),
        endedAtUtc: now.toISOString(),
        method: f.get("method"),
        bait: f.get("bait"),
        bites: Number(f.get("bites")),
        catches: Number(f.get("catches")),
        rating: Number(f.get("rating")),
        notes: f.get("notes"),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  }
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-title"
      >
        <button className="close" onClick={onClose}>
          <X />
        </button>
        {done ? (
          <div className="success">
            <span>✓</span>
            <h2>实钓记录已保存</h2>
            <p>环境快照与结果将在历史分析中关联。</p>
            <button onClick={onClose}>完成</button>
          </div>
        ) : (
          <>
            <h2 id="log-title">记录本次实钓</h2>
            <p>快速记录；详细装备信息可在日志页补充。</p>
            <form onSubmit={submit}>
              <label>
                钓法
                <select name="method">
                  <option value="bottom_fishing">沉底钓</option>
                  <option value="lure">路亚</option>
                  <option value="float">浮漂钓</option>
                </select>
              </label>
              <label>
                饵料
                <input name="bait" placeholder="例如：虾、沙蚕" />
              </label>
              <div className="form-row">
                <label>
                  鱼口次数
                  <input name="bites" type="number" min="0" defaultValue="3" />
                </label>
                <label>
                  上鱼数量
                  <input
                    name="catches"
                    type="number"
                    min="0"
                    defaultValue="1"
                  />
                </label>
              </div>
              <label>
                主观鱼口
                <select name="rating" defaultValue="3">
                  <option value="1">没口</option>
                  <option value="2">少量鱼口</option>
                  <option value="3">一般</option>
                  <option value="4">很好</option>
                </select>
              </label>
              <label>
                备注
                <textarea name="notes" rows={3} />
              </label>
              {error ? <p className="form-error">{error}</p> : null}
              <button className="primary" type="submit">
                保存实钓记录
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
