export type HealthState={status:'REAL'|'PARTIAL'|'DISABLED'|'NOT_IMPLEMENTED'|'NOT_APPLICABLE'|'BLOCKED_BY_CREDENTIALS'|'BLOCKED_BY_PROVIDER_LIMITATION';lastSuccess:string|null;lastError:string|null;detail:string};
export const providerHealth:Record<string,HealthState>={
  geocoding:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'Photon public instance; real requests and cache, no public SLA'},
  weather:{status:'REAL',lastSuccess:null,lastError:null,detail:'Open-Meteo hourly forecast; real Australian-coordinate requests'},
  solar:{status:'REAL',lastSuccess:null,lastError:null,detail:'SunCalc local sunrise, twilight and moon calculations; no network'},
  marine:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'Open-Meteo Marine with water-type applicability and returned-grid distance'},
  officialTide:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'MSQ Gold Coast Seaway 2026 imported; other states not imported'},
  eot20:{status:'DISABLED',lastSuccess:null,lastError:'EOT20_MODEL_FILES_MISSING',detail:'eo-tides adapter ready; 2.3 GB external model archive not installed'},
  warnings:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'BOM state RSS parsed; precise CAP geometry/expiry not implemented'},
  observations:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'BOM state 10-minute XML; candidate station ranking and current-window scoring'},
  marineForecast:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'Verified BOM text products for Sydney; national zone map incomplete and Gold Coast text endpoint currently 404'},
  nswMhlWave:{status:'NOT_IMPLEMENTED',lastSuccess:null,lastError:null,detail:'No MHL buoy adapter in this build'},
  waterData:{status:'BLOCKED_BY_PROVIDER_LIMITATION',lastSuccess:null,lastError:'BOM Water Data Online SOS2 currently returns HTTP 500',detail:'Official endpoint probed; local rain context remains available, no river level is claimed'},
  regulations:{status:'NOT_IMPLEMENTED',lastSuccess:null,lastError:null,detail:'Official state entry links not yet exposed'},
};
export function markHealth(name:string,ok:boolean,error?:unknown){const item=providerHealth[name];if(!item)return;if(ok){item.lastSuccess=new Date().toISOString();item.lastError=null}else item.lastError=error instanceof Error?error.message:String(error??'Unknown provider error')}
