import type { Hour, Window } from "../types";
import {
  localMinuteOfDay,
  makeTidePathSegments,
  type TideChartPoint,
} from "../domain/tideChart";

const CHART_WIDTH = 720;

const makePath = (values: Array<number | null>, w = CHART_WIDTH, h = 150) => {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length < 2) return "";
  const min = Math.min(...valid),
    max = Math.max(...valid),
    range = Math.max(max - min, 0.01);
  let drawing = false;
  return values
    .map((value, index) => {
      if (value === null) {
        drawing = false;
        return "";
      }
      const command = drawing ? "L" : "M";
      drawing = true;
      return `${command} ${(index / Math.max(values.length - 1, 1)) * w} ${h - ((value - min) / range) * h * 0.72 - 15}`;
    })
    .filter(Boolean)
    .join(" ");
};

const localTime = (utc: string, timezone: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(utc));

const localDateMinute = (utc: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utc));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    minute: Number(part("hour")) * 60 + Number(part("minute")),
  };
};

const windowGeometry = (window: Window, date: string, timezone: string) => {
  const start = localDateMinute(window.startUtc, timezone);
  const end = localDateMinute(window.endUtc, timezone);
  const startMinute = start.date < date ? 0 : start.date > date ? 1440 : start.minute;
  const endMinute = end.date > date ? 1440 : end.date < date ? 0 : end.minute;
  return {
    x: (Math.max(0, Math.min(1440, startMinute)) / 1440) * CHART_WIDTH,
    width:
      (Math.max(0, Math.min(1440, endMinute - startMinute)) / 1440) *
      CHART_WIDTH,
  };
};

export function TideChart({
  hours,
  window: legacyWindow,
  windows,
  timezone,
}: {
  hours: TideChartPoint[];
  window?: Window;
  windows?: Window[];
  timezone: string;
}) {
  const visibleWindows = windows ?? (legacyWindow ? [legacyWindow] : []);
  const bestWindow = visibleWindows[0];
  const segments = makeTidePathSegments(hours);
  const date = hours[0]?.timestampLocal.slice(0, 10) ?? "";
  const firstTideMinute = hours
    .filter((hour) => hour.tideHeightM !== null)
    .map((hour) => localMinuteOfDay(hour.timestampLocal))
    .find((minute): minute is number => minute !== null);
  return (
    <div className="chart">
      <div className="chart-head">
        <b>所选潮汐评分源曲线</b>
        <strong>
          {bestWindow
            ? `最佳窗口 ${localTime(bestWindow.startUtc, timezone)}–${localTime(bestWindow.endUtc, timezone)}`
            : "本日没有满足阈值的连续窗口"}
        </strong>
      </div>
      {segments.length ? (
        <>
          <svg
            viewBox="0 0 720 170"
            role="img"
            aria-label="24小时所选潮汐评分源曲线及全部推荐窗口"
          >
            {segments.map((segment) => (
              <path className="area" d={segment.areaPath} key={`area-${segment.startX}`} />
            ))}
            {segments.map((segment) => (
              <path className="line tide" d={segment.path} key={`line-${segment.startX}`} />
            ))}
            {visibleWindows.map((item, index) => {
              const geometry = windowGeometry(item, date, timezone);
              return (
                <g key={item.startUtc}>
                  <rect
                    className="window"
                    x={geometry.x}
                    y={8 + (index % 2) * 3}
                    width={Math.max(geometry.width, 25)}
                    height="150"
                  />
                  <text x={Math.min(geometry.x + 5, 665)} y={28 + index * 15}>
                    窗口 {index + 1}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="axis">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
          {firstTideMinute !== undefined && firstTideMinute > 60 ? (
            <small className="chart-note">
              {localTime(hours.find((hour) => hour.tideHeightM !== null)?.timestampUtc ?? "", timezone)}
              之前没有返回潮汐值，图表保留为空白，不向前复制首个模型值。
            </small>
          ) : null}
        </>
      ) : (
        <div className="chart-unavailable">
          当前评分源没有可绘制的潮汐序列；未使用假潮位替代。请在上方切换可用来源。
        </div>
      )}
    </div>
  );
}

export function WindChart({ hours }: { hours: Hour[] }) {
  const wind = makePath(
      hours.map((h) => h.windSpeedKmh),
      CHART_WIDTH,
      100,
    ),
    gust = makePath(
      hours.map((h) => h.windGustKmh),
      CHART_WIDTH,
      100,
    );
  return (
    <div className="chart compact">
      <div className="chart-head">
        <b>
          风速 / 阵风 <small>km/h</small>
        </b>
        <span className="legend">— 风速 / - - 阵风</span>
      </div>
      {wind && gust ? (
        <svg viewBox="0 0 720 105" role="img" aria-label="24小时风速与阵风">
          <path className="line wind" d={wind} />
          <path className="line gust" d={gust} />
        </svg>
      ) : (
        <div className="chart-unavailable">风数据不可用</div>
      )}
    </div>
  );
}
