import { calculateEot20, eot20Status } from '../server/providers/eot20.js';
const places=[
  {name:'Brooklyn NSW',latitude:-33.55,longitude:151.22,spotType:'estuary',waterType:'estuary',timezone:'Australia/Sydney'},
  {name:'Walsh Bay NSW',latitude:-33.855,longitude:151.203,spotType:'wharf',waterType:'harbour',timezone:'Australia/Sydney'},
  {name:'Bondi Beach NSW',latitude:-33.8915,longitude:151.2767,spotType:'beach',waterType:'coastal',timezone:'Australia/Sydney'},
  {name:'Gold Coast QLD',latitude:-27.94,longitude:153.43,spotType:'beach',waterType:'coastal',timezone:'Australia/Brisbane'},
] as const;
const status=eot20Status();if(status.status!=='REAL')throw new Error(`EOT20_NOT_READY:${status.reason}`);
const start=new Date();start.setUTCMinutes(0,0,0);const end=new Date(start.getTime()+7*86400000);
const results=[];for(const place of places){const result=await calculateEot20({...place,startUtc:start.toISOString(),endUtc:end.toISOString(),intervalMinutes:30});results.push({place:place.name,coordinates:{latitude:place.latitude,longitude:place.longitude},model:result.model,version:result.version,manifestHash:result.manifestHash,applicability:result.applicability,confidence:result.confidence,valueCount:result.values.length,eventCount:result.events.length,firstValue:result.values[0],firstHigh:result.events.find(event=>event.type==='HIGH'),firstLow:result.events.find(event=>event.type==='LOW'),dailyRanges:result.dailyRanges,cacheHit:result.cacheHit});}
console.log(JSON.stringify({generatedAtUtc:new Date().toISOString(),startUtc:start.toISOString(),endUtc:end.toISOString(),results},null,2));
