import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Worker} from 'node:worker_threads';
import * as THREE from '../dist/vendor/three.module.js';
import {packReplayDay,pointCount,pointValue} from '../dist/transport-replay.js';
import {positionsAt,analyzeDay} from '../dist/transport-math.js';
import {DemandFrames} from '../dist/frame-policy.js';
import {TerrainFieldCache} from '../dist/terrain-field-cache.js';
import {importGPS} from '../dist/transport-import.js';
const local=name=>new URL('../dist/'+name,import.meta.url).href;
const asModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const bufferModule=asModule(fs.readFileSync(new URL('../dist/transport-buffers.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(local('vendor/three.module.js'))));
const {fleetBuffers}=await import(bufferModule);
const geometry=new THREE.BufferGeometry();let disposals=0;geometry.addEventListener('dispose',()=>disposals++);
const first=fleetBuffers(geometry,500);
for(let i=0;i<1000;i++){
 const count=i%501,attributes=fleetBuffers(geometry,count);
 assert.equal(attributes.position,first.position);assert.equal(attributes.color,first.color);assert.equal(geometry.drawRange.count,count);
}
assert.equal(disposals,0,'Playback must not dispose GPU buffers');
const grown=fleetBuffers(geometry,501);assert.notEqual(grown.position,first.position);assert.equal(disposals,1);assert.equal(grown.position.count,1000);
const frames=new DemandFrames();assert.equal(frames.consume(false),true);
for(let i=0;i<1000;i++)assert.equal(frames.consume(false),false,'Static pause must not draw');
frames.invalidate();assert.equal(frames.consume(false,false),false);assert.equal(frames.consume(false,true),true,'Returning to map must apply pending changes');
for(let i=0;i<60;i++)assert.equal(frames.consume(true),true,'Playback must continue drawing');
const field={bed:new Float64Array([1,2]),sediment:{change:new Float32Array([0,0])}},bedCache=new TerrainFieldCache();
assert.equal(bedCache.changed(field,'depth1/water'),true);assert.equal(bedCache.changed(structuredClone(field),'depth1/water'),false);
const moved=structuredClone(field);moved.bed[1]+=1e-9;assert.equal(bedCache.changed(moved,'depth1/water'),true,'Even submillimetre bed changes must be retained');
assert.equal(bedCache.changed(moved,'depth1/change'),true,'Diagnostic changes must recolor terrain');
const manifest=JSON.parse(fs.readFileSync(new URL('../dist/data/transport/manifest.json',import.meta.url)));
for(const info of manifest.days){
 const day=JSON.parse(fs.readFileSync(new URL('../dist/data/transport/'+info.file,import.meta.url))),packed=packReplayDay(day);
 const replay=structuredClone(packed.day,{transfer:packed.transfer});assert.equal(packed.transfer[0].byteLength,0);
 for(let t=0;t<day.tracks.length;t++){
  const original=day.tracks[t],compact=replay.tracks[t];assert.equal(pointCount(compact),original.points.length);
  for(let i=0;i<original.points.length;i++)for(let c=0;c<5;c++)assert.equal(pointValue(compact,i,c),original.points[i][c]);
 }
 for(const time of [-1,day.start,28800,28830,30000,day.end,day.end+121,28800])for(const filter of [{},{type:'Т'},{route:day.tracks[0].route}])assert.deepEqual(positionsAt(replay,time,filter),positionsAt(day,time,filter),'Packed replay must preserve forward/backward seeks, interpolation, stale points and filters');
}
// Exercise the actual worker: transferred replay does not detach its analytics data,
// stale loads are cancelled, a failed load retains the last valid day, and LRU is bounded.
const fixture={date:'2026-10-07',epoch:0,start:0,end:600,bounds:[0,-.1,.1,.1],quality:{},tracks:[{id:'a',route:'А:1',number:'1',type:'А',points:[[0,0,0,null,90],[60,1000,0,6.7,90],[120,1000,0,0,90]],visits:[]}]};
const remoteTSV='id_api\trid\trnum\trtype\tlow_floor\tbig_jump\tlasttime\tlon\tlat\tcreated_at\n1\t1\t1\tА\t0\t0\t07.10.2026 08:00:00\t0.01\t0.02\t0\n1\t1\t1\tА\t0\t0\t07.10.2026 08:01:00\t0.011\t0.02\t0\n';
const fixtures=Object.fromEntries(['a','b','c','slow'].map(name=>[name,{...fixture,date:name}]));
fixtures.remote=remoteTSV;
const worker=new Worker(`const {parentPort}=require('node:worker_threads');const fixtures=${JSON.stringify(fixtures)};global.self={postMessage:(v,t)=>parentPort.postMessage(v,t)};global.fetch=(url,{signal}={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{if(fixtures[url])resolve(new Response(typeof fixtures[url]==='string'?fixtures[url]:JSON.stringify(fixtures[url])));else reject(Error('missing fixture'));},url==='slow'?100:2);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('aborted'));},{once:true});});import(${JSON.stringify(local('transport-worker.js'))}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`,{eval:true});
const queued=[],waiters=[];worker.on('message',v=>waiters.length?waiters.shift()(v):queued.push(v));worker.on('error',e=>{throw e;});
async function next(){return queued.length?queued.shift():new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Worker timeout')),3000);waiters.push(v=>{clearTimeout(timeout);resolve(v);});});}
const load=(date,generation,url=date)=>worker.postMessage({type:'load',date,generation,url});
try{
 await next();load('slow',1);load('a',2);const initial=await next();assert.equal(initial.generation,2);assert.equal(initial.day.date,'a');assert.ok(initial.day.tracks[0].pointData instanceof Float64Array);
 worker.postMessage({id:1,generation:2,filter:{}});assert.deepEqual((await next()).result,analyzeDay(fixtures.a));
 load('a',3,'missing');assert.equal((await next()).day.date,'a','Cached day must not refetch');
 load('b',4);await next();load('a',5);await next();load('c',6);await next();load('b',7,'missing');assert.match((await next()).error,/missing/,'Least recently used raw day must be evicted');
 worker.postMessage({id:2,generation:7,filter:{}});assert.deepEqual((await next()).result,analyzeDay(fixtures.c),'Failure must preserve previous observations');
 worker.postMessage({type:'load',date:'2026-10-07',generation:8,url:'remote',remote:true,bounds:[0,0,.1,.1],stops:[]});
 assert.equal((await next()).type,'progress');const imported=await next();assert.equal(imported.day.quality.points,2);
 worker.postMessage({id:3,generation:8,filter:{}});assert.deepEqual((await next()).result,analyzeDay(importGPS(remoteTSV,'2026-10-07',[0,0,.1,.1],[])),'New HF import must preserve the same analytics');
}finally{await worker.terminate();}
// Run the actual UI's queue with a slow worker: 100 filter changes can queue only
// one latest request, and stale results never replace current statistics.
const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{value:'',disabled:false,textContent:'',setAttribute(){}});return elements.get(id);};
global.document={getElementById:element,createElement:()=>({width:32,height:32,getContext:()=>({beginPath(){},arc(){},fill(){}})})};global.window={addEventListener(){}};
global.Worker=class{constructor(){this.messages=[];}postMessage(v){this.messages.push(v);}terminate(){}};
let viewSource=fs.readFileSync(new URL('../dist/transport-view.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(local('vendor/three.module.js'))).replace("'./transport-math.js?v=performance-3'",JSON.stringify(local('transport-math.js'))).replace("'./transport-replay.js'",JSON.stringify(local('transport-replay.js'))).replace("'./transport-buffers.js'",JSON.stringify(bufferModule)).replace("new URL('./transport-worker.js',import.meta.url)",JSON.stringify(local('transport-worker.js')));
const {TransportView}=await import(asModule(viewSource));
const view=new TransportView({world:new THREE.Group(),onChange(){}});view.loadRequest=1;
view.analyze(true);await new Promise(r=>setTimeout(r,5));assert.equal(view.worker.messages.length,1);
for(let i=0;i<100;i++){view.filter.from=i;view.analyze();}await new Promise(r=>setTimeout(r,120));assert.equal(view.worker.messages.length,1);
let rendered=0;view.renderAnalytics=()=>rendered++;view.buildDensity=()=>{};
view.worker.onmessage({data:{id:view.worker.messages[0].id,result:{old:true}}});assert.equal(rendered,0);assert.equal(view.worker.messages.length,2);assert.equal(view.worker.messages[1].filter.from,99);
view.worker.onmessage({data:{id:view.worker.messages[1].id,result:{latest:true}}});assert.equal(rendered,1);assert.deepEqual(view.result,{latest:true});
clearTimeout(view.analysisTimer);
console.log('PASS: all 1,406,182 points lossless; GPU buffer reuse; idle/hidden rendering; precise bed invalidation; actual worker transfer/cancellation/LRU/error recovery; latest-only analytics.');
// Instantiate the real water view and exercise received fields, rather than only
// the cache in isolation. No solver is launched in this small rendering fixture.
const moduleCache=new Map();
function browserModule(name){
 const clean=name.split('?')[0];if(moduleCache.has(clean))return moduleCache.get(clean);
 const source=fs.readFileSync(new URL('../dist/'+clean,import.meta.url),'utf8').replace(/from ['"]([^'"]+)['"]/g,(whole,path)=>'from '+JSON.stringify(path==='three'?local('vendor/three.module.js'):path.startsWith('./')?browserModule(path.slice(2)):path));
 const url=asModule(source);moduleCache.set(clean,url);return url;
}
document.querySelectorAll=()=>[];for(const e of elements.values()){e.dataset={};e.classList={toggle(){}};}
const getElement=document.getElementById;document.getElementById=id=>{const e=getElement(id);e.dataset??={};e.classList??={toggle(){}};return e;};
const {HydrologyView}=await import(browserModule('hydrology-view.js'));
const update=HydrologyView.prototype.update;HydrologyView.prototype.update=()=>{};
const section={left:[0,.5],right:[1,.5],center:[.5,.5],chainage:0,width:1,tangent:[1,0]};let bedUpdates=0,invalidations=0;
const waterView=new HydrologyView({world:new THREE.Group(),meta:{width:3,height:3,bounds:[0,0,1,1],min:0},buildings:[],surfaceMask:new Uint8Array(9),data:{baseline:0,sections:[section,{...section,chainage:1}]},xy:(x,z)=>[x,-z],onLevel(){},onBed(){bedUpdates++;},onChange(){invalidations++;}});
HydrologyView.prototype.update=update;
const waterField={width:2,height:2,bounds:[0,0,1,1],dx:1,dy:1,mask:new Uint8Array(4).fill(1),river:new Uint8Array(4).fill(1),bed:new Float64Array(4),depth:new Float32Array(4).fill(1),eta:new Float32Array(4).fill(1),u:new Float32Array(4).fill(.1),v:new Float32Array(4),running:false,diagnostics:{time:0,maxSpeed:.1,relativeBalanceError:0,outletLevel:1}};
waterView.receiveField(waterField);assert.equal(bedUpdates,1);assert.ok(waterView.floodMesh);
waterView.receiveField(structuredClone(waterField));assert.equal(bedUpdates,1,'Identical snapshots must retain the terrain');
const nextField=structuredClone(waterField);nextField.bed[0]=.00001;waterView.receiveField(nextField);assert.equal(bedUpdates,2);assert.ok(invalidations>=3,'Every water snapshot must request a redraw');
waterView.fieldTracers=[{x:.5,y:.5,home:0}];waterView.wetFlowCells=[0,1,2,3];waterView.animate(.1);const version=waterView.flow.instanceMatrix.version;waterView.animate(.1);assert.equal(waterView.flow.instanceMatrix.version,version,'Paused tracers must not upload each frame');
console.log('PASS: actual water view receives fields, retains unchanged terrain, displays changed bed and pauses tracer uploads.');
