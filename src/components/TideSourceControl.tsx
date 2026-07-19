import { canSelectEot20 } from "../domain/tideAvailability";
import type { Forecast, TideSource } from "../types";

const sourceLabel: Record<TideSource, string> = {
  BOM_OFFICIAL: "官方参考港",
  EOT20_MODEL: "EOT20 经纬度模型",
  NO_TIDE: "未计入潮汐",
};

const fallbackLabel = (reason: string | null) => {
  if (reason === "OFFICIAL_TIDE_UNAVAILABLE_AUTO_EOT20")
    return "附近官方潮汐事件不可用，已自动采用已安装的 EOT20；该模型不是官方港口潮汐。";
  if (reason === "LOCKED_OFFICIAL_STATION_UNAVAILABLE")
    return "已锁定的官方站当前无可用事件，系统没有自动改用其他来源。";
  if (reason === "OFFICIAL_TIDE_UNAVAILABLE_AND_EOT20_FALLBACK_FAILED")
    return "官方事件不可用，EOT20 自动回退计算也失败。";
  if (reason === "OFFICIAL_TIDE_UNAVAILABLE_EOT20_PENDING")
    return "附近官方潮汐事件不可用，正在自动计算 EOT20；完成后会自动用于本次评分。";
  if (reason === "EOT20_CALCULATION_PENDING")
    return "已选择 EOT20，模型正在后台计算；完成后会自动更新评分和曲线。";
  return reason ? `首选来源未采用：${reason}` : null;
};

export function TideSourceControl({
  forecast,
  busy = false,
  onSelect,
}: {
  forecast: Forecast;
  busy?: boolean;
  onSelect: (source: TideSource) => void;
}) {
  const officialAvailable = Boolean(forecast.tides.official?.events.length);
  const modelAvailable = canSelectEot20(forecast.tides.model);
  const actual = forecast.tides.actualTideSourceUsed;
  const fallback = fallbackLabel(forecast.tides.fallbackReason);
  return (
    <section className="tide-source-control" aria-label="潮汐评分来源">
      <div className="tide-source-copy">
        <strong>{busy ? "潮汐评分：EOT20 正在计算" : `潮汐评分：${sourceLabel[actual]}`}</strong>
        <small>
          {busy
            ? "已知天气、风浪与安全评分先展示，潮汐暂不计入；模型完成后自动重算。"
            : actual === "NO_TIDE"
            ? "当前未把潮汐计入评分；有可用模型时可在这里直接切换。"
            : "曲线和评分只使用这一来源，不会把官方潮汐与模型简单平均。"}
        </small>
      </div>
      <div className="tide-source-actions">
        <button
          type="button"
          disabled={busy || !officialAvailable}
          aria-pressed={actual === "BOM_OFFICIAL"}
          className={actual === "BOM_OFFICIAL" ? "active" : ""}
          title={officialAvailable ? "使用官方参考港事件" : "当前没有覆盖查询时段的官方事件"}
          onClick={() => onSelect("BOM_OFFICIAL")}
        >
          官方参考港
        </button>
        <button
          type="button"
          disabled={busy || !modelAvailable}
          aria-pressed={actual === "EOT20_MODEL"}
          className={actual === "EOT20_MODEL" ? "active" : ""}
          title={modelAvailable ? "使用本地 EOT20 经纬度模型" : "服务器未安装或无法运行 EOT20"}
          onClick={() => onSelect("EOT20_MODEL")}
        >
          EOT20 模型
        </button>
        <button
          type="button"
          aria-pressed={actual === "NO_TIDE"}
          className={actual === "NO_TIDE" ? "active" : ""}
          onClick={() => onSelect("NO_TIDE")}
        >
          不计潮汐
        </button>
      </div>
      {fallback ? <small className="tide-fallback-note">{fallback}</small> : null}
    </section>
  );
}
