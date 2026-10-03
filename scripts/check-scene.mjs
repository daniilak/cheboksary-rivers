import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import * as THREE from '../dist/vendor/three.module.js';
import {TerrainEvolution} from '../dist/erosion.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const json=n=>JSON.parse(fs.readFileSync(root+'dist/data/'+n));
const buf=fs.readFileSync(root+'dist/data/terrain.bin');
const input={meta:json('terrain.json'),rivers:json('rivers.json'),boundary:json('boundary.json'),heights:new Float32Array(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength))};
let source=fs.readFileSync(root+'dist/app.js','utf8').replace(/^import.*$/gm,'').replace(/start\(\);\s*$/,'');
source+=`\nstate.mode='erosion';meta=input.meta;heights=input.heights;rivers=input.rivers;boundary=input.boundary;const [w,s,e,n]=meta.bounds;lon0=(w+e)/2;lat0=(s+n)/2;world=new THREE.Group();riverGroup=new THREE.Group();world.add(riverGroup);let checks=0;
for(const chosen of [-1,...rivers.map((_,i)=>i)]){state.selected=chosen;state.lab=chosen>=0;state.year=80;buildRivers();for(const t of [-.003,0,1,10000]){time=t;updateParticles();if(!particles.instanceMatrix.array.every(Number.isFinite))throw Error('Non-finite arrow transform');checks++}}
console.log('PASS:',checks,'animation checks, including negative initial timestamp and every river in experiment mode.');`;
vm.runInNewContext(source,{THREE,input,console,Float32Array});
let full=fs.readFileSync(root+'dist/app.js','utf8').replace(/^import.*$/gm,'').replace(/start\(\);\s*$/,'');
full+=`\nstate.mode='erosion';meta=input.meta;heights=new Float32Array(input.heights);rivers=input.rivers;boundary=input.boundary;surfaceMask=new Uint8Array(heights.length);evolution=new TerrainEvolution(meta,heights);const [w,s,e,n]=meta.bounds;lon0=(w+e)/2;lat0=(s+n)/2;width=(e-w)*111320*Math.cos(lat0*Math.PI/180)*scale;depth=(n-s)*111320*scale;world=new THREE.Group();baseGroup=new THREE.Group();riverGroup=new THREE.Group();world.add(baseGroup,riverGroup);buildTerrain();state.selected=rivers.findIndex(r=>r.name==='Сугутка');state.year=150;applyEvolution();const first=heights.slice();const stats=evolution.stats();if(stats.cells<100||stats.cut<1||stats.fill<=0)throw Error('Terrain did not erode and deposit');const k=evolution.changed[0];if(Math.abs(terrain.geometry.attributes.position.getY(k)-(heights[k]-meta.min)*scale*12)>1e-5)throw Error('Rendered mesh was not updated');state.year=0;applyEvolution();if(!heights.every((v,i)=>v===input.heights[i]))throw Error('Rewind changed the original DEM');state.year=150;applyEvolution();if(!heights.every((v,i)=>v===first[i]))throw Error('Seeking is not deterministic');state.sed=0;applyEvolution();if(evolution.stats().fill>0)throw Error('Deposited without sediment');console.log('PASS: real mesh deformation, erosion and deposition, exact rewind, deterministic seek, no deposition with sediment=0.',stats);`;
const elements=new Map();const document={getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',dataset:{}});return elements.get(id)}};
vm.runInNewContext(full,{THREE,TerrainEvolution,input,console,Float32Array,Uint8Array,document});
