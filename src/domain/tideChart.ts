const CHART_WIDTH = 720;
const TIDE_HEIGHT = 150;

export type TideChartPoint = {
  timestampUtc: string;
  timestampLocal: string;
  tideHeightM: number | null;
};

export const localMinuteOfDay = (timestampLocal: string) => {
  const match = timestampLocal.match(/T?(\d{2}):(\d{2})(?::\d{2})?$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

export type TidePathSegment = {
  path: string;
  areaPath: string;
  startX: number;
  endX: number;
};

export function makeTidePathSegments(hours: TideChartPoint[]): TidePathSegment[] {
  const valid = hours.filter(
    (hour): hour is TideChartPoint & { tideHeightM: number } =>
      hour.tideHeightM !== null && localMinuteOfDay(hour.timestampLocal) !== null,
  );
  if (valid.length < 2) return [];
  const values = valid.map((hour) => hour.tideHeightM);
  const min = Math.min(...values);
  const range = Math.max(Math.max(...values) - min, 0.01);
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  let previousMinute: number | null = null;

  for (const hour of hours) {
    const minute = localMinuteOfDay(hour.timestampLocal);
    if (hour.tideHeightM === null || minute === null) {
      if (current.length >= 2) segments.push(current);
      current = [];
      previousMinute = null;
      continue;
    }
    if (previousMinute !== null && minute - previousMinute > 90) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
    current.push({
      x: (minute / 1440) * CHART_WIDTH,
      y: TIDE_HEIGHT - ((hour.tideHeightM - min) / range) * TIDE_HEIGHT * 0.72 - 15,
    });
    previousMinute = minute;
  }
  if (current.length >= 2) segments.push(current);

  return segments.map((points) => {
    const path = points
      .map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`)
      .join(" ");
    const startX = points[0].x;
    const endX = points.at(-1)?.x ?? startX;
    return {
      path,
      areaPath: `${path} L ${endX} 170 L ${startX} 170 Z`,
      startX,
      endX,
    };
  });
}
