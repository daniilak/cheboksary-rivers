import {Sediment2D} from './sediment.js';
import {ShallowWater2D} from './shallow-water.js';
import {makeFlowGrid} from './flow-grid.js';
import {displaceWater,nearestWetCell} from './wave-source.js';
let grid,solver,sediment,target=0,running=false,timer,forcing,requested;
let wave=null,events=[],rate=Infinity,wallAnchor=0,timeAnchor=0;
function anchor(){wallAnchor=performance.now();timeAnchor=solver.time;}
function recordWave(){
  if(!wave)return;
  for(const k of solver.active){wave.maxDepth[k]=Math.max(wave.maxDepth[k],solver.h[k]);wave.maxChange=Math.max(wave.maxChange,Math.abs(solver.bed[k]+solver.h[k]-wave.reference[k]));if(solver.h[k]>.05&&solver.bed[k]+solver.h[k]>grid.ceiling-.5)wave.ceilingReached=true;}
  const values=wave.gauges.map(g=>solver.bed[g.cell]+solver.h[g.cell]-g.reference);
  wave.gauges.forEach((g,i)=>{g.peak=Math.max(g.peak,Math.abs(values[i]));if(g.arrival===null&&Math.abs(values[i])>=.05)g.arrival=solver.time-wave.event.time;});
  if(solver.time-wave.lastSample>=5||wave.history.length===0){
    wave.history.push({time:solver.time-wave.event.time,values});wave.lastSample=solver.time;
    if(wave.history.length>1500)wave.history=wave.history.filter((_,i)=>i%2===0);
  }
}
function setForcing(p){
  requested=p;forcing={time:solver.time,q:solver.inletQ??requested?.discharge??0,level:solver.outletLevel??requested?.baseline??p.baseline};
  solver.roughness=p.manning;sediment.configure(p.sediment);target=solver.time+3600;anchor();
}
function snapshot(){
  const length=grid.mask.length,u=new Float32Array(length),v=new Float32Array(length),eta=new Float32Array(length),depth=Float32Array.from(solver.h);
  let edgeWet=false,ceilingReached=false;
  for(const k of solver.active){
    if(solver.h[k]>1e-6){u[k]=solver.hu[k]/solver.h[k];v[k]=solver.hv[k]/solver.h[k];}eta[k]=solver.bed[k]+solver.h[k];
    if(solver.h[k]>.05){
      const x=k%grid.width,y=Math.floor(k/grid.width);
      if((x===0&&!grid.inletMask[k])||(x===grid.width-1&&!grid.outletMask[k])||y===0||y===grid.height-1)edgeWet=true;
      if(eta[k]>grid.ceiling-.5)ceilingReached=true;
    }
  }
  const anomaly=wave?Float32Array.from(solver.h,(h,k)=>grid.mask[k]?solver.bed[k]+h-wave.reference[k]:0):null;
  const waveInfo=wave?{event:wave.event,events,closed:wave.closed,elapsed:solver.time-wave.event.time,rate,maxChange:wave.maxChange,gauges:wave.gauges,history:wave.history}:null;
  self.postMessage({anomaly,wave:waveInfo,maxDepth:wave?Float32Array.from(wave.maxDepth):null,width:grid.width,height:grid.height,bounds:grid.bounds,dx:grid.dx,dy:grid.dy,mask:grid.mask,river:grid.river,solid:grid.solid,bed:solver.bed,sediment:sediment.snapshot(),u,v,eta,depth,diagnostics:{...solver.diagnostics(),edgeWet,ceilingReached:ceilingReached||!!wave?.ceilingReached,inletQ:solver.inletQ,outletLevel:solver.outletLevel},running,complete:solver.time>=target},[u.buffer,v.buffer,eta.buffer,depth.buffer]);
}
let lastSnapshot=0;
function batch(){
  timer=null;if(!running)return;
  try{
    const start=performance.now(),until=Math.min(target,Number.isFinite(rate)?timeAnchor+(start-wallAnchor)/1000*rate:target);
    while(solver.time<until-1e-8&&performance.now()-start<40){
      // Ramp only boundary forcing over 30 physical minutes. Interior water is never reset.
      const t=Math.min(1,(solver.time-forcing.time)/1800);
      solver.inletQ=wave?.closed?null:forcing.q+(requested.discharge-forcing.q)*t;
      solver.outletLevel=wave?.closed?null:forcing.level+(requested.baseline+requested.rise-forcing.level)*t;
      const morphologyDt=sediment.prepare();
      const dt=solver.step(Math.min(until-solver.time,morphologyDt));sediment.step(dt);recordWave();
    }
    if(solver.time>=target)running=false;
    if(performance.now()-lastSnapshot>(wave?250:600)||!running){snapshot();lastSnapshot=performance.now();}
    if(running)timer=setTimeout(batch,wave?16:0);
  }catch(error){running=false;self.postMessage({error:error.message});}
}
self.onmessage=({data})=>{
  try{
    if(data.type==='init'){
      clearTimeout(timer);timer=null;wave=null;events=[];rate=Infinity;grid=makeFlowGrid(data.meta,data.seeds,data.parameters,data.dem,data.barriers);
      solver=new ShallowWater2D(grid);sediment=new Sediment2D(solver,data.parameters.sediment);solver.inletQ=0;setForcing(data.parameters);running=data.running!==false;snapshot();batch();
    }else if(data.type==='sediment'&&solver){sediment.configure(data.parameters);requested.sediment={...data.parameters};snapshot();
    }else if(data.type==='wave'&&solver){
      try{
        if(!Array.isArray(data.gauges)||data.gauges.length!==3||data.gauges.some(g=>!Array.isArray(g.coordinates)||g.coordinates.length!==2||!g.coordinates.every(Number.isFinite)))throw Error('Некорректные точки наблюдения');
        const reference=Float64Array.from(solver.h,(h,k)=>solver.bed[k]+h);
        const event={...displaceWater(solver,grid,data.source),closed:!!data.closed,boundaries:{...requested}};events.push(event);
        const gauges=data.gauges.map(g=>{const cell=nearestWetCell(grid,solver,g.coordinates);const [w,s,e,n]=grid.bounds;return {...g,cell,resolvedCoordinates:[w+(cell%grid.width+.5)/grid.width*(e-w),n-(Math.floor(cell/grid.width)+.5)/grid.height*(n-s)],reference:reference[cell],peak:0,arrival:null};});
        wave={event,reference,gauges,closed:!!data.closed,maxDepth:Float64Array.from(solver.h),maxChange:0,lastSample:-Infinity,history:[]};
        rate=[10,30,120].includes(data.rate)?data.rate:30;target=solver.time+600;running=true;anchor();recordWave();snapshot();if(!timer)batch();
      }catch(error){self.postMessage({waveError:error.message});}
    }else if(data.type==='rate'&&solver){if(![10,30,120].includes(data.rate))throw Error('Invalid playback rate');rate=data.rate;anchor();}
    else if(data.type==='parameters'&&solver){setForcing(data.parameters);running=data.running!==false;if(running&&!timer)batch();else snapshot();}
    else if(data.type==='run'&&solver){running=data.running;anchor();if(running&&solver.time>=target)target=solver.time+(wave?600:3600);if(running&&!timer)batch();else snapshot();}
  }catch(error){running=false;self.postMessage({error:error.message});}
};
