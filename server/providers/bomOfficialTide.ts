import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';

export const OFFICIAL_TIDE_PARSER_VERSION = 'msq-interval-v1';
export type ParsedOfficialTide = {
  station: { id: string; name: string; latitude: number; longitude: number; state: string; timezone: string; datum: string };
  events: Array<{ type: 'HIGH' | 'LOW'; local: string; utc: string; heightM: number }>;
  readingCount: number;
};

const valueAfterComma = (line: string) => line.split(',').slice(1).join(',').trim();
const dms = (value: string) => {
  const [degrees, minutes] = value.trim().split(/\s+/).map(Number);
  return degrees < 0 ? degrees - minutes / 60 : degrees + minutes / 60;
};

/** Parse the public Maritime Safety Queensland fixed-interval prediction CSV. */
export function parseMsqPredictedIntervalCsv(text: string): ParsedOfficialTide {
  const lines = text.replace(/\r/g, '').split('\n');
  const metadata = (label: string) => {
    const line = lines.find((item) => item.trim().startsWith(label));
    if (!line) throw new Error(`MSQ_METADATA_MISSING:${label}`);
    return valueAfterComma(line);
  };
  const id = metadata('Tidal Station Number');
  const name = metadata('Tidal Station Name');
  const latitude = dms(metadata('Latitude  Degrees Minutes'));
  const longitude = dms(metadata('Longitude Degrees Minutes'));
  const datum = metadata('Station Datum');
  const events: ParsedOfficialTide['events'] = [];
  const readings: Array<{ local: string; utc: string; heightM: number; indicator: string }> = [];
  let readingCount = 0;
  for (const line of lines) {
    const match = line.match(/^\s*(\d{2})\/(\d{2})\/(\d{4})\s*,\s*(\d{2}):(\d{2})\s*,\s*(-?\d+)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) continue;
    readingCount += 1;
    const [, dd, mm, yyyy, hour, minute, indicator, height] = match;
    const local = `${yyyy}-${mm}-${dd}T${hour}:${minute}:00+10:00`;
    readings.push({ local, utc: new Date(local).toISOString(), heightM: Number(height), indicator });
    if (indicator === '1' || indicator === '-1') events.push({ type: indicator === '1' ? 'HIGH' : 'LOW', local, utc: new Date(local).toISOString(), heightM: Number(height) });
  }
  if (!events.length) {
    for (let i = 1; i < readings.length - 1; i += 1) {
      const previous = readings[i - 1], current = readings[i], next = readings[i + 1];
      if (current.heightM > previous.heightM && current.heightM >= next.heightM) events.push({ type: 'HIGH', local: current.local, utc: current.utc, heightM: current.heightM });
      if (current.heightM < previous.heightM && current.heightM <= next.heightM) events.push({ type: 'LOW', local: current.local, utc: current.utc, heightM: current.heightM });
    }
  }
  if (readingCount < 100 || events.length < 4) throw new Error('MSQ_READINGS_INVALID');
  return { station: { id, name, latitude, longitude, state: 'QLD', timezone: 'Australia/Brisbane', datum }, events, readingCount };
}

export function importMsqTideFile(db: Database.Database, input: { text: string; filename: string; sourceUrl: string; downloadedAtUtc: string }) {
  const parsed = parseMsqPredictedIntervalCsv(input.text);
  const importedAt = new Date().toISOString();
  const sourceYear = Number(parsed.events[0].local.slice(0, 4));
  const importId = randomUUID();
  const sha256 = createHash('sha256').update(input.text).digest('hex');
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO tide_imports (id,provider,source_type,source_year,state,station_id,station_name,original_filename,source_url,downloaded_at_utc,file_sha256,attribution,parser_version,parse_status,row_count)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'VALID',?)`).run(importId, 'Maritime Safety Queensland', 'STATE_OFFICIAL_TIDE_DATA', sourceYear, 'QLD', parsed.station.id, parsed.station.name, input.filename, input.sourceUrl, input.downloadedAtUtc, sha256, '© State of Queensland (Transport and Main Roads), CC BY 4.0', OFFICIAL_TIDE_PARSER_VERSION, parsed.readingCount);
    db.prepare(`INSERT INTO tide_stations (station_id,provider,source_type,station_name,latitude,longitude,state,timezone,datum,source_year,import_id,updated_at_utc)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(station_id) DO UPDATE SET provider=excluded.provider,source_type=excluded.source_type,station_name=excluded.station_name,latitude=excluded.latitude,longitude=excluded.longitude,state=excluded.state,timezone=excluded.timezone,datum=excluded.datum,source_year=excluded.source_year,import_id=excluded.import_id,updated_at_utc=excluded.updated_at_utc`).run(parsed.station.id, 'Maritime Safety Queensland', 'STATE_OFFICIAL_TIDE_DATA', parsed.station.name, parsed.station.latitude, parsed.station.longitude, parsed.station.state, parsed.station.timezone, parsed.station.datum, sourceYear, importId, importedAt);
    db.prepare('DELETE FROM tide_events WHERE station_id=? AND source_year=?').run(parsed.station.id, sourceYear);
    const insert = db.prepare(`INSERT INTO tide_events (id,station_id,provider,source_type,event_type,event_time_utc,event_time_local,height_m,source_year,datum,fetched_at_utc,imported_at_utc,parser_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const event of parsed.events) insert.run(randomUUID(), parsed.station.id, 'Maritime Safety Queensland', 'STATE_OFFICIAL_TIDE_DATA', event.type, event.utc, event.local, event.heightM, sourceYear, parsed.station.datum, input.downloadedAtUtc, importedAt, OFFICIAL_TIDE_PARSER_VERSION);
  });
  tx();
  return { importId, sha256, sourceYear, station: parsed.station, eventCount: parsed.events.length, readingCount: parsed.readingCount };
}

export const haversineKm = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const r = 6371;
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(q));
};

export function nearestOfficialStations(db: Database.Database, point: { latitude: number; longitude: number }, limit = 5) {
  return (db.prepare('SELECT * FROM tide_stations').all() as Array<Record<string, unknown>>)
    .map((row) => ({ ...row, distanceKm: haversineKm(point, { latitude: Number(row.latitude), longitude: Number(row.longitude) }) }))
    .sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
}

export function officialEvents(db: Database.Database, stationId: string, startUtc: string, endUtc: string, timeOffsetMin = 0, heightOffsetM = 0) {
  return (db.prepare('SELECT * FROM tide_events WHERE station_id=? AND event_time_utc BETWEEN ? AND ? ORDER BY event_time_utc').all(stationId, startUtc, endUtc) as Array<Record<string, unknown>>).map((row) => ({
    type: row.event_type, heightM: Number(row.height_m) + heightOffsetM,
    timeUtc: new Date(new Date(String(row.event_time_utc)).getTime() + timeOffsetMin * 60_000).toISOString(),
    timeLocal: row.event_time_local, sourceYear: row.source_year, datum: row.datum,
  }));
}
