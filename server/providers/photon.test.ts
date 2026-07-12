import {describe,expect,it} from 'vitest';
import {normalizePhotonFeature} from './photon.js';
describe('Photon adapter normalization',()=>{it('normalizes an Australian POI and timezone',()=>{const result=normalizePhotonFeature({geometry:{coordinates:[151.2724,-33.8907]},properties:{name:'Bondi Beach',city:'Sydney',state:'New South Wales',postcode:'2026',countrycode:'AU',osm_type:'N',osm_id:1}});expect(result).toMatchObject({name:'Bondi Beach',state:'NSW',timezone:'Australia/Sydney',countryCode:'AU',latitude:-33.8907,longitude:151.2724});expect(result.address).toContain('Australia')})});
