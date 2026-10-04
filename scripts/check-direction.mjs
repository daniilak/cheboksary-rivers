import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../dist/vendor/three.module.js';
import {flowDirection} from '../dist/flow-observations.js';
import {seasonalScenario} from '../dist/hydrology.js';
const source=fs.readFileSync(new URL('../dist/hydrology-view.js',import.meta.url),'utf8').replace(/^import.*$/gm,'').replace('export class','class').replaceAll('import.meta.url', '"http://localhost/hydrology-view.js"');
const View=vm.runInNewContext(source+';HydrologyView',{THREE});
// Exercise actual arrow geometry + actual advection; a sign error in either fails.
for(const [u,v] of [[1,0],[-1,0],[0,1],[0,-1],[.3,-.4]]){
 const n=25,field={width:5,height:5,bounds:[0,0,5,5],dx:1000,dy:1000,mask:new Uint8Array(n).fill(1),depth:new Float32Array(n).fill(2),eta:new Float32Array(n).fill(10),u:new Float32Array(n).fill(u),v:new Float32Array(n).fill(v)};
 const view={data:{sections:[{chainage:0},{chainage:10}]},group:new THREE.Group(),state:{playing:true},meta:{width:5,height:5,bounds:field.bounds},flowField:field,xy:(lon,lat)=>[lon,-lat],y:z=>z};
 View.prototype.buildFlow.call(view);view.fieldTracers=[{x:2.5,y:2.5,home:12}];view.wetFlowCells=[12];
 View.prototype.animate2D.call(view,1);
 const m=new THREE.Matrix4();view.flow.getMatrixAt(0,m);
 const arrowTip=new THREE.Vector3().fromBufferAttribute(view.flow.geometry.attributes.position,0).transformDirection(m);
 assert.ok(arrowTip.dot(new THREE.Vector3(u,0,v).normalize())>.99999,'Arrowhead must point along computed velocity');
 assert.ok(Math.abs(view.fieldTracers[0].x-2.5-u*.6)<1e-6);
 assert.ok(Math.abs(view.fieldTracers[0].y-2.5-v*.6)<1e-6);
 assert.equal(flowDirection(field).sign,Math.sign(u));
}
const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import.*$/gm,'').replace(/start\(\);\s*$/,'');
const compass=vm.runInNewContext(app+';compassRotation',{THREE});
for(const [x,z] of [[0,1],[1,0],[0,-1],[-1,0],[.4,.9]]){
 const camera=new THREE.PerspectiveCamera(40,1,.01,100);camera.position.set(x,1,z);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const origin=new THREE.Vector3().project(camera),north=new THREE.Vector3(0,0,-.001).project(camera);
 assert.equal((Math.abs(Math.sin(compass(x,z)))<1e-10?0:Math.sign(Math.sin(compass(x,z)))),Math.abs(north.x-origin.x)<1e-10?0:Math.sign(north.x-origin.x));
}
assert.deepEqual(seasonalScenario(35),{rise:0,discharge:10000});
assert.equal(seasonalScenario(35,3).rise,3,'Explicit downstream backwater stays available');
console.log('PASS: actual tracer arrowheads and motion agree in all directions; reverse velocities stay visible; compass north matches camera projection; default flood adds upstream discharge only.');
