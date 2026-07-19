import { useMemo, useState } from "react";
import type { SpotComparison } from "../types";

type Sort = "recommended" | "safety" | "fishing" | "confidence" | "wind";
const numeric = (value: number | null | undefined, fallback = -1) => typeof value === "number" ? value : fallback;
const time = (value: string | undefined) => value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";

export function SpotComparisonTable({ rows }: { rows: SpotComparison[] }) {
  const [sort, setSort] = useState<Sort>("recommended");
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    if (a.status !== "AVAILABLE") return 1;
    if (b.status !== "AVAILABLE") return -1;
    if (sort === "wind") return numeric(a.observedWindKmh, 999) - numeric(b.observedWindKmh, 999);
    if (sort === "safety") return numeric(b.safetyScore) - numeric(a.safetyScore);
    if (sort === "fishing") return numeric(b.fishingConditionScore) - numeric(a.fishingConditionScore);
    if (sort === "confidence") return numeric(b.confidenceScore) - numeric(a.confidenceScore);
    const composite = (row: SpotComparison) => numeric(row.safetyScore, 0) * .35 + numeric(row.comfortScore, 0) * .2 + numeric(row.fishingConditionScore, 0) * .25 + numeric(row.confidenceScore, 0) * .2;
    return composite(b) - composite(a);
  }), [rows, sort]);
  return (
    <section className="comparison-page">
      <div className="section-heading"><div><h1>收藏钓点比较</h1><p>使用每个钓点最近一次已锁定的预测快照，避免为了比较而重复运行重型模型。</p></div><label>排序<select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="recommended">综合最值得去</option><option value="safety">安全最高</option><option value="fishing">鱼口条件最高</option><option value="confidence">可信度最高</option><option value="wind">实测风最小</option></select></label></div>
      <div className="table-scroll"><table><thead><tr><th>钓点</th><th>最佳窗口</th><th>安全</th><th>舒适度</th><th>鱼口条件</th><th>可信度</th><th>BOM实测风</th><th>潮汐源</th><th>快照时间</th></tr></thead><tbody>{sorted.map((row) => row.status === "AVAILABLE" ? <tr key={row.spotId}><td>{row.name}</td><td>{row.bestWindow ? `${time(row.bestWindow.startUtc)}–${time(row.bestWindow.endUtc).slice(-5)}` : "无合格窗口"}</td><td>{row.safetyStatus} {row.safetyScore ?? "—"}</td><td>{row.comfortScore ?? "—"}</td><td>{row.fishingConditionScore ?? "—"}</td><td>{row.confidenceScore ?? "—"}</td><td>{row.observedWindKmh == null ? "—" : `${row.observedWindKmh} km/h`}</td><td>{row.tideSource ?? "NO_TIDE"}</td><td>{time(row.generatedAtUtc)}</td></tr> : <tr key={row.spotId}><td>{row.name}</td><td colSpan={8}>暂无预测快照；请先打开该钓点完成一次预测。</td></tr>)}</tbody></table></div>
      <small>“综合最值得去”权重：安全 35%、舒适度 20%、鱼口条件 25%、数据可信度 20%。它不是上鱼概率，旧快照可能与当前环境不同。</small>
    </section>
  );
}
