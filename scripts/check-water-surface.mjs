import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';

const source=fs.readFileSync(new URL('../dist/water-surface.js',import.meta.url),'utf8')
  .replace("'three'",JSON.stringify(new URL('../dist/vendor/three.module.js',import.meta.url).href));
const {waterGeometry,WaterSurface}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const field={width:3,height:2,bounds:[0,0,3,2],mask:new Uint8Array([1,1,0,1,1,1]),
  depth:new Float32Array([2,4,0,.02,3,1]),eta:new Float32Array([10,12,0,9,11,10]),
  u:new Float32Array([1,2,0,0,-1,-2]),v:new Float32Array([0,-2,0,0,1,2])};
const before=structuredClone(field),xy=(x,z)=>[x,-z],elevation=z=>z;
const tint=k=>new THREE.Color(k/8,.3,.4);
const data=waterGeometry(field,xy,elevation,tint);
assert.deepEqual(data.cells,[0,1,4,5]);
assert.equal(data.positions.length,4*6*3);
for(const array of [data.positions,data.colors,data.depths,data.velocities])assert.ok(array.every(Number.isFinite));
assert.deepEqual(field,before,'Rendering must not mutate hydraulic state');
const corners=new Map();
for(let i=0;i<data.positions.length;i+=3){
  const key=[data.positions[i],data.positions[i+2]].join('/');
  if(corners.has(key))assert.equal(data.positions[i+1],corners.get(key),'Crack at shared water corner');
  corners.set(key,data.positions[i+1]);
}
assert.ok(Math.abs(corners.get('1/-1')-11.0002)<1e-6,'Only wet cells contribute to shared heights');
for(let i=0;i<data.cells.length;i++)for(let j=0;j<6;j++){
  assert.ok(Math.abs(data.colors[(i*6+j)*3]-tint(data.cells[i]).r)<1e-7,'Diagnostic color must stay per cell');
}
const group=new THREE.Group(),water=new WaterSurface(group);
const mesh=water.update(field,xy,elevation,tint,false),positions=mesh.geometry.getAttribute('position');
water.update({...field,eta:Float32Array.from(field.eta,x=>x+1)},xy,elevation,tint,true);
assert.equal(water.mesh,mesh);assert.equal(mesh.geometry.getAttribute('position'),positions);
assert.deepEqual(mesh.userData.cells,data.cells,'Picking must still map two triangles to each solver cell');
water.animate(.5,true);assert.equal(water.time,.5);water.animate(2,false);assert.equal(water.time,.5,'Pause must stop optical animation');
let target=null;const passes=[];
const renderer={getDrawingBufferSize:out=>out.set(640,360),getRenderTarget:()=>target,
  setRenderTarget:value=>target=value,render:()=>passes.push({visible:mesh.visible,target})};
const camera=new THREE.PerspectiveCamera(36,640/360,.02,180);
water.render(renderer,{},camera);assert.equal(passes.length,1,'Diagnostics should not require refraction pass');
passes.length=0;water.update(field,xy,elevation,tint,false);water.render(renderer,{},camera);
assert.equal(passes.length,2);assert.equal(passes[0].visible,false);assert.equal(passes[1].visible,true);
assert.equal(target,null);assert.equal(water.material.uniforms.uResolution.value.x,640);
passes.length=0;renderer.render=()=>{throw Error('render failed');};
assert.throws(()=>water.render(renderer,{},camera));assert.equal(mesh.visible,true);assert.equal(target,null);
water.reset();assert.equal(group.children.length,0);assert.equal(water.mesh,null);assert.equal(water.time,0);
water.update({...field,depth:new Float32Array(6)},xy,elevation,tint,false);
assert.equal(water.mesh.geometry.getAttribute('position').count,0,'Dry grid should have no water geometry');
console.log('PASS: continuous wet surface, dry-cell exclusion, exact diagnostic colors, immutable solver, picking, buffer reuse, pause and refraction-pass restoration.');
