import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, test } from 'vitest';
import { applyMigrations } from '../db/applyMigrations.js';
import { importBomNswTideFile, parseBomNswTideText, type BomNswTideDocument } from './bomNswTide.js';

const path=resolve('data/raw/tides/bom-nsw/IDO59001_2026_NSW_TP007.pdf');let binary:Buffer,text:string,parsed:BomNswTideDocument;
beforeAll(async()=>{binary=readFileSync(path);const document=await getDocument({data:new Uint8Array(binary)}).promise;const pages=[];for(let pageNumber=1;pageNumber<=document.numPages;pageNumber+=1){const page=await document.getPage(pageNumber),content=await page.getTextContent();pages.push(content.items.map(item=>'str'in item?item.str:'').join(' '));}text=pages.join(' ');parsed=parseBomNswTideText(text,'NSW_TP007');});
describe('BOM NSW official PDF real-file parser',()=>{
  test('parses Sydney station metadata and metres',()=>{expect(parsed.station.name).toBe('SYDNEY (FORT DENISON)');expect(parsed.station.latitude).toBeCloseTo(-33.85,4);expect(parsed.station.longitude).toBeCloseTo(151.2167,4);expect(parsed.station.datum).toContain('LAT');expect(parsed.events[0].heightM).toBe(0.5);});
  test('parses every month across PDF page boundaries',()=>{expect(new Set(parsed.events.map(event=>event.local.slice(5,7))).size).toBe(12);expect(parsed.events).toHaveLength(1411);});
  test('identifies alternating official high and low events',()=>{expect(parsed.events.filter(event=>event.type==='HIGH')).toHaveLength(705);expect(parsed.events.filter(event=>event.type==='LOW')).toHaveLength(706);});
  test('converts summer daylight-saving and winter standard time to UTC',()=>{expect(parsed.events.find(event=>event.local==='2026-01-01T00:17:00')?.utc).toBe('2025-12-31T13:17:00.000Z');expect(parsed.events.find(event=>event.local==='2026-07-01T03:19:00')?.utc).toBe('2026-06-30T17:19:00.000Z');});
  test('imports source hash and keeps old valid data when a new parse fails',()=>{const db=new Database(':memory:');applyMigrations(db);const input={text,binary,filename:'IDO59001_2026_NSW_TP007.pdf',sourceUrl:'https://www.bom.gov.au/ntc/IDO59001/IDO59001_2026_NSW_TP007.pdf',downloadedAtUtc:'2026-07-12T00:00:00.000Z',stationId:'NSW_TP007'};const result=importBomNswTideFile(db,input);expect(result.sha256).toBe('a064d03d8c0752b9587deb19d1fd2ea3c9d17f41de1333079f5c4c3748b6e8fc');expect(()=>importBomNswTideFile(db,{...input,text:'invalid'})).toThrow('BOM_NSW_HEADER_INVALID');expect((db.prepare('select count(*) n from tide_events').get() as {n:number}).n).toBe(1411);db.close();});
});
