import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ShallowWater2D} from '../dist/shallow-water.js';
import {Sediment2D} from '../dist/sediment.js';
import {makeFlowGrid} from '../dist/flow-grid.js';
import {flowFeatures} from '../dist/flow-observations.js';
const make=({width=30,height=6,dx=10,level=2,open=false,mask=new Uint8Array(width*height).fill(1),bed=new Float64Array(width*height)}={})=>new ShallowWater2D({width,height,dx,dy:dx,level,mask,bed,roughness:.03,inletQ:open?level*height*dx:null,outletLevel:open?level:null});
const options={enabled:true,grainMm:1,grainFraction:.5,supply:1};
const advance=(f,s,seconds)=>{const end=f.time+seconds;while(f.time<end){const limit=s.prepare(),dt=f.step(Math.min(end-f.time,limit));s.step(dt);}};
const budget=s=>{const d=s.snapshot();assert.ok(Math.abs(d.balanceErrorM3)<1e-6*Math.max(1,d.erodedSolidM3+d.depositedSolidM3),`Sediment budget: ${d.balanceErrorM3}`);assert.ok(s.flow.bed.every((z,k)=>z>=s.floor[k]-1e-10));return d;};
// Independent MPM value: Shields=0.1, d=1mm, original coefficients.
const rest=make(),sed=new Sediment2D(rest,options),tau=.1*1650*9.81*.001;
const speed=Math.sqrt(tau*Math.cbrt(2)/(1000*9.81*.03**2*.5));
assert.ok(Math.abs(sed.capacity(2,speed,0,.03).qx-8*Math.sqrt(1.65*9.81*.001**3)*(.1-.047)**1.5)<1e-14);
assert.equal(sed.capacity(2,.01,0,.03).qx,0);assert.equal(sed.capacity(0,100,0,.03).qx,0);
advance(rest,sed,200);assert.ok(rest.bed.every(z=>z===0));assert.ok(rest.diagnostics().relativeBalanceError<1e-12);
assert.throws(()=>sed.configure({...options,grainMm:-1}));
console.log('PASS: independently evaluated MPM, threshold, dry-bed immobility and lake at rest.');
// Uniform equilibrium supply must not erode; supply deficit/surplus changes only inflow bed on first step.
for(const supply of [0,1,2]){
  const f=make({open:true});f.hu.fill(2);const s=new Sediment2D(f,{...options,supply});
  s.prepare();const q=s.capacity(2,1,0,.03).qx;s.step(1);
  assert.ok(Math.abs(f.bed[0]-(supply-1)*q/(.6*f.dx))<1e-12);
  assert.ok(f.bed.every((z,k)=>k%f.width===0||Math.abs(z)<1e-12));budget(s);
}
// Known flux divergence: q_out-q_in, not velocity itself, causes Exner bed change.
const gradient=make({open:true}),gs=new Sediment2D(gradient,options);
for(const k of gradient.active)gradient.hu[k]=2*(.5+(k%gradient.width)/30);
gs.prepare();const k=12,qin=gs.capacity(2,.5+11/30,0,.03).qx,qout=gs.capacity(2,.5+12/30,0,.03).qx;gs.step(2);
assert.ok(Math.abs(gradient.bed[k]+2*(qout-qin)/(.6*10))<1e-12);budget(gs);
console.log('PASS: equilibrium/clear-water/double-supply boundaries and analytic initial Exner divergence.');
// Closed domain, flow reversal and finite-layer exhaustion: paired fluxes must conserve solids.
for(const sign of [1,-1]){
  const f=make();f.hu.fill(sign*20);const s=new Sediment2D(f,options),water=f.volume();s.prepare();s.step(1e5);
  const d=budget(s);assert.equal(d.boundarySolidM3,0);assert.ok(d.erodedSolidM3>0&&d.depositedSolidM3>0);assert.equal(f.volume(),water);assert.ok(d.limitedSteps>0);
}
const walls=new Uint8Array(180).fill(1);for(let y=0;y<6;y++)walls[y*30+15]=0;
const blocked=make({mask:walls});blocked.hu.fill(2);const bs=new Sediment2D(blocked,options);bs.prepare();bs.step(20);
assert.ok(blocked.bed.every((z,k)=>walls[k]||z===0));let west=0,east=0;for(const k of blocked.active)(k%30<15?west+=blocked.bed[k]:east+=blocked.bed[k]);assert.ok(Math.abs(west)<1e-12&&Math.abs(east)<1e-12);budget(bs);
const shelfBed=new Float64Array(180);for(let k=0;k<180;k++)if(k%30>=15)shelfBed[k]=5;
const shelf=make({bed:shelfBed});shelf.hu.fill(2);const ss=new Sediment2D(shelf,options);ss.prepare();ss.step(20);
assert.ok(shelf.bed.every((z,k)=>k%30<15||z===5),'Bed load cannot climb a dry step above the free surface');budget(ss);
console.log('PASS: reverse transport, finite erodible inventory, separate water conservation, impermeable building.');
// Coupling: movable bed must change subsequent hydraulic state, retaining both budgets.
const mobile=make(),fixed=make();for(const k of mobile.active){mobile.h[k]=fixed.h[k]=k%30<10?3:1;}mobile.initialVolume=mobile.volume();fixed.initialVolume=fixed.volume();
const ms=new Sediment2D(mobile,options);advance(mobile,ms,150);while(fixed.time<150)fixed.step(150-fixed.time);
const md=budget(ms);assert.ok(md.maxErosion>1e-7&&md.maxDeposition>1e-7);assert.ok(mobile.h.some((h,k)=>Math.abs(h-fixed.h[k])>1e-7));assert.ok(mobile.diagnostics().relativeBalanceError<1e-11);
const held=mobile.bed.slice();ms.configure({...options,enabled:false});advance(mobile,ms,20);assert.deepEqual(mobile.bed,held);assert.equal(ms.history.length,2);
console.log('PASS: evolving bed feeds back into hydraulic state; closed water/solid budgets; disabling retains bed and history.');
// First-order spatial consistency against analytic derivative of the bed-load flux.
const errors=[];for(const dx of [10,5,2.5]){
  const width=Math.round(300/dx),f=make({width,height:2,dx,open:true}),s=new Sediment2D(f,options);
  const u=x=>.7+x*.001;for(const k of f.active)f.hu[k]=2*u((k%width+.5)*dx);
  s.prepare();s.step(1);let err=0;
  for(let x=2;x<width-2;x++){const p=(x+.5)*dx,eps=.001,derivative=(s.capacity(2,u(p+eps),0,.03).qx-s.capacity(2,u(p-eps),0,.03).qx)/(2*eps);err+=Math.abs(f.bed[x]+derivative/.6);}
  errors.push(err/(width-4));
}assert.ok(errors[1]<errors[0]*.6&&errors[2]<errors[1]*.6);console.log('PASS: refinement reduces analytic Exner derivative error:',errors);
// Real OSM geometry: ordinary and stronger forcing, no morphology time multiplier.
const root=new URL('../dist/data/',import.meta.url),read=n=>fs.readFileSync(new URL(n,root));
const meta=JSON.parse(read('terrain.json')),baseline=JSON.parse(read('hydrology.json')).baseline,raw=read('terrain.bin');
const dem=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4),seeds=read('volga-mask.bin'),barriers=read('building-mask.bin');
for(const [depth,discharge] of [[8,2500],[2,10000]]){
  const grid=makeFlowGrid(meta,seeds,{baseline,depth,discharge,rise:0,manning:.03},dem,barriers),f=new ShallowWater2D(grid),s=new Sediment2D(f,options);
  f.inletQ=0;while(f.time<3600){f.inletQ=discharge*Math.min(1,f.time/1800);const limit=s.prepare(),dt=f.step(Math.min(3600-f.time,limit));s.step(dt);}
  const d=budget(s);assert.ok(f.diagnostics().relativeBalanceError<1e-10);if(discharge===2500){assert.ok(d.maxMobility<1);assert.equal(d.maxErosion,0);}else{assert.ok(d.maxErosion>0);assert.ok(d.maxDeposition>0);}
  if(discharge>2500)assert.ok(f.bed.some((z,k)=>Math.abs(z-grid.bed[k])>1e-8),'Live solver bed must diverge from initial grid');
  const exported=flowFeatures({...grid,bed:f.bed,depth:f.h,eta:Float64Array.from(f.h,(h,k)=>h+f.bed[k]),u:f.hu.map((q,k)=>f.h[k]?q/f.h[k]:0),v:f.hv.map((q,k)=>f.h[k]?q/f.h[k]:0),sediment:d});
  if(discharge>2500)assert.ok(exported.some(x=>Math.abs(x.properties.bedChange)>1e-8));assert.ok(exported.every(x=>Number.isFinite(x.properties.grainShearPa)));
  console.log('PASS: Volga coupled 1h scenario', {depth,discharge,maxErosionMm:d.maxErosion*1000,maxDepositionMm:d.maxDeposition*1000,mobileFraction:d.mobileAreaFraction,solidBudget:d.balanceErrorM3,waterBudget:f.diagnostics().relativeBalanceError});
}
