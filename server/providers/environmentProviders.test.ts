import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { bomWarningSeverity, classifyBomWarning } from './bom.js';
import { eot20Applicability, eot20Status, calculateEot20 } from './eot20.js';
import { OpenMeteoMarine } from './openMeteo.js';
import { localAstronomy } from './environmentContext.js';

afterEach(()=>vi.restoreAllMocks());
describe('environment provider contracts',()=>{
  it.each([
    ['Strong Wind Warning for Sydney Closed Waters','Strong Wind Warning'],
    ['Gale Warning for Hunter Coast','Gale Warning'],
    ['Hazardous Surf Warning','Hazardous Surf'],
    ['Flood Warning for Hawkesbury River','Flood Warning'],
    ['Damaging Waves possible','Damaging Waves'],
  ])('classifies BOM warning %s', (title,type)=>expect(classifyBomWarning(title)).toBe(type));
  it('maps severe warnings to hard-block severity',()=>expect(bomWarningSeverity('Storm Force Wind Warning')).toBe('severe'));
  it('makes open coast applicable and harbour low confidence',()=>{expect(eot20Applicability('beach','coastal')).toBe('APPLICABLE');expect(eot20Applicability('wharf','harbour')).toBe('LOW_CONFIDENCE')});
  it('does not apply EOT20 to freshwater',()=>expect(eot20Applicability('freshwater','freshwater')).toBe('NOT_APPLICABLE'));
  it('reports missing EOT20 files instead of generating values',async()=>{const old=process.env.EOT20_MODEL_PATH;process.env.EOT20_MODEL_PATH='Z:/definitely-missing';expect(eot20Status().reason).toBe('MODEL_FILES_MISSING');await expect(calculateEot20({latitude:-33.9,longitude:151.2,startUtc:'2026-01-01T00:00:00Z',endUtc:'2026-01-02T00:00:00Z',intervalMinutes:60,spotType:'beach'})).rejects.toThrow('MODEL_FILES_MISSING');if(old===undefined)delete process.env.EOT20_MODEL_PATH;else process.env.EOT20_MODEL_PATH=old});
  it('reports an incomplete or corrupt model directory',()=>{const old=process.env.EOT20_MODEL_PATH,root=mkdtempSync(resolve(tmpdir(),'eot20-invalid-')),ocean=resolve(root,'EOT20','ocean_tides');mkdirSync(ocean,{recursive:true});writeFileSync(resolve(ocean,'M2_ocean_eot20.nc'),'not-netcdf');process.env.EOT20_MODEL_PATH=root;expect(eot20Status()).toEqual(expect.objectContaining({status:'DISABLED',reason:'MODEL_FILES_INVALID',fileCount:1}));if(old===undefined)delete process.env.EOT20_MODEL_PATH;else process.env.EOT20_MODEL_PATH=old});
  it('keeps Open-Meteo sea level as model trend, never formal tide',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({latitude:-33.9,longitude:151.25,hourly:{time:['2026-01-01T00:00'],wave_height:[1],swell_wave_height:[.7],swell_wave_period:[8],sea_level_height_msl:[.2]}})}));const row=(await new OpenMeteoMarine().getHourly({latitude:-33.9,longitude:151.25},1))[0] as Record<string,unknown>;expect(row.modelSeaLevelTrendM).toBe(.2);expect(row.tideHeightM).toBeUndefined();expect(row.sources).toEqual(expect.objectContaining({modelSeaLevelTrend:'Open-Meteo sea_level_height_msl'}))});
  it('calculates astronomy locally with moon weight zero',()=>{const result=localAstronomy({latitude:-33.86,longitude:151.21},new Date('2026-07-11T00:00:00Z'));expect(result.sunriseUtc).toMatch(/^2026-/);expect(result.scoringWeight).toBe(0);expect(result.networkRequired).toBe(false)});
});
