import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { calculateEot20, clearEot20MemoryCache, eot20Status, type Eot20Result } from './eot20.js';

const root=resolve('data/tide-models');
const python=resolve('.venv-eot20/Scripts/python.exe');
process.env.EOT20_MODEL_PATH=root;
process.env.EOT20_MODEL_VERSION='EOT20-85762';
process.env.EOT20_CACHE_PATH=resolve('data/eot20-test-cache');
process.env.EOT20_PYTHON=python;

describe('EOT20 real local-model integration',()=>{
  let bondi:Eot20Result;
  let brooklyn:Eot20Result;
  beforeAll(async()=>{
    if(!existsSync(python))throw new Error(`EOT20_PYTHON_MISSING:${python}`);
    expect(eot20Status().status).toBe('REAL');
    bondi=await calculateEot20({latitude:-33.8915,longitude:151.2767,startUtc:'2026-10-03T12:00:00.000Z',endUtc:'2026-10-05T12:00:00.000Z',intervalMinutes:30,spotType:'beach',waterType:'coastal',timezone:'Australia/Sydney'});
    brooklyn=await calculateEot20({latitude:-33.55,longitude:151.22,startUtc:'2026-07-12T03:00:00.000Z',endUtc:'2026-07-13T03:00:00.000Z',intervalMinutes:30,spotType:'estuary',waterType:'estuary',timezone:'Australia/Sydney'});
  });
  test('loads all official model constituent files',()=>expect(eot20Status().fileCount).toBe(17));
  test('calculates Bondi continuous values and extrema across local midnight',()=>{expect(bondi.values).toHaveLength(96);expect(bondi.events.some(event=>event.type==='HIGH')).toBe(true);expect(bondi.events.some(event=>event.type==='LOW')).toBe(true);expect(new Set(bondi.values.map(value=>value.timestampLocal.slice(0,10))).size).toBeGreaterThan(2);});
  test('converts UTC to Sydney local time across daylight-saving transition',()=>{const before=bondi.values.find(value=>value.timestampUtc==='2026-10-03T15:30:00Z');const after=bondi.values.find(value=>value.timestampUtc==='2026-10-03T16:00:00Z');expect(before?.timestampLocal).toBe('2026-10-04T01:30:00');expect(after?.timestampLocal).toBe('2026-10-04T03:00:00');});
  test('reduces estuary applicability and confidence for Brooklyn',()=>{expect(brooklyn.applicability).toBe('LOW_CONFIDENCE');expect(brooklyn.confidence).toBeLessThan(bondi.confidence);});
  test('hits persistent cache without invoking a fallback model',async()=>{clearEot20MemoryCache();const cached=await calculateEot20({latitude:-33.55,longitude:151.22,startUtc:'2026-07-12T03:00:00.000Z',endUtc:'2026-07-13T03:00:00.000Z',intervalMinutes:30,spotType:'estuary',waterType:'estuary',timezone:'Australia/Sydney'});expect(cached.cacheHit).toBe(true);expect(cached.values).toEqual(brooklyn.values);});
});
