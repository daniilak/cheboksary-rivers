import * as THREE from 'three';
// Allocate only on capacity growth, then reuse CPU and WebGL buffers.
export function fleetBuffers(geometry,count){
 let position=geometry.getAttribute('position'),color=geometry.getAttribute('color');
 if(!position||position.count<count){
  const capacity=Math.max(64,count,position?position.count*2:0);
  if(position)geometry.dispose();
  position=new THREE.BufferAttribute(new Float32Array(capacity*3),3).setUsage(THREE.DynamicDrawUsage);
  color=new THREE.BufferAttribute(new Float32Array(capacity*3),3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position',position);geometry.setAttribute('color',color);
 }
 geometry.setDrawRange(0,count);return {position,color};
}
