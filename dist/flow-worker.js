import {ShallowWater2D} from './shallow-water.js';
import {makeFlowGrid} from './flow-grid.js';
self.onmessage=({data})=>{
  try{
    const grid=makeFlowGrid(data.meta,data.seeds,data.parameters);
    const solver=new ShallowWater2D(grid),target=3600;
    function batch(){
      try{
        const until=Math.min(target,solver.time+300);
        while(solver.time<until)solver.step(until-solver.time);
        const u=new Float32Array(grid.mask.length),v=new Float32Array(grid.mask.length),eta=new Float32Array(grid.mask.length);
        for(const k of solver.active){if(solver.h[k]>1e-6){u[k]=solver.hu[k]/solver.h[k];v[k]=solver.hv[k]/solver.h[k];}eta[k]=solver.bed[k]+solver.h[k];}
        self.postMessage({width:grid.width,height:grid.height,bounds:grid.bounds,dx:grid.dx,dy:grid.dy,mask:grid.mask,u,v,eta,diagnostics:solver.diagnostics(),complete:solver.time>=target},[u.buffer,v.buffer,eta.buffer]);
        if(solver.time<target)setTimeout(batch,0);
      }catch(error){self.postMessage({error:error.message});}
    }
    batch();
  }catch(error){self.postMessage({error:error.message});}
};
