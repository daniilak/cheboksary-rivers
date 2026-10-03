import {ShallowWater2D} from './shallow-water.js';
import {makeFlowGrid} from './flow-grid.js';
let grid,solver,target=0,running=false,timer,forcing,requested;
function setForcing(p){
  requested=p;forcing={time:solver.time,q:solver.inletQ,level:solver.outletLevel};
  solver.roughness=p.manning;target=solver.time+3600;
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
  self.postMessage({width:grid.width,height:grid.height,bounds:grid.bounds,dx:grid.dx,dy:grid.dy,mask:grid.mask,river:grid.river,solid:grid.solid,bed:grid.bed,u,v,eta,depth,diagnostics:{...solver.diagnostics(),edgeWet,ceilingReached,inletQ:solver.inletQ,outletLevel:solver.outletLevel},running,complete:solver.time>=target},[u.buffer,v.buffer,eta.buffer,depth.buffer]);
}
let lastSnapshot=0;
function batch(){
  timer=null;if(!running)return;
  try{
    const start=performance.now();
    while(solver.time<target&&performance.now()-start<40){
      // Ramp only boundary forcing over 30 physical minutes. Interior water is never reset.
      const t=Math.min(1,(solver.time-forcing.time)/1800);
      solver.inletQ=forcing.q+(requested.discharge-forcing.q)*t;
      solver.outletLevel=forcing.level+(requested.baseline+requested.rise-forcing.level)*t;
      solver.step(target-solver.time);
    }
    if(solver.time>=target)running=false;
    if(performance.now()-lastSnapshot>600||!running){snapshot();lastSnapshot=performance.now();}
    if(running)timer=setTimeout(batch,0);
  }catch(error){running=false;self.postMessage({error:error.message});}
}
self.onmessage=({data})=>{
  try{
    if(data.type==='init'){
      clearTimeout(timer);grid=makeFlowGrid(data.meta,data.seeds,data.parameters,data.dem,data.barriers);
      solver=new ShallowWater2D(grid);solver.inletQ=0;setForcing(data.parameters);running=data.running!==false;snapshot();batch();
    }else if(data.type==='parameters'&&solver){setForcing(data.parameters);running=data.running!==false;if(running&&!timer)batch();else snapshot();}
    else if(data.type==='run'&&solver){running=data.running;if(running&&solver.time>=target)target=solver.time+3600;if(running&&!timer)batch();else snapshot();}
  }catch(error){running=false;self.postMessage({error:error.message});}
};
