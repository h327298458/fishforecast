import { describe,expect,it } from 'vitest'; import { angularDifference, mergeWindows, scoreHour, weightedScore } from './scoring.js'; import type { HourlyEnvironment } from './types.js';
const env:HourlyEnvironment={timestampUtc:'2026-01-01T00:00:00Z',timestampLocal:'2026-01-01 11:00',timezone:'Australia/Sydney',temperatureC:20,apparentTemperatureC:20,humidityPercent:60,precipitationProbabilityPercent:10,precipitationMm:0,windSpeedKmh:10,windGustKmh:18,windDirectionDeg:200,pressureHpa:1016,pressureTrendHpa3h:0,cloudCoverPercent:20,waveHeightM:1,swellHeightM:.7,swellPeriodSeconds:8,modelSeaLevelTrendM:.1,tideHeightM:1.2,tidePhase:'rising',warningSeverity:'none',daylightState:'day',sources:{},fetchedAtUtc:'2026-01-01T00:00:00Z',dataQuality:{weather:.9,marine:.8,tide:.8,warnings:.8,overall:.84}};
describe('scoring',()=>{it('renormalises missing weights',()=>expect(weightedScore([{value:80,weight:.4},{value:null,weight:.6}])).toBe(80));it('handles direction wrap',()=>expect(angularDifference(350,10)).toBe(20));it('hard-blocks severe warnings',()=>expect(scoreHour({...env,warningSeverity:'severe'}).safetyStatus).toBe('NOT_RECOMMENDED'));it('caps safety when official warnings are unknown',()=>{const score=scoreHour({...env,warningSeverity:'unknown'});expect(score.safetyStatus).toBe('UNKNOWN');expect(score.safetyScore).toBeLessThanOrEqual(60)});it('reduces confidence without pretending missing is ideal',()=>{const r=scoreHour({...env,tideHeightM:null,tidePhase:null,dataQuality:{...env.dataQuality,overall:.52}});expect(r.dataConfidenceScore).toBe(52);expect(r.missing).toContain('tide')});it('merges two safe adjacent hours',()=>{const score=scoreHour(env);expect(mergeWindows([{timestampUtc:'a',score},{timestampUtc:'b',score}])).toHaveLength(1)})});
describe('confidence evidence',()=>{it('passes forecast confidence reasons through to the user-visible score',()=>{const score=scoreHour({...env,dataQuality:{...env.dataQuality,overall:.73,reasons:['BOM official warnings checked','No usable tide source']}});expect(score.dataConfidenceScore).toBe(73);expect(score.confidenceReasons).toEqual(['BOM official warnings checked','No usable tide source']);})});

it('does not describe deliberately excluded harbour wave data as missing',()=>{
  const score=scoreHour({...env,waveHeightM:null,waveDataStatus:'LOW_CONFIDENCE'});
  expect(score.missing).not.toContain('wave');
});

it('does not describe tide as missing while a real EOT20 calculation is pending',()=>{
  const score=scoreHour({...env,tideHeightM:null,tidePhase:null,tideDataStatus:'PENDING'});
  expect(score.missing).not.toContain('tide');
  expect(score.negatives).not.toContain('缺少 tide 数据');
});

it('limits a long safe run to its best actionable four-hour window',()=>{
  const safe=(value:number)=>({timestampUtc:`2026-01-01T${String(value).padStart(2,'0')}:00:00Z`,score:{...scoreHour(env),fishingConditionScore:72+value,dataConfidenceScore:80,safetyStatus:'SAFE' as const}});
  const windows=mergeWindows([0,1,2,3,4,5,6].map(safe));
  expect(windows).toHaveLength(1);
  expect((new Date(windows[0].endUtc).getTime()-new Date(windows[0].startUtc).getTime())/3_600_000).toBeLessThanOrEqual(4);
});

it('scores an exposed headwind more conservatively than a sheltered spot',()=>{
  const windy={...env,windSpeedKmh:24,windGustKmh:38,windDirectionDeg:90};
  const exposed=scoreHour(windy,'beach',{exposureDirectionDeg:90});
  const sheltered=scoreHour(windy,'wharf',{exposureDirectionDeg:90,sheltered:true});
  expect(exposed.safetyScore).toBeLessThan(sheltered.safetyScore);
  expect(exposed.comfortScore).toBeLessThan(sheltered.comfortScore);
  expect(exposed.negatives).toContain('当前风向正对钓点暴露方向');
});

it('honours a user gust limit as a hard safety block',()=>{
  expect(scoreHour({...env,windGustKmh:36},'wharf',{maximumGustKmh:35}).safetyStatus).toBe('NOT_RECOMMENDED');
});
