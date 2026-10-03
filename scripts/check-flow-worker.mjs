import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
// Exercise the actual browser worker message protocol, replacing only its transport.
const url=new URL('../dist/flow-worker.js',import.meta.url).href;
const worker=new Worker(`const {parentPort}=require('node:worker_threads');global.self={postMessage:(v,t)=>parentPort.postMessage(v,t)};import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`,{eval:true});
const queued=[],waiters=[];
worker.on('message',message=>{if(waiters.length)waiters.shift()(message);else queued.push(message);});
worker.on('error',e=>{throw e;});
async function next(){const result=queued.length?queued.shift():await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Worker timed out')),20000);waiters.push(v=>{clearTimeout(timeout);resolve(v);});});if(result.error)throw Error(result.error);return result;}
try{
  await next();
  const width=40,height=20,seeds=new Uint8Array(width*height),dem=new Float32Array(width*height).fill(1.5),barriers=new Uint8Array(width*height);
  for(let y=8;y<12;y++)for(let x=0;x<width;x++){seeds[y*width+x]=1;dem[y*width+x]=1;}
  const meta={width,height,bounds:[47,56,47.01,56.005]},parameters={baseline:1,depth:1,rise:1,discharge:0,manning:.03};
  worker.postMessage({type:'init',meta,seeds,dem,barriers,parameters,running:false});
  const initial=await next();assert.equal(initial.diagnostics.time,0);assert.equal(initial.running,false);
  assert.equal(initial.depth.filter((v,k)=>v>.05&&!initial.river[k]).length,0,'No instantaneous flood from requested stage');
  worker.postMessage({type:'run',running:true});
  let peak;do{peak=await next();}while(!peak.complete);
  assert.equal(peak.diagnostics.time,3600);assert.ok(peak.depth.some((v,k)=>v>.05&&!peak.river[k]));
  worker.postMessage({type:'parameters',parameters:{...parameters,rise:0},running:false});
  const held=await next();assert.equal(held.diagnostics.time,3600);assert.equal(held.running,false);
  assert.deepEqual(held.depth,peak.depth,'Changing forcing must preserve every cell depth');
  assert.equal(held.diagnostics.volume,peak.diagnostics.volume);
  worker.postMessage({type:'run',running:true});
  let recession;do{recession=await next();}while(!recession.complete);
  assert.equal(recession.diagnostics.time,7200);assert.ok(recession.diagnostics.volume<peak.diagnostics.volume);
  assert.ok(recession.diagnostics.relativeBalanceError<1e-10);
  const netChange=recession.diagnostics.volume-peak.diagnostics.volume;
  const exchanged=recession.diagnostics.boundaryVolume-peak.diagnostics.boundaryVolume;
  assert.ok(Math.abs(netChange-exchanged)<1e-5,'Recession must match the integrated boundary exchange');
  console.log('PASS: actual worker starts paused, ramps stage, inundates land, preserves state when forcing changes, resumes without resetting its clock and drains conservatively.');

  const waveMeta={width:160,height:60,bounds:[47,56,47.08,56.03]},waveSeeds=new Uint8Array(9600),waveDem=new Float32Array(9600).fill(1.5);
  for(let y=20;y<40;y++)for(let x=0;x<160;x++){waveSeeds[y*160+x]=1;waveDem[y*160+x]=1;}
  worker.postMessage({type:'init',meta:waveMeta,seeds:waveSeeds,dem:waveDem,barriers:new Uint8Array(9600),parameters:{baseline:1,depth:4,rise:0,discharge:0,manning:.03},running:false});
  const waveInitial=await next();assert.equal(waveInitial.wave,null);
  const source={kind:'radial',amplitude:.5,radius:500,angle:0,lon:47.04,lat:56.015},gauges=[{name:'west',coordinates:[47.02,56.015]},{name:'source',coordinates:[47.04,56.015]},{name:'east',coordinates:[47.06,56.015]}];
  worker.postMessage({type:'wave',source,gauges,closed:true,rate:120});
  let frame=await next();assert.equal(frame.wave.elapsed,0);assert.equal(frame.wave.events.length,1);
  assert.ok(Math.abs(frame.diagnostics.volume-waveInitial.diagnostics.volume)<1e-5);
  do{frame=await next();}while(!frame.complete);
  assert.equal(frame.wave.elapsed,600);assert.equal(frame.diagnostics.inletQ,null);assert.equal(frame.diagnostics.outletLevel,null);
  assert.ok(frame.wave.history.length>50);assert.ok(frame.wave.gauges[1].peak>.4);assert.equal(frame.wave.gauges[1].arrival,0);
  assert.ok(frame.maxDepth.every((h,k)=>h+1e-6>=frame.depth[k]));assert.ok(frame.diagnostics.relativeBalanceError<1e-10);
  worker.postMessage({type:'wave',source:{...source,lon:100},gauges,closed:false,rate:120});
  assert.ok((await next()).waveError);
  worker.postMessage({type:'run',running:false});const afterInvalid=await next();assert.deepEqual(afterInvalid.depth,frame.depth);
  worker.postMessage({type:'wave',source:{...source,kind:'dipole'},gauges,closed:true,rate:120});
  const secondWave=await next();assert.equal(secondWave.wave.events.length,2);assert.equal(secondWave.wave.event.time,600);
  worker.postMessage({type:'run',running:false});let stopped=await next();while(stopped.running)stopped=await next();assert.equal(stopped.running,false);
  console.log('PASS: worker launches and paces waves, records virtual gauges/maxima, closes boundaries, rejects invalid sources without mutation and retains repeated-source history.');
}finally{await worker.terminate();}
