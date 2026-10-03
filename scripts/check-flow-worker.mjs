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
}finally{await worker.terminate();}
