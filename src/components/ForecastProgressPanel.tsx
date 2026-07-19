import { AlertTriangle, Check, Circle, LoaderCircle } from "lucide-react";
import type {
  ForecastProgress,
  ForecastStageStatus,
} from "../domain/forecastProgress";

const iconForStatus: Record<ForecastStageStatus, typeof Check> = {
  completed: Check,
  running: LoaderCircle,
  pending: Circle,
  error: AlertTriangle,
};

export function ForecastProgressPanel({
  progress,
}: {
  progress: ForecastProgress;
}) {
  const completed = progress.stages.filter(
    (stage) => stage.status === "completed",
  ).length;
  const running = progress.stages.find((stage) => stage.status === "running");
  const pending = progress.stages.filter((stage) => stage.status === "pending");
  const hasError = progress.stages.some((stage) => stage.status === "error");
  const allCompleted = completed === progress.stages.length;
  const percent = Math.round((completed / progress.stages.length) * 100);

  return (
    <section
      className={`forecast-progress${allCompleted ? " is-complete" : ""}${hasError ? " has-error" : ""}`}
      aria-live="polite"
      aria-label="预测计算进度"
      data-testid="forecast-progress"
    >
      <div className="forecast-progress-head">
        <div>
          <strong>
            {allCompleted
              ? "预测已完成"
              : hasError
                ? "部分计算未完成"
                : "正在生成钓鱼预测"}
          </strong>
          <small>
            {running
              ? `正在运行：${running.label}`
              : pending.length
                ? `还剩：${pending.map((stage) => stage.label).join("、")}`
                : hasError
                  ? "已保留可用的天气与风浪结果"
                  : "全部数据已进入最终结果"}
          </small>
        </div>
        <b>
          {completed}/{progress.stages.length}
        </b>
      </div>
      <div
        className="forecast-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <ol className="forecast-progress-stages">
        {progress.stages.map((stage) => {
          const Icon = iconForStatus[stage.status];
          return (
            <li
              key={stage.id}
              className={`stage-${stage.status}`}
              data-stage={stage.id}
              data-status={stage.status}
            >
              <Icon className={stage.status === "running" ? "spin" : ""} />
              <span>
                <b>{stage.label}</b>
                <small>{stage.detail}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
