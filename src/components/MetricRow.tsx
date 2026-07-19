import { BarChart3, Fish, ShieldCheck, Wind } from "lucide-react";
import type { Score } from "../types";

const copy = (value: number) => value >= 80 ? "高" : value >= 68 ? "较好" : value >= 50 ? "一般" : "谨慎";

export function MetricRow({ score, preliminary = false }: { score: Score; preliminary?: boolean }) {
  const metrics = [
    ["安全性", score.safetyScore, ShieldCheck, false],
    ["舒适度", score.comfortScore, Wind, false],
    [preliminary ? "临时环境评分" : "鱼口条件", score.fishingConditionScore, Fish, preliminary],
    ["数据可信度", score.dataConfidenceScore, BarChart3, false],
  ] as const;
  return (
    <div className="metrics">
      {metrics.map(([label, value, Icon, isTemporary]) => (
        <div className={`metric${isTemporary ? " metric-preliminary" : ""}`} key={label}>
          <Icon />
          <span>
            <b>{label}</b>
            <strong>{value}<small>/100</small></strong>
            <em>{isTemporary ? "未计潮汐" : copy(value)}</em>
          </span>
        </div>
      ))}
    </div>
  );
}
