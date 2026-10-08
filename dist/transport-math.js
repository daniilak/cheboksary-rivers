import {pointCount,pointValue} from './transport-replay.js';
// Pure transport statistics. Seconds are relative to the GPS day's Moscow midnight.
export function haversine(lon1,lat1,lon2,lat2){const r=Math.PI/180,a=lat1*r,b=lat2*r,h=Math.sin((b-a)/2)**2+Math.cos(a)*Math.cos(b)*Math.sin((lon2-lon1)*r/2)**2;return 12742000*Math.asin(Math.sqrt(Math.min(1,h)));}
export function quantile(values,p){if(!values.length)return null;const a=[...values].sort((a,b)=>a-b),k=(a.length-1)*p,i=Math.floor(k);return a[i]+(a[Math.ceil(k)]-a[i])*(k-i);}
export function moments(values){if(!values.length)return {count:0,mean:null,median:null,cv:null,wait:null};const mean=values.reduce((a,b)=>a+b,0)/values.length,variance=values.reduce((a,b)=>a+(b-mean)**2,0)/values.length;return {count:values.length,mean,median:quantile(values,.5),cv:mean>0?Math.sqrt(variance)/mean:null,wait:mean>0?values.reduce((a,b)=>a+b*b,0)/(2*values.length*mean):null};}
export function matches(track,filter){return (!filter.route||track.route===filter.route)&&(!filter.type||track.type===filter.type);}
export function analyzeDay(day,filter={}){
 const from=filter.from??day.start,to=filter.to??day.end;if(!(to>from))throw Error('Выберите непустой интервал времени');
 const binSize=300,first=Math.floor(from/binSize),last=Math.ceil(to/binSize),bins=Array.from({length:last-first},(_,i)=>({time:(first+i)*binSize,vehicles:new Set(),seconds:0,distance:0}));
 const [west,south,,north]=day.bounds,mx=111320*Math.cos((south+north)*Math.PI/360),grid=new Map(),fleet=new Set(),routes=new Map(),events=new Map();let seconds=0,slow=0,distance=0,points=0;
 function routeStat(tr){if(!routes.has(tr.route))routes.set(tr.route,{id:tr.route,number:tr.number,type:tr.type,vehicles:new Set(),seconds:0,distance:0,slow:0,points:0});return routes.get(tr.route);}
 for(const tr of day.tracks){if(!matches(tr,filter))continue;const stat=routeStat(tr),p=tr.points;
  for(let i=0;i<p.length;i++){
   const cur=p[i],t=cur[0];if(t>=from&&t<=to){fleet.add(tr.id);stat.vehicles.add(tr.id);stat.points++;points++;const b=bins[Math.floor(t/binSize)-first];b?.vehicles.add(tr.id);}
   if(!i||cur[3]===null)continue;const prev=p[i-1],dt=t-prev[0],lo=Math.max(from,prev[0]),hi=Math.min(to,t),duration=hi-lo;if(duration<=0||dt<15||dt>180||cur[3]<0||cur[3]>120)continue;
   const meters=haversine(prev[1]/1e6,prev[2]/1e6,cur[1]/1e6,cur[2]/1e6)*duration/dt;
   seconds+=duration;distance+=meters;stat.seconds+=duration;stat.distance+=meters;if(cur[3]<5){slow+=duration;stat.slow+=duration;}
   const f=((lo+hi)/2-prev[0])/dt,lon=(prev[1]+(cur[1]-prev[1])*f)/1e6,lat=(prev[2]+(cur[2]-prev[2])*f)/1e6;
   const x=Math.floor((lon-west)*mx/250),y=Math.floor((lat-south)*111320/250),key=x+':'+y;
   if(!grid.has(key))grid.set(key,{x,y,lon:west+(x+.5)*250/mx,lat:south+(y+.5)*250/111320,seconds:0,distance:0,slow:0});const cell=grid.get(key);cell.seconds+=duration;cell.distance+=meters;if(cur[3]<5)cell.slow+=duration;
   for(let k=Math.floor(lo/binSize);k<=Math.floor((hi-1e-6)/binSize);k++){const b=bins[k-first];if(!b)continue;const overlap=Math.min(hi,(k+1)*binSize)-Math.max(lo,k*binSize);b.seconds+=overlap;b.distance+=meters*overlap/duration;}
  }
  for(const [t,stop,direction] of tr.visits||[]){if(t<from||t>to)continue;const key=stop+':'+tr.route+':'+direction;if(!events.has(key))events.set(key,{stop,route:tr.route,number:tr.number,type:tr.type,direction,times:[]});events.get(key).times.push({t,id:tr.id});}
 }
 const rows=[...routes.values()].filter(r=>r.points).map(r=>({...r,vehicles:r.vehicles.size,hours:r.seconds/3600,speed:r.seconds?r.distance/r.seconds*3.6:null,slowShare:r.seconds?r.slow/r.seconds:null})).sort((a,b)=>b.hours-a.hours);
 const cells=[...grid.values()].map(c=>({...c,load:c.seconds/(to-from)/.0625,speed:c.seconds?c.distance/c.seconds*3.6:null,slowShare:c.seconds?c.slow/c.seconds:null}));
 const intervals=[...events.values()].map(e=>{e.times.sort((a,b)=>a.t-b.t);const gaps=[];let censored=0;for(let i=1;i<e.times.length;i++){const a=e.times[i-1],b=e.times[i],gap=b.t-a.t;if(a.id===b.id||gap<30)continue; // Same vehicle return is not an inter-vehicle interval.
  let missing=false;for(let k=Math.floor(a.t/binSize)+1;k<Math.floor(b.t/binSize);k++)if(!bins[k-first]?.vehicles.size){missing=true;break;}
  if(missing){censored++;continue;}gaps.push(gap/60);
 }return {...e,visits:e.times.length,times:undefined,...moments(gaps),censored};}).sort((a,b)=>b.visits-a.visits);
 const curve=bins.map(b=>({time:b.time,vehicles:b.vehicles.size,speed:b.seconds?b.distance/b.seconds*3.6:null,hours:b.seconds/3600,coverage:b.vehicles.size>0}));const peak=curve.reduce((a,b)=>b.vehicles>a.vehicles?b:a,{time:from,vehicles:0});
 return {from,to,vehicles:fleet.size,points,vehicleHours:seconds/3600,distanceKm:distance/1000,speed:seconds?distance/seconds*3.6:null,slowShare:seconds?slow/seconds:null,coverage:curve.length?curve.filter(b=>b.coverage).length/curve.length:0,peak,curve,routes:rows,cells,intervals};
}
export function positionsAt(day,time,filter={},maxAge=120){
 const result=new Map();
 for(const tr of day.tracks){
  const count=pointCount(tr);if(!matches(tr,filter)||!count)continue;
  const value=(i,c)=>pointValue(tr,i,c);let l=0,r=count;
  while(l<r){const m=(l+r)>>1;if(value(m,0)<=time)l=m+1;else r=m;}
  const i=l-1;if(i<0)continue;const age=time-value(i,0);if(age>maxAge)continue;
  if(result.has(tr.id)&&result.get(tr.id).age<=age)continue;
  let lon=value(i,1)/1e6,lat=value(i,2)/1e6;const next=i+1<count,valid=next&&value(i+1,3)!==null;
  if(valid&&value(i+1,0)-value(i,0)<=180){const f=age/(value(i+1,0)-value(i,0));lon+=(value(i+1,1)-value(i,1))/1e6*f;lat+=(value(i+1,2)-value(i,2))/1e6*f;}
  result.set(tr.id,{id:tr.id,route:tr.route,number:tr.number,type:tr.type,lon,lat,speed:valid?value(i+1,3):value(i,3),direction:value(i,4),age,lowFloor:tr.lowFloor});
 }
 return [...result.values()];
}
