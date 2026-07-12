import { BarChart3, Fish, ShieldCheck, Wind } from 'lucide-react'; import type { Score } from '../types';
const copy=(n:number)=>n>=80?'高':n>=68?'较好':n>=50?'一般':'谨慎';
export function MetricRow({score}:{score:Score}){const m=[['安全性',score.safetyScore,ShieldCheck],['舒适度',score.comfortScore,Wind],['鱼口条件',score.fishingConditionScore,Fish],['数据可信度',score.dataConfidenceScore,BarChart3]] as const;return <div className="metrics">{m.map(([label,n,Icon])=><div className="metric" key={label}><Icon/><span><b>{label}</b><strong>{n}<small>/100</small></strong><em>{copy(n)}</em></span></div>)}</div>}
