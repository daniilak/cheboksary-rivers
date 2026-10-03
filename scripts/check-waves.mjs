import assert from 'node:assert/strict';
import {ShallowWater2D} from '../dist/shallow-water.js';
import {displaceWater} from '../dist/wave-source.js';
const width=100,height=60,size=width*height,mask=new Uint8Array(size).fill(1),bed=new Float64Array(size),grid={width,height,dx:50,dy:50,mask,river:mask,bounds:[0,0,1,1],ceiling:22};
for(const kind of ['radial','dipole','seiche']){
  const model=new ShallowWater2D({...grid,bed,level:8,roughness:0});
  const event=displaceWater(model,grid,{kind,amplitude:2,radius:500,angle:30,lon:.5,lat:.5});
  assert.ok(event.raised>0&&event.lowered<0);assert.ok(Math.abs(event.netVolume)<1e-6);
  assert.ok(Math.abs(model.volume()-model.initialVolume)<1e-5,'Source must rearrange water without changing its volume');
  assert.ok(Math.max(event.raised,-event.lowered)<=2+1e-10);
  assert.ok(model.h.every(h=>h>0));
  const initial=model.h.slice();while(model.time<90)model.step(90-model.time);
  assert.ok(model.h.some((h,k)=>Math.abs(h-initial[k])>.02),'Source must propagate, not stay painted in place');
  assert.ok(model.diagnostics().maxSpeed>.01);assert.ok(model.diagnostics().relativeBalanceError<1e-10);
  console.log('PASS:',kind,'propagates with nonnegative depth and zero source volume',event.scale);
}
const shallow=new ShallowWater2D({...grid,bed,level:.5});
const event=displaceWater(shallow,grid,{kind:'dipole',amplitude:5,radius:500,lon:.5,lat:.5});
assert.ok(event.scale<1);assert.ok(shallow.h.every(h=>h>=.1-1e-12));assert.ok(shallow.diagnostics().relativeBalanceError<1e-10);
const unchanged=shallow.h.slice();assert.throws(()=>displaceWater(shallow,grid,{kind:'radial',amplitude:5,radius:500,lon:2,lat:.5}));assert.deepEqual(shallow.h,unchanged);
console.log('PASS: source clipping preserves mass and depth; invalid source leaves state untouched.');
// Linear long wave: eta=a*exp(-(x-x0)^2/(2 sigma²)), hu=c*eta, c=sqrt(gH).
// Test phase speed before boundaries can affect the pulse.
const w=240,h=3,dx=20,H=8,c=Math.sqrt(9.81*H),x0=1200,sigma=180;
const linear=new ShallowWater2D({width:w,height:h,dx,dy:200,mask:new Uint8Array(w*h).fill(1),bed:new Float64Array(w*h),level:H,roughness:0});
for(const k of linear.active){const eta=.01*Math.exp(-.5*(((k%w+.5)*dx-x0)/sigma)**2);linear.h[k]+=eta;linear.hu[k]=c*eta;}
linear.initialVolume=linear.volume();while(linear.time<90)linear.step(90-linear.time);
let peak=0;for(let x=1;x<w;x++)if(linear.h[w+x]>linear.h[w+peak])peak=x;
const measured=((peak+.5)*dx-x0)/90;
assert.ok(Math.abs(measured-c)/c<.05,`Wave speed ${measured} must match sqrt(gH)=${c} within 5%`);
assert.ok(linear.diagnostics().relativeBalanceError<1e-10);
console.log('PASS: long-wave phase speed',measured,'m/s; sqrt(gH)',c,'m/s.');
const reflect=new ShallowWater2D({width:80,height:3,dx:20,dy:200,mask:new Uint8Array(240).fill(1),bed:new Float64Array(240),level:8,roughness:0});
for(const k of reflect.active){const a=.01*Math.exp(-.5*(((k%80+.5)*20-1100)/100)**2);reflect.h[k]+=a;reflect.hu[k]=c*a;}
reflect.initialVolume=reflect.volume();while(reflect.time<100)reflect.step(100-reflect.time);
let reflectedPeak=0;for(let x=1;x<80;x++)if(reflect.h[80+x]>reflect.h[80+reflectedPeak])reflectedPeak=x;
assert.ok(reflect.hu[80+reflectedPeak]<0,'A reflected wave must reverse momentum at the closed wall');
assert.ok(Math.abs((reflectedPeak+.5)*20-(3200-1100-c*100))<60);
assert.ok(reflect.diagnostics().relativeBalanceError<1e-10);
console.log('PASS: long wave reflects at a closed wall with reversed momentum and conserved volume.');
const shoreBed=new Float64Array(size),shoreMask=mask.slice(),river=new Uint8Array(size);
for(let k=0;k<size;k++){const y=Math.floor(k/width);shoreBed[k]=y<30?0:8.2;river[k]=y<30?1:0;if(y===32&&k%width>=45&&k%width<=55)shoreMask[k]=0;}
const shoreGrid={...grid,mask:shoreMask,river},shore=new ShallowWater2D({...shoreGrid,bed:shoreBed,level:8,roughness:.03});
displaceWater(shore,shoreGrid,{kind:'radial',amplitude:2,radius:500,lon:.5,lat:.6});
let inundated=0;while(shore.time<180){shore.step(180-shore.time);inundated=Math.max(inundated,shore.active.filter(k=>!river[k]&&shore.h[k]>.05).length);}
assert.ok(inundated>0,'A launched wave must run onto the initially dry bank');
assert.ok(shore.h.every((h,k)=>shoreMask[k]||h===0));assert.ok(shore.diagnostics().relativeBalanceError<1e-10);
console.log('PASS: wave run-up wets a dry shore and respects solid obstacles.',{inundated});

// Stress the new sources on the actual mixed wet/dry Volga grid.
const fs=await import('node:fs');const {makeFlowGrid}=await import('../dist/flow-grid.js');
const read=name=>fs.readFileSync(new URL('../dist/data/'+name,import.meta.url));
const meta=JSON.parse(read('terrain.json')),hydro=JSON.parse(read('hydrology.json')),bytes=read('terrain.bin');
const dem=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4),seeds=read('volga-mask.bin'),barriers=read('building-mask.bin');
for(const [kind,depth,amplitude] of [['radial',8,1],['dipole',2,5],['seiche',20,5]]){
  const realGrid=makeFlowGrid(meta,seeds,{baseline:hydro.baseline,depth,rise:0,discharge:0,manning:.03},dem,barriers);
  const real=new ShallowWater2D(realGrid);real.inletQ=null;real.outletLevel=null;
  const [lon,lat]=hydro.sections[42].center;
  displaceWater(real,realGrid,{kind,depth,amplitude,radius:700,angle:0,lon,lat});
  while(real.time<600)real.step(600-real.time);
  assert.ok(real.diagnostics().relativeBalanceError<1e-10);assert.ok(real.h.every(v=>v>=0));assert.ok(real.diagnostics().maxSpeed>0);
  console.log(`PASS: actual Volga ${kind}, depth=${depth}, requested amplitude=${amplitude}, 10 minutes`,real.diagnostics().relativeBalanceError);
}
