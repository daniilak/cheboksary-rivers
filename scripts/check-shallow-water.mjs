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
const terrainBytes=fs.readFileSync(new URL('../dist/data/terrain.bin',import.meta.url));
const terrain=new Float32Array(terrainBytes.buffer,terrainBytes.byteOffset,terrainBytes.byteLength/4);
const barriers=fs.readFileSync(new URL('../dist/data/building-mask.bin',import.meta.url));
for(const [depth,rise,discharge] of [[8,0,2500],[8,0,10000],[2,0,20000],[20,6,10000]]){
  const grid=makeFlowGrid(meta,seeds,{baseline,depth,rise,discharge,manning:.03},terrain,barriers);
  const model=new ShallowWater2D(grid),started=performance.now();
  while(model.time<3600){model.outletLevel=baseline+rise*Math.min(1,model.time/1800);model.step(3600-model.time);}
  if(rise===0){for(const fraction of [.25,.5,.75]){const x=Math.floor(grid.width*fraction);let eastwardQ=0;for(let y=0;y<grid.height;y++){const k=y*grid.width+x;if(grid.mask[k])eastwardQ+=model.hu[k]*grid.dy;}assert.ok(eastwardQ>0,`Volga must carry water east at section ${fraction}, Q=${discharge}; got ${eastwardQ}`);}}
  const d=model.diagnostics();assert.ok(d.relativeBalanceError<1e-10);assert.ok(d.minDepth>=0);assert.ok(Number.isFinite(d.maxSpeed));assert.ok(d.maxSpeed>0);
  assert.ok(model.active.some(k=>Math.abs(model.hv[k])>1e-3),'Real curved OSM banks must generate a lateral velocity component');
  console.log(`PASS: 1-hour Volga SWE run, h=${depth}, ΔH=${rise}, Q=${discharge}: ${Math.round(performance.now()-started)} ms`,d);
}

// A channel with dry floodplain, a solid building and an isolated depression.
const W=40,H=20,N=W*H,terrainBed=new Float64Array(N),domain=new Uint8Array(N).fill(1),riverDepth=new Float64Array(N),portIn=new Uint8Array(N),portOut=new Uint8Array(N);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const k=y*W+x;terrainBed[k]=y>=8&&y<12?0:1.5;riverDepth[k]=y>=8&&y<12?1:0;
  if(x===0&&riverDepth[k])portIn[k]=1;if(x===W-1&&riverDepth[k])portOut[k]=1;
  if(x>=15&&x<=18&&y>=4&&y<=6)domain[k]=0;
  // Raised ring encloses a dry low pocket.
  if(x>=25&&x<=29&&y>=1&&y<=5)terrainBed[k]=(x===25||x===29||y===1||y===5)?4:0;
}
const overbank=new ShallowWater2D({width:W,height:H,dx:10,dy:10,bed:terrainBed,mask:domain,initialDepth:riverDepth,level:1,inletMask:portIn,outletMask:portOut,inletQ:0,outletLevel:1,roughness:.03});
for(let i=0;i<100;i++)overbank.step();
assert.ok(overbank.h.every((v,k)=>Math.abs(v-riverDepth[k])<1e-10),'Wet/dry lake at rest must remain balanced');
const started=overbank.time;
while(overbank.time<started+1200){overbank.outletLevel=1+1.5*Math.min(1,(overbank.time-started)/300);overbank.step(started+1200-overbank.time);}
const flooded=k=>terrainBed[k]>=1.5&&domain[k]&&overbank.h[k]>.05;
const peakCells=overbank.active.filter(flooded).length,peakVolume=overbank.volume();
assert.ok(peakCells>300,'Rising stage must push water out of the channel into initially dry land');
assert.ok(overbank.h.every((v,k)=>domain[k]||v===0),'A building must exclude water from its cells');
assert.equal(overbank.h[3*W+27],0,'Disconnected low pocket stays dry until its sill overtops');
assert.ok(overbank.diagnostics().relativeBalanceError<1e-10);
const peakTime=overbank.time;
while(overbank.time<peakTime+1800){overbank.outletLevel=2.5-1.5*Math.min(1,(overbank.time-peakTime)/300);overbank.step(peakTime+1800-overbank.time);}
assert.ok(overbank.volume()<peakVolume,'Falling boundary stage must remove water through the recorded boundary flux');
assert.ok(overbank.active.filter(flooded).length<peakCells,'Falling stage must dry part of the flooded land');
assert.ok(overbank.diagnostics().relativeBalanceError<1e-10);
assert.ok(overbank.h.every(v=>v>=0));
console.log('PASS: wet/dry rest, channel overflow, building exclusion, isolated depression, recession and boundary budget.',{peakCells,remainingCells:overbank.active.filter(flooded).length,balance:overbank.diagnostics().relativeBalanceError});

// Boundary stage applies exclusively to river portals, never every dry edge cell.
const sealed=new ShallowWater2D({width:W,height:H,dx:10,dy:10,bed:terrainBed,mask:domain,initialDepth:new Float64Array(N),level:0,inletMask:new Uint8Array(N),outletMask:new Uint8Array(N),inletQ:100,outletLevel:10});
for(let i=0;i<10;i++)sealed.step();
assert.equal(sealed.volume(),0);assert.equal(sealed.boundaryVolume,0);
console.log('PASS: non-river map edges do not inject water.');
