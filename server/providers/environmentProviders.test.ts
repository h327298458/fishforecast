import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { bomWarningSeverity, classifyBomWarning, matchBomWarnings, warningOverlapsWindow, observationRank, getBomMarineForecast, type BomWarning } from './bom.js';
import { eot20Applicability, eot20Status, calculateEot20, eot20CacheIdentity } from './eot20.js';
import { OpenMeteoMarine, clearOpenMeteoCache } from './openMeteo.js';
import { clearRainContextCache, localAstronomy } from './environmentContext.js';
import { getNswMhlWaveObservation, mhlApplicability } from './nswMhlWave.js';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();clearOpenMeteoCache();clearRainContextCache();});
describe('environment provider contracts',()=>{
  it.each([
    ['Strong Wind Warning for Sydney Closed Waters','Strong Wind Warning'],
    ['Gale Warning for Hunter Coast','Gale Warning'],
    ['Hazardous Surf Warning','Hazardous Surf'],
    ['Flood Warning for Hawkesbury River','Flood Warning'],
    ['Damaging Waves possible','Damaging Waves'],
  ])('classifies BOM warning %s', (title,type)=>expect(classifyBomWarning(title)).toBe(type));
  it('maps severe warnings to hard-block severity',()=>expect(bomWarningSeverity('Storm Force Wind Warning')).toBe('severe'));
  it('matches a Sydney marine warning but rejects an unrelated final Paroo flood warning',()=>{const base:BomWarning={warningId:'x',provider:'BOM',productCode:null,warningType:'Strong Wind Warning',title:'Strong Wind Warning for Sydney Waters',severity:'minor',issuedAtUtc:'2026-07-12T00:00:00Z',validFromUtc:null,validUntilUtc:null,state:'NSW',forecastDistrict:'Sydney Waters',marineZone:'Sydney Waters',affectedAreaText:'Sydney Waters',sourceUrl:'https://www.bom.gov.au/example',rawPayload:'{}',fetchedAtUtc:'2026-07-12T00:00:00Z',lifecycle:'ACTIVE',timeBasis:'RSS_ISSUED'};const sydney=matchBomWarnings([base],{latitude:-33.8915,longitude:151.2767},'NSW');expect(sydney.status).toBe('AFFECTED');const finalFlood={...base,title:'Final Flood Warning for the Paroo River (QLD)',state:'QLD',lifecycle:'FINAL' as const};const goldCoast=matchBomWarnings([finalFlood],{latitude:-28.0,longitude:153.4},'QLD');expect(goldCoast.status).toBe('CLEAR');expect(goldCoast.matches[0].matchReason).toBe('WARNING_FINAL_OR_CANCELLED')});
  it('marks a non-specific active state warning as possibly affected rather than safe',()=>{const warning:BomWarning={warningId:'x',provider:'BOM',productCode:null,warningType:'Severe Weather Warning',title:'Severe Weather Warning',severity:'severe',issuedAtUtc:'2026-07-12T00:00:00Z',validFromUtc:null,validUntilUtc:null,state:'NSW',forecastDistrict:null,marineZone:null,affectedAreaText:'',sourceUrl:'https://www.bom.gov.au/example',rawPayload:'{}',fetchedAtUtc:'2026-07-12T00:00:00Z',lifecycle:'ACTIVE',timeBasis:'RSS_ISSUED'};expect(matchBomWarnings([warning],{latitude:-33.89,longitude:151.27},'NSW').status).toBe('POSSIBLY_AFFECTED')});
  it('detects a warning starting mid-window and excludes a warning ending at the window start',()=>{const warning={lifecycle:'ACTIVE' as const,issuedAtUtc:'2026-07-12T00:00:00Z',validFromUtc:'2026-07-12T01:00:00Z',validUntilUtc:'2026-07-12T03:00:00Z',fetchedAtUtc:'2026-07-12T00:00:00Z'};expect(warningOverlapsWindow(warning,'2026-07-12T00:00:00Z','2026-07-12T02:00:00Z')).toBe(true);expect(warningOverlapsWindow(warning,'2026-07-12T03:00:00Z','2026-07-12T04:00:00Z')).toBe(false)});
  it('prefers a fresh complete coastal observation over a nearer incomplete airport station',()=>{const now=new Date().toISOString(),base={stationId:'x',latitude:-33.9,longitude:151.2,observedAtUtc:now,temperatureC:20,windSpeedKmh:12,gustKmh:20,windDirectionDeg:180,pressureHpa:1015,rainSince9amMm:0,distanceKm:8,sourceUrl:'x',fetchedAtUtc:now,usingStaleCache:false,ageMinutes:0,fieldCompleteness:4};const coast={...base,stationName:'Coastal buoy'};const airport={...base,stationName:'Sydney Airport',distanceKm:3,gustKmh:null,pressureHpa:null,fieldCompleteness:1};expect(observationRank(coast,{latitude:-33.9,longitude:151.2})).toBeLessThan(observationRank(airport,{latitude:-33.9,longitude:151.2}))});
  it('falls back to BOM Gold Coast official forecast page when legacy text product returns 404',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:false,status:404}).mockResolvedValueOnce({ok:true,text:async()=>'<html><body><p class="date">Forecast issued at 3:00 pm EST.</p><div class="day"><h2>Tuesday</h2><dl><dt>Winds</dt><dd>Westerly 10 to 15 knots.</dd><dt>Seas</dt><dd>Below 1 metre.</dd><dt>Swell</dt><dd>Southerly 1 metre.</dd><dt>Weather</dt><dd>Sunny.</dd></dl></div></div></body></html>'}));const result=await getBomMarineForecast({latitude:-28,longitude:153.4},'QLD');expect(result.sourceUrl).toContain('gold-coast-waters.shtml');expect(result.windRanges[0]).toEqual(expect.objectContaining({minKnots:10,maxKnots:15,minKmh:18.5,maxKmh:27.8}));expect(result.days).toEqual([expect.objectContaining({label:'Tuesday',winds:'Westerly 10 to 15 knots.',seas:'Below 1 metre.'})])});
  it('normalises the official MHL Sydney buoy fields and never treats harbour data as shore waves',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({'991':{name:'Hs',unit_type:'Wave Height',obsdate:'2026-07-13 19:00:00',value:[0.7]},'994':{name:'TP1',unit_type:'Wave Period',obsdate:'2026-07-13 19:00:00',value:[12]},'993':{name:'Wave Direction',unit_type:'Wave Direction',obsdate:'2026-07-13 19:00:00',value:[158]},'1073':{name:'Sea Temp',unit_type:'Sea Temperature',obsdate:'2026-07-13 19:00:00',value:[18]}})}));const value=await getNswMhlWaveObservation({latitude:-33.8568,longitude:151.2027},'wharf','harbour');expect(value).toEqual(expect.objectContaining({stationCode:'SYDDOW',significantWaveHeightM:.7,wavePeriodSeconds:12,applicability:'LOW_CONFIDENCE'}));expect(mhlApplicability('beach','coastal').applicability).toBe('APPLICABLE');expect(mhlApplicability('freshwater','freshwater').applicability).toBe('NOT_APPLICABLE')});
  it('makes open coast applicable and harbour low confidence',()=>{expect(eot20Applicability('beach','coastal')).toBe('APPLICABLE');expect(eot20Applicability('wharf','harbour')).toBe('LOW_CONFIDENCE')});
  it('does not apply EOT20 to freshwater',()=>expect(eot20Applicability('freshwater','freshwater')).toBe('NOT_APPLICABLE'));
  it('reuses an EOT20 physical calculation when only spot type changes',()=>{
    const base={latitude:-33.8915,longitude:151.2767,startUtc:'2026-01-01T00:00:00Z',endUtc:'2026-01-08T00:00:00Z',intervalMinutes:60,timezone:'Australia/Sydney'};
    const beach=eot20CacheIdentity({...base,spotType:'beach',waterType:'coastal'},'EOT20','test','hash');
    const wharf=eot20CacheIdentity({...base,spotType:'wharf',waterType:'harbour'},'EOT20','test','hash');
    const elsewhere=eot20CacheIdentity({...base,latitude:-33.8,spotType:'beach',waterType:'coastal'},'EOT20','test','hash');
    expect(beach).toBe(wharf);
    expect(beach).not.toBe(elsewhere);
  });
  it('reports missing EOT20 files instead of generating values',async()=>{const old=process.env.EOT20_MODEL_PATH;process.env.EOT20_MODEL_PATH='Z:/definitely-missing';expect(eot20Status().reason).toBe('MODEL_FILES_MISSING');await expect(calculateEot20({latitude:-33.9,longitude:151.2,startUtc:'2026-01-01T00:00:00Z',endUtc:'2026-01-02T00:00:00Z',intervalMinutes:60,spotType:'beach'})).rejects.toThrow('MODEL_FILES_MISSING');if(old===undefined)delete process.env.EOT20_MODEL_PATH;else process.env.EOT20_MODEL_PATH=old});
  it('reports an incomplete or corrupt model directory',()=>{const old=process.env.EOT20_MODEL_PATH,root=mkdtempSync(resolve(tmpdir(),'eot20-invalid-')),ocean=resolve(root,'EOT20','ocean_tides');mkdirSync(ocean,{recursive:true});writeFileSync(resolve(ocean,'M2_ocean_eot20.nc'),'not-netcdf');process.env.EOT20_MODEL_PATH=root;expect(eot20Status()).toEqual(expect.objectContaining({status:'DISABLED',reason:'MODEL_FILES_INVALID',fileCount:1}));if(old===undefined)delete process.env.EOT20_MODEL_PATH;else process.env.EOT20_MODEL_PATH=old});
  it('keeps Open-Meteo sea level as model trend, never formal tide',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({latitude:-33.9,longitude:151.25,hourly:{time:['2026-01-01T00:00'],wave_height:[1],swell_wave_height:[.7],swell_wave_period:[8],sea_level_height_msl:[.2]}})}));const row=(await new OpenMeteoMarine().getHourly({latitude:-33.9,longitude:151.25},1))[0] as Record<string,unknown>;expect(row.modelSeaLevelTrendM).toBe(.2);expect(row.tideHeightM).toBeUndefined();expect(row.sources).toEqual(expect.objectContaining({modelSeaLevelTrend:'Open-Meteo sea_level_height_msl'}))});
  it('does not refetch Open-Meteo Marine when only suitability inputs change',async()=>{
    const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({latitude:-33.9,longitude:151.25,hourly:{time:['2026-01-01T00:00'],wave_height:[1],swell_wave_height:[.7],swell_wave_period:[8],sea_level_height_msl:[.2]}})});
    vi.stubGlobal('fetch',fetchMock);
    const point={latitude:-33.9,longitude:151.25};
    await new OpenMeteoMarine().getHourly(point,7);
    await new OpenMeteoMarine().getHourly(point,7);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('calculates astronomy locally with moon weight zero',()=>{const result=localAstronomy({latitude:-33.86,longitude:151.21},new Date('2026-07-11T00:00:00Z'));expect(result.sunriseUtc).toMatch(/^2026-/);expect(result.scoringWeight).toBe(0);expect(result.networkRequired).toBe(false)});
});
