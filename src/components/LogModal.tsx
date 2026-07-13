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
        lure: f.get("lure"),
        bites: Number(f.get("bites")),
        catches: Number(f.get("catches")),
        kept: Number(f.get("kept")),
        blank: f.get("blank") === "on",
        effectiveMinutes: Number(f.get("effectiveMinutes")),
        species: f.get("species"),
        maxLengthCm: Number(f.get("maxLengthCm")) || null,
        maxWeightKg: Number(f.get("maxWeightKg")) || null,
        waterDepth: f.get("waterDepth"),
        castingDistanceM: Number(f.get("castingDistanceM")) || null,
        moveCount: Number(f.get("moveCount")),
        snagCount: Number(f.get("snagCount")),
        tangleCount: Number(f.get("tangleCount")),
        lineBreakCount: Number(f.get("lineBreakCount")),
        baitLossCount: Number(f.get("baitLossCount")),
        boatTraffic: f.get("boatTraffic") === "on",
        crowdTraffic: f.get("crowdTraffic") === "on",
        weatherInterrupted: f.get("weatherInterrupted") === "on",
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
              <label>拟饵 / Lure<input name="lure" /></label>
              <div className="form-row"><label>留鱼数量<input name="kept" type="number" min="0" defaultValue="0" /></label><label>有效垂钓分钟<input name="effectiveMinutes" type="number" min="0" defaultValue="120" /></label></div>
              <label><input name="blank" type="checkbox" /> 空军（没有上鱼）</label>
              <label>鱼种<input name="species" /></label>
              <div className="form-row"><label>最大长度 cm<input name="maxLengthCm" type="number" min="0" step="0.1" /></label><label>最大重量 kg<input name="maxWeightKg" type="number" min="0" step="0.01" /></label></div>
              <div className="form-row"><label>水层<input name="waterDepth" /></label><label>抛投距离 m<input name="castingDistanceM" type="number" min="0" /></label></div>
              <div className="form-row"><label>换钓位次数<input name="moveCount" type="number" min="0" defaultValue="0" /></label><label>挂底次数<input name="snagCount" type="number" min="0" defaultValue="0" /></label></div>
              <div className="form-row"><label>缠线次数<input name="tangleCount" type="number" min="0" defaultValue="0" /></label><label>断线次数<input name="lineBreakCount" type="number" min="0" defaultValue="0" /></label></div>
              <div className="form-row"><label>掉饵次数<input name="baitLossCount" type="number" min="0" defaultValue="0" /></label><label><input name="boatTraffic" type="checkbox" /> 船流干扰</label><label><input name="crowdTraffic" type="checkbox" /> 人流干扰</label><label><input name="weatherInterrupted" type="checkbox" /> 天气中断</label></div>
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
