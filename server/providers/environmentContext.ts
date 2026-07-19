import * as SunCalc from 'suncalc';

type RainApiData = {hourly:{time:string[];precipitation:Array<number|null>}};
const rainCache = new Map<string,{expiresAt:number;data:RainApiData}>();
export const clearRainContextCache = () => rainCache.clear();

export function localAstronomy(point:{latitude:number;longitude:number},date=new Date()){
  const sun=SunCalc.getTimes(date,point.latitude,point.longitude),moon=SunCalc.getMoonTimes(date,point.latitude,point.longitude),illumination=SunCalc.getMoonIllumination(date);
  const iso=(value:Date|null|undefined)=>value&&Number.isFinite(value.getTime())?value.toISOString():null;
  return {provider:'SunCalc local calculation',dateUtc:date.toISOString().slice(0,10),sunriseUtc:iso(sun.sunrise),sunsetUtc:iso(sun.sunset),civilDawnUtc:iso(sun.dawn),civilDuskUtc:iso(sun.dusk),nauticalDawnUtc:iso(sun.nauticalDawn),nauticalDuskUtc:iso(sun.nauticalDusk),moonriseUtc:iso(moon.rise),moonsetUtc:iso(moon.set),moonPhase:illumination.phase,moonIlluminationFraction:illumination.fraction,networkRequired:false,scoringWeight:0,notice:'月相是待验证变量，当前不参与鱼口评分。'};
}

export async function getRainContext(point:{latitude:number;longitude:number}){
  const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:String(point.latitude),longitude:String(point.longitude),timezone:'UTC',past_days:'3',forecast_days:'2',hourly:'precipitation'}).toString();
  const key=`${point.latitude.toFixed(4)}:${point.longitude.toFixed(4)}`;
  const cached=rainCache.get(key);let data=cached?.expiresAt&&cached.expiresAt>Date.now()?cached.data:null;
  if(!data){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error(`RAIN_HTTP_${response.status}`);data=await response.json() as RainApiData;rainCache.set(key,{data,expiresAt:Date.now()+Math.max(5,Number(process.env.DATA_CACHE_MINUTES??30))*60_000});}finally{clearTimeout(timer)}}
  const now=Date.now(),points=data.hourly.time.map((time,i)=>({time:new Date(`${time}Z`).getTime(),value:data.hourly.precipitation[i]??0}));const sum=(from:number,to:number)=>Number(points.filter(item=>item.time>=from&&item.time<to).reduce((total,item)=>total+item.value,0).toFixed(1));return{provider:'Open-Meteo weather',past6hMm:sum(now-6*3_600_000,now),past24hMm:sum(now-24*3_600_000,now),past72hMm:sum(now-72*3_600_000,now),future6hMm:sum(now,now+6*3_600_000),fetchedAtUtc:new Date().toISOString(),scope:'LOCAL_POINT_NOT_UPSTREAM_CATCHMENT',inferenceNotice:'近期降雨可能使水体条件和平时不同；这不是鱼口好坏结论。'};}

export async function probeBomWaterData(){const url='https://www.bom.gov.au/waterdata/services?service=SOS&version=2.0&request=GetCapabilities';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error(`BOM_WATER_SOS_${response.status}`);return{status:'PARTIAL',sourceUrl:url,detail:'SOS2 endpoint reachable; station/series selection not implemented'};}catch(error){return{status:'BLOCKED_BY_PROVIDER_LIMITATION',sourceUrl:url,detail:error instanceof Error?error.message:String(error)};}finally{clearTimeout(timer)}}
