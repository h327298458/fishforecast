export type HealthState={status:'REAL'|'PARTIAL'|'DISABLED'|'NOT_IMPLEMENTED'|'NOT_APPLICABLE'|'BLOCKED_BY_CREDENTIALS'|'BLOCKED_BY_PROVIDER_LIMITATION';lastSuccess:string|null;lastError:string|null;detail:string};
export const providerHealth:Record<string,HealthState>={
  geocoding:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'Photon public instance; real requests and cache, no public SLA'},
  weather:{status:'REAL',lastSuccess:null,lastError:null,detail:'Open-Meteo hourly forecast; real Australian-coordinate requests'},
  solar:{status:'REAL',lastSuccess:null,lastError:null,detail:'SunCalc local sunrise, twilight and moon calculations; no network'},
  marine:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'Open-Meteo Marine with water-type applicability and returned-grid distance'},
  officialTide:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'BOM NSW 2026–2027 and MSQ QLD reference-station events imported; national coverage remains incomplete'},
  eot20:{status:'REAL',lastSuccess:null,lastError:null,detail:'eo-tides EOT20 local model installed when EOT20_MODEL_PATH is mounted; status becomes unavailable if its verified files are absent'},
  warnings:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'BOM state RSS parsed; precise CAP geometry/expiry not implemented'},
  observations:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'BOM state 10-minute XML; candidate station ranking and current-window scoring'},
  marineForecast:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'BOM official zone forecasts: Sydney text products and Gold Coast HTML fallback verified; national zone mapping incomplete'},
  nswMhlWave:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'Real NSW MHL offshore buoy observations for NSW locations; deep-water buoy is explicitly reduced for harbour and estuary spots'},
  waterData:{status:'PARTIAL',lastSuccess:null,lastError:null,detail:'Brooklyn/lower Hawkesbury MHL public Spencer water-level series and North Richmond upstream rainfall context; gauge is tidal and public route has no discharge series'},
  regulations:{status:'NOT_IMPLEMENTED',lastSuccess:null,lastError:null,detail:'Official state entry links not yet exposed'},
};
export function markHealth(name:string,ok:boolean,error?:unknown){const item=providerHealth[name];if(!item)return;if(ok){item.lastSuccess=new Date().toISOString();item.lastError=null}else item.lastError=error instanceof Error?error.message:String(error??'Unknown provider error')}
