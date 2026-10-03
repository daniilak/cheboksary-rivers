import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import * as THREE from '../dist/vendor/three.module.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const json=n=>JSON.parse(fs.readFileSync(root+'dist/data/'+n));
const buf=fs.readFileSync(root+'dist/data/terrain.bin');
const input={meta:json('terrain.json'),rivers:json('rivers.json'),boundary:json('boundary.json'),heights:new Float32Array(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength))};
let source=fs.readFileSync(root+'dist/app.js','utf8').replace(/^import.*$/gm,'').replace(/start\(\);\s*$/,'');
source+=`\nmeta=input.meta;heights=input.heights;rivers=input.rivers;boundary=input.boundary;const [w,s,e,n]=meta.bounds;lon0=(w+e)/2;lat0=(s+n)/2;world=new THREE.Group();riverGroup=new THREE.Group();world.add(riverGroup);let checks=0;
for(const chosen of [-1,...rivers.map((_,i)=>i)]){state.selected=chosen;state.lab=chosen>=0;state.year=80;buildRivers();for(const t of [-.003,0,1,10000]){time=t;updateParticles();if(!particles.instanceMatrix.array.every(Number.isFinite))throw Error('Non-finite arrow transform');checks++}}
console.log('PASS:',checks,'animation checks, including negative initial timestamp and every river in experiment mode.');`;
vm.runInNewContext(source,{THREE,input,console,Float32Array});
