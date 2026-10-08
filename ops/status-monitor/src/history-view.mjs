import { dayKey, formatClock, formatDateTime, formatDay, recentDayKeys } from './time.mjs';
const MINUTE=60000,HOUR=60*MINUTE;
const counts=value=>Array.isArray(value)?value:[value?.up??0,value?.slow??0,value?.down??0];
const total=value=>counts(value).reduce((a,b)=>a+b,0);
function describe(label,value){const [up,slow,failed]=counts(value),n=up+slow+failed;return{label,total:n,failed,uptime:n?(n-failed)/n:null,level:!n?'none':!failed?'up':failed/n<.05?'partial':'down'};}
export function buildHistory(state,config,now){
  const retained=recentDayKeys(now,config.timezone,90),ids=config.checks.map(c=>c.id);
  const first=retained.find(date=>ids.some(id=>total(state.checks[id]?.days?.[date])))??retained.at(-1);
  const dates=retained.slice(retained.indexOf(first));
  for(const [granularity,map,unit,steps] of [
    ['minute',state.timeline?.minutes??{},MINUTE,[2,5,10,15,30]],
    ['hour',state.timeline?.hours??{},HOUR,[1,2,4,8,12,24]],
  ]){
    const keys=Object.keys(map).map(Number).filter(t=>t<=now&&dayKey(t,config.timezone)>=first).sort((a,b)=>a-b);
    if(!keys.length)continue;
    const byDate={};
    for(const key of keys){const date=dayKey(key,config.timezone),group=byDate[date]??={};for(const id of ids){const sum=group[id]??=[0,0,0],v=counts(map[key]?.[id]);for(let n=0;n<3;n++)sum[n]+=v[n];}}
    // Finer buckets are eligible only when every daily outcome is accounted for.
    if(!ids.every(id=>dates.every(date=>counts(state.checks[id]?.days?.[date]).every((n,i)=>n===(byDate[date]?.[id]?.[i]??0)))))continue;
    const latest=keys.at(-1);
    const size=steps.map(step=>step*unit).find(step=>Math.floor(latest/step)-Math.floor(keys[0]/step)<90);
    if(!size)continue;
    const end=Math.floor(latest/size)*size,start=Math.floor(keys[0]/size)*size;
    const length=Math.floor((end-start)/size)+1;
    const label=t=>`${formatDateTime(t,config.timezone)}–${dayKey(t,config.timezone)===dayKey(Math.min(t+size,now),config.timezone)?formatClock(Math.min(t+size,now),config.timezone):formatDateTime(Math.min(t+size,now),config.timezone)}`;
    const checks=Object.fromEntries(ids.map(id=>{
      const values=Array.from({length},()=>[0,0,0]);
      for(const key of keys){const index=Math.floor((key-start)/size);if(index<0||index>=length)continue;const v=counts(map[key]?.[id]);for(let n=0;n<3;n++)values[index][n]+=v[n];}
      return[id,values.map((value,index)=>describe(label(start+index*size),value))];
    }));
    return{granularity,start:dayKey(start,config.timezone)===dayKey(latest,config.timezone)?formatClock(start,config.timezone):formatDateTime(start,config.timezone),end:formatClock(latest,config.timezone),checks};
  }
  // Daily-only legacy history is not split into fictional finer samples.
  return{granularity:'day',start:formatDay(first),end:'今天',checks:Object.fromEntries(ids.map(id=>[id,dates.map(date=>describe(formatDay(date),state.checks[id]?.days?.[date]))]))};
}
export function compactHistory(bars){
  if(bars.length<=45)return bars;
  return Array.from({length:Math.ceil(bars.length/2)},(_,i)=>{const a=bars[i*2],b=bars[i*2+1];
    if(!b)return a;
    const failed=a.failed+b.failed,n=a.total+b.total;
    return describe(`${a.label} / ${b.label}`,[n-failed,0,failed]);
  });
}
