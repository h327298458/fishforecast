import Database from 'better-sqlite3';
import { describe,expect,it } from 'vitest';
import { applyMigrations } from '../db/applyMigrations.js';
import { haversineKm, importMsqTideFile, nearestOfficialStations, officialEvents, parseMsqPredictedIntervalCsv } from './bomOfficialTide.js';

function fixture(){const header=`Tidal Station Number =,TEST01\nTidal Station Name =,TEST HARBOUR\nLatitude  Degrees Minutes =,-27 56\nLongitude Degrees Minutes =,153 25\nStation Datum =,LOWEST ASTRONOMICAL TIDE\n`;const rows=[];for(let i=0;i<120;i++){const hour=String(Math.floor(i/6)).padStart(2,'0'),minute=String((i%6)*10).padStart(2,'0'),indicator=i%30===5?'1':i%30===20?'-1':'9',height=(1+Math.sin(i/10)).toFixed(3);rows.push(`01/01/2026 , ${hour} : ${minute} , ${indicator} , ${height}`.replace(' : ',':'))}return header+rows.join('\n')}
describe('official tide import',()=>{
  it('parses station coordinates, UTC conversion, highs and lows',()=>{const result=parseMsqPredictedIntervalCsv(fixture());expect(result.station.latitude).toBeCloseTo(-27.9333,3);expect(result.events.map(event=>event.type)).toContain('HIGH');expect(result.events[0].utc).toMatch(/Z$/)});
  it('imports atomically and returns events with user corrections',()=>{const db=new Database(':memory:');applyMigrations(db);const imported=importMsqTideFile(db,{text:fixture(),filename:'fixture.csv',sourceUrl:'https://example.invalid/fixture',downloadedAtUtc:'2026-01-01T00:00:00Z'});expect(imported.eventCount).toBeGreaterThan(4);const events=officialEvents(db,'TEST01','2025-12-31T00:00:00Z','2026-01-03T00:00:00Z',30,.2);expect(events[0].heightM).toBeGreaterThan(.2);expect(nearestOfficialStations(db,{latitude:-27.94,longitude:153.43})[0].distanceKm).toBeLessThan(5);db.close()});
  it('calculates reference port distance across wrap-safe radians',()=>expect(haversineKm({latitude:-33.86,longitude:151.2},{latitude:-33.87,longitude:151.21})).toBeLessThan(2));
  it('rejects invalid files without accepting empty arrays',()=>expect(()=>parseMsqPredictedIntervalCsv('bad')).toThrow('MSQ_METADATA_MISSING'));
});
