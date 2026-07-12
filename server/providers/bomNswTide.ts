import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export const BOM_NSW_TIDE_PARSER_VERSION = "bom-nsw-pdf-text-v2";
const months = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
] as const;
const weekdays = "MO|TU|WE|TH|FR|SA|SU";
export type BomNswTideDocument = {
  station: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    state: "NSW";
    timezone: "Australia/Sydney";
    datum: string;
  };
  sourceYear: number;
  events: Array<{
    type: "HIGH" | "LOW";
    local: string;
    utc: string;
    heightM: number;
  }>;
};

const zonedLocalToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) => {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 3; i += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    guess += target - represented;
  }
  return new Date(guess).toISOString();
};

export function parseBomNswTideText(
  text: string,
  stationId: string,
): BomNswTideDocument {
  const normalized = text
    .replace(/[‐‑–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const heading = normalized.match(
    /([A-Z][A-Z ()]+?)\s+-\s+NEW SOUTH WALES\s+LAT\s+(\d+)\s*°\s*(\d+)[’']\s*S\s+LONG\s+(\d+)\s*°\s*(\d+)[’']\s*E/i,
  );
  if (!heading) throw new Error("BOM_NSW_HEADER_INVALID");
  const yearMatch = normalized.match(/Local Time\s+(20\d{2})/i);
  if (!yearMatch) throw new Error("BOM_NSW_YEAR_MISSING");
  const sourceYear = Number(yearMatch[1]);
  const readings: Array<{ local: string; utc: string; heightM: number }> = [];
  for (let monthIndex = 0; monthIndex < months.length; monthIndex += 1) {
    const month = months[monthIndex],
      next = months[monthIndex + 1];
    const end = next ? `(?=\\d{1,2}\\s+(?:${weekdays})\\s+${next}\\b)` : "$";
    const match = normalized.match(
      new RegExp(
        `(\\d{1,2})\\s+(${weekdays})\\s+${month}\\b([\\s\\S]*?)${end}`,
        "i",
      ),
    );
    if (!match) throw new Error(`BOM_NSW_MONTH_MISSING:${month}`);
    const body = `${match[1]} ${match[2]} ${match[3]}`;
    const markers = [
      ...body.matchAll(
        new RegExp(`(?:^|\\s)(\\d{1,2})\\s+(${weekdays})(?=\\s)`, "gi"),
      ),
    ];
    for (let markerIndex = 0; markerIndex < markers.length; markerIndex += 1) {
      const day = Number(markers[markerIndex][1]),
        start =
          (markers[markerIndex].index ?? 0) + markers[markerIndex][0].length,
        endIndex = markers[markerIndex + 1]?.index ?? body.length,
        dayText = body.slice(start, endIndex);
      for (const pair of dayText.matchAll(
        /(?:^|\s)(\d{4})\s+(-?\d+\.\d{1,2})(?=\s|$)/g,
      )) {
        const hour = Number(pair[1].slice(0, 2)),
          minute = Number(pair[1].slice(2));
        if (hour > 23 || minute > 59) throw new Error("BOM_NSW_TIME_INVALID");
        const local = `${sourceYear}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${pair[1].slice(0, 2)}:${pair[1].slice(2)}:00`;
        readings.push({
          local,
          utc: zonedLocalToUtc(
            sourceYear,
            monthIndex + 1,
            day,
            hour,
            minute,
            "Australia/Sydney",
          ),
          heightM: Number(pair[2]),
        });
      }
    }
  }
  if (readings.length < 1300)
    throw new Error(`BOM_NSW_EVENT_COUNT_INVALID:${readings.length}`);
  const events = readings.map((reading, index) => {
    const previous = readings[index - 1],
      next = readings[index + 1];
    const type: "HIGH" | "LOW" =
      previous && next
        ? reading.heightM >= previous.heightM && reading.heightM >= next.heightM
          ? "HIGH"
          : "LOW"
        : next
          ? reading.heightM > next.heightM
            ? "HIGH"
            : "LOW"
          : reading.heightM > (previous?.heightM ?? reading.heightM)
            ? "HIGH"
            : "LOW";
    return { ...reading, type };
  });
  return {
    station: {
      id: stationId,
      name: heading[1]
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, (value) => value.toUpperCase()),
      latitude: -(Number(heading[2]) + Number(heading[3]) / 60),
      longitude: Number(heading[4]) + Number(heading[5]) / 60,
      state: "NSW",
      timezone: "Australia/Sydney",
      datum: "Lowest Astronomical Tide (LAT)",
    },
    sourceYear,
    events,
  };
}

export function importBomNswTideFile(
  db: Database.Database,
  input: {
    text: string;
    binary: Buffer;
    filename: string;
    sourceUrl: string;
    downloadedAtUtc: string;
    stationId: string;
  },
) {
  const parsed = parseBomNswTideText(input.text, input.stationId),
    importedAt = new Date().toISOString(),
    importId = randomUUID(),
    sha256 = createHash("sha256").update(input.binary).digest("hex");
  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE tide_imports SET parse_status='SUPERSEDED' WHERE station_id=? AND source_year=? AND parse_status='VALID'",
    ).run(parsed.station.id, parsed.sourceYear);
    db.prepare(
      `INSERT INTO tide_imports (id,provider,source_type,source_year,state,station_id,station_name,original_filename,source_url,downloaded_at_utc,file_sha256,attribution,parser_version,parse_status,row_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'VALID',?)`,
    ).run(
      importId,
      "Bureau of Meteorology",
      "BOM_OFFICIAL_STATION",
      parsed.sourceYear,
      "NSW",
      parsed.station.id,
      parsed.station.name,
      input.filename,
      input.sourceUrl,
      input.downloadedAtUtc,
      sha256,
      "© Commonwealth of Australia, Bureau of Meteorology; modified product disclaimer applies",
      BOM_NSW_TIDE_PARSER_VERSION,
      parsed.events.length,
    );
    db.prepare(
      `INSERT INTO tide_stations (station_id,provider,source_type,station_name,latitude,longitude,state,timezone,datum,source_year,import_id,updated_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(station_id) DO UPDATE SET provider=excluded.provider,source_type=excluded.source_type,station_name=excluded.station_name,latitude=excluded.latitude,longitude=excluded.longitude,state=excluded.state,timezone=excluded.timezone,datum=excluded.datum,source_year=excluded.source_year,import_id=excluded.import_id,updated_at_utc=excluded.updated_at_utc`,
    ).run(
      parsed.station.id,
      "Bureau of Meteorology",
      "BOM_OFFICIAL_STATION",
      parsed.station.name,
      parsed.station.latitude,
      parsed.station.longitude,
      "NSW",
      "Australia/Sydney",
      parsed.station.datum,
      parsed.sourceYear,
      importId,
      importedAt,
    );
    db.prepare(
      "DELETE FROM tide_events WHERE station_id=? AND source_year=?",
    ).run(parsed.station.id, parsed.sourceYear);
    const insert = db.prepare(
      `INSERT INTO tide_events (id,station_id,provider,source_type,event_type,event_time_utc,event_time_local,height_m,source_year,datum,fetched_at_utc,imported_at_utc,parser_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const event of parsed.events)
      insert.run(
        randomUUID(),
        parsed.station.id,
        "Bureau of Meteorology",
        "BOM_OFFICIAL_STATION",
        event.type,
        event.utc,
        event.local,
        event.heightM,
        parsed.sourceYear,
        parsed.station.datum,
        input.downloadedAtUtc,
        importedAt,
        BOM_NSW_TIDE_PARSER_VERSION,
      );
  });
  tx();
  return {
    importId,
    sha256,
    sourceYear: parsed.sourceYear,
    station: parsed.station,
    eventCount: parsed.events.length,
  };
}
