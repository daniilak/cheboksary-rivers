import assert from 'node:assert/strict';
import {ShallowWater2D} from '../dist/shallow-water.js';
const size=20*12,mask=new Uint8Array(size).fill(1),bed=Float64Array.from({length:size},(_,i)=>1.5*Math.sin((i%20)/4)+.3*Math.cos(Math.floor(i/20)));
const lake=new ShallowWater2D({width:20,height:12,dx:20,dy:25,bed,mask,level:5,roughness:0});
const initial=lake.h.slice();for(let i=0;i<200;i++)lake.step();
assert.ok(lake.h.every((v,i)=>Math.abs(v-initial[i])<1e-10),'Lake at rest must remain at rest over variable bed');
assert.ok(lake.diagnostics().maxSpeed<1e-10);assert.ok(lake.diagnostics().relativeBalanceError<1e-12);
const dam=new ShallowWater2D({width:20,height:12,dx:20,dy:25,bed:new Float64Array(size),mask,level:1,roughness:0});
for(let k=0;k<size;k++)dam.h[k]=k%20<8?5:0;
dam.initialVolume=dam.volume();for(let i=0;i<300;i++)dam.step();
assert.ok(dam.diagnostics().minDepth>=0);assert.ok(dam.diagnostics().relativeBalanceError<1e-12);assert.ok(dam.h[15]>1,'Dam-break wave must wet the downstream region');
// Symmetry about the channel centreline: no spurious lateral flow.
for(let y=0;y<6;y++)for(let x=0;x<20;x++)assert.ok(Math.abs(dam.h[y*20+x]-dam.h[(11-y)*20+x])<1e-9);
const channel=new ShallowWater2D({width:20,height:12,dx:20,dy:25,bed:new Float64Array(size),mask,level:5,inletQ:150,outletLevel:5,roughness:0});
channel.hu.fill(150/(12*25));
for(let i=0;i<100;i++)channel.step();
assert.ok(channel.h.every(v=>Math.abs(v-5)<1e-10));assert.ok(channel.diagnostics().relativeBalanceError<1e-12);
const flow=new ShallowWater2D({width:20,height:12,dx:20,dy:25,bed:new Float64Array(size),mask,level:5,inletQ:150,outletLevel:5,roughness:.03});
for(let i=0;i<500;i++)flow.step();
assert.ok(flow.diagnostics().maxSpeed>0);assert.ok(flow.diagnostics().relativeBalanceError<1e-11);
const wallMask=mask.slice();for(let y=0;y<12;y++)wallMask[y*20+10]=0;
const wall=new ShallowWater2D({width:20,height:12,dx:20,dy:25,bed:new Float64Array(size),mask:wallMask,level:5,roughness:0});
for(let k=0;k<size;k++)if(k%20<10)wall.h[k]=8;wall.initialVolume=wall.volume();
for(let i=0;i<100;i++)wall.step();
assert.ok(wall.h.every((v,k)=>k%20<=10||v===5),'Solid bank must isolate adjacent water bodies');
assert.ok(wall.diagnostics().relativeBalanceError<1e-12);
console.log('PASS: variable-bed lake at rest, dam-break propagation, positivity, closed-domain mass conservation, symmetry, constant throughflow, inlet/outlet water budget and impermeable wall.');
console.log('Open-channel diagnostics:',flow.diagnostics());

const {makeFlowGrid}=await import('../dist/flow-grid.js');
const fs=await import('node:fs');
const meta=JSON.parse(fs.readFileSync(new URL('../dist/data/terrain.json',import.meta.url)));
const seeds=fs.readFileSync(new URL('../dist/data/volga-mask.bin',import.meta.url));
const baseline=JSON.parse(fs.readFileSync(new URL('../dist/data/hydrology.json',import.meta.url))).baseline;
for(const [depth,rise,discharge] of [[8,0,2500],[2,0,20000],[20,6,10000]]){
  const grid=makeFlowGrid(meta,seeds,{baseline,depth,rise,discharge,manning:.03});
  const model=new ShallowWater2D(grid),started=performance.now();
  while(model.time<3600)model.step(3600-model.time);
  const d=model.diagnostics();assert.ok(d.relativeBalanceError<1e-10);assert.ok(d.minDepth>=0);assert.ok(Number.isFinite(d.maxSpeed));assert.ok(d.maxSpeed>0);
  assert.ok(model.active.some(k=>Math.abs(model.hv[k])>1e-3),'Real curved OSM banks must generate a lateral velocity component');
  console.log(`PASS: 1-hour Volga SWE run, h=${depth}, ΔH=${rise}, Q=${discharge}: ${Math.round(performance.now()-started)} ms`,d);
}
