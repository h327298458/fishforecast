import type { Hour, Window } from "../types";
const makePath = (values: Array<number | null>, w = 720, h = 150) => {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length < 2) return "";
  const min = Math.min(...valid),
    max = Math.max(...valid),
    range = Math.max(max - min, 0.01);
  return values
    .map((value, index) =>
      value === null
        ? ""
        : `${index && !values.slice(0, index).every((v) => v === null) ? "L" : "M"} ${(index / Math.max(values.length - 1, 1)) * w} ${h - ((value - min) / range) * h * 0.72 - 15}`,
    )
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
export function TideChart({
  hours,
  window,
  timezone,
}: {
  hours: Hour[];
  window?: Window;
  timezone: string;
}) {
  const values = hours.map((h) => h.tideHeightM);
  const line = makePath(values);
  const start = window ? new Date(window.startUtc).getTime() : 0,
    end = window ? new Date(window.endUtc).getTime() : 0,
    first = new Date(hours[0]?.timestampUtc).getTime(),
    last = new Date(
      hours.at(-1)?.timestampUtc ?? hours[0]?.timestampUtc,
    ).getTime(),
    x = Math.max(0, ((start - first) / Math.max(last - first, 1)) * 720),
    width = Math.max(0, ((end - start) / Math.max(last - first, 1)) * 720);
  return (
    <div className="chart">
      <div className="chart-head">
        <b>所选潮汐评分源曲线</b>
        <strong>
          {window
            ? `最佳窗口 ${localTime(window.startUtc, timezone)}–${localTime(window.endUtc, timezone)}`
            : "本日没有满足阈值的连续窗口"}
        </strong>
      </div>
      {line ? (
        <>
          <svg
            viewBox="0 0 720 170"
            role="img"
            aria-label="24小时所选潮汐评分源曲线"
          >
            <path className="area" d={`${line} L720 170 L0 170Z`} />
            <path className="line tide" d={line} />
            {window ? (
              <>
                <rect
                  className="window"
                  x={x}
                  y="8"
                  width={Math.max(width, 25)}
                  height="150"
                />
                <text x={Math.min(x + 5, 650)} y="28">
                  推荐窗口
                </text>
              </>
            ) : null}
          </svg>
          <div className="axis">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
        </>
      ) : (
        <div className="chart-unavailable">
          潮汐模型数据不可用；未使用假潮位替代。
        </div>
      )}
    </div>
  );
}
export function WindChart({ hours }: { hours: Hour[] }) {
  const wind = makePath(
      hours.map((h) => h.windSpeedKmh),
      720,
      100,
    ),
    gust = makePath(
      hours.map((h) => h.windGustKmh),
      720,
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
