import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {observeFlow,flowFeatures} from '../dist/flow-observations.js';
import {makeFlowGrid} from '../dist/flow-grid.js';
import {connectedFlood,sectionHydraulics,seasonalScenario,exposedBuildings} from '../dist/hydrology.js';
const grid={width:5,height:5};
const dem=new Float32Array([
  0,9,9,9,9,
  0,1,9,1,9,
  0,1,9,1,9,
  0,1,9,1,9,
  0,9,9,9,9,
]);
const seed=new Uint8Array(25);seed[10]=1;const walls=new Uint8Array(25);
let f=connectedFlood(grid,dem,seed,walls,2);
assert.equal(f.wet[11],1);assert.equal(f.depth[11],1);
assert.equal(f.wet[13],0,'Isolated low depression must remain dry');
assert.equal(f.depth[10],0,'DSM is not a measurement of channel depth');
const before=dem.slice();connectedFlood(grid,dem,seed,walls,20);assert.deepEqual(dem,before);
const corridor={width:5,height:1},flat=new Float32Array(5),source=Uint8Array.of(1,0,0,0,0),barrier=Uint8Array.of(0,0,1,0,0);
assert.equal(connectedFlood(corridor,flat,source,barrier,1).wet[4],0,'Impermeable building blocks passage');
assert.equal(connectedFlood(corridor,flat,source,barrier,1,false).wet[4],1,'Disabling building obstruction opens passage');
assert.equal(connectedFlood({width:2,height:2},Float32Array.of(0,3,3,0),Uint8Array.of(1,0,0,0),new Uint8Array(4),1).wet[3],0,'No diagonal leakage');
assert.equal(connectedFlood(corridor,flat,source,new Uint8Array(5),0).wet[4],0,'No positive inundation at zero water depth');
assert.throws(()=>connectedFlood(grid,dem,seed,walls,NaN));
const h=sectionHydraulics(100,5,250,.03);
assert.equal(h.area,500);assert.equal(h.velocity,.5);assert.equal(h.velocity*h.area,250);
assert.equal(sectionHydraulics(100,5,0).velocity,0);
assert.equal(sectionHydraulics(100,5,500).frictionSlope,h.frictionSlope*4);
assert.equal(sectionHydraulics(100,5,250,.06).frictionSlope,h.frictionSlope*4);
assert.ok(sectionHydraulics(100,10,250).velocity<h.velocity);
assert.throws(()=>sectionHydraulics(0,5,100));assert.throws(()=>sectionHydraulics(100,0,100));assert.throws(()=>sectionHydraulics(100,5,-100));
assert.deepEqual(seasonalScenario(0),{rise:0,discharge:2500});assert.deepEqual(seasonalScenario(35),{rise:.3,discharge:10000});
assert.ok(seasonalScenario(120).rise<1e-10);assert.equal(seasonalScenario(35,0).rise,0);
assert.ok(seasonalScenario(20).discharge<seasonalScenario(35).discharge);assert.ok(seasonalScenario(80).discharge<seasonalScenario(35).discharge);
assert.equal(exposedBuildings([{contactCells:[11]},{contactCells:[13]}],f)[0].exposed,true);
assert.equal(exposedBuildings([{contactCells:[11]},{contactCells:[13]}],f)[1].exposed,false);
console.log('PASS: connected inundation, isolation, impermeable obstacles, no diagonal leakage, immutable DEM, continuity, Manning sensitivity, hydrograph and building contact.');

const dir=new URL('../dist/data/',import.meta.url);
const json=name=>JSON.parse(fs.readFileSync(new URL(name,dir)));
const bytes=name=>fs.readFileSync(new URL(name,dir));
const meta=json('terrain.json'),data=json('hydrology.json'),buildings=json('buildings.json'),rivers=json('rivers.json');
const raw=bytes('terrain.bin'),heights=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
const seeds=bytes('volga-mask.bin'),barriers=bytes('building-mask.bin');
assert.equal(buildings.length,data.buildingCount);assert.ok(buildings.length>20000);
assert.equal(buildings.filter(b=>b.resolved).length,data.resolvedBuildingCount);
for(const b of buildings){assert.ok(Number.isFinite(b.baseElevation)&&b.height>0);assert.ok(b.osm.match(/^(way|relation)\/\d+$/));assert.ok(b.contactCells.every(k=>k>=0&&k<heights.length&&!barriers[k]));assert.equal(b.geometry.type,'Polygon');}
assert.ok(data.sections.length>50);assert.equal(seeds.length,heights.length);assert.equal(barriers.length,heights.length);
for(let i=0;i<data.sections.length;i++){const s=data.sections[i];assert.ok(s.width>100&&s.width<15000);if(i)assert.ok(s.chainage>data.sections[i-1].chainage);const v=sectionHydraulics(s.width,8,10000);assert.ok(Math.abs(v.area*v.velocity-10000)<1e-8);}
for(const r of rivers)assert.equal(r.segmentAttributes.length,r.segments.length,'OSM segment attribute alignment');
let previous=null;
for(const rise of [0,.3,3,6]){
  const start=performance.now(),f=connectedFlood(meta,heights,seeds,barriers,data.baseline+rise);
  if(previous)assert.ok(previous.wet.every((v,i)=>!v||f.wet[i]),'Increasing stage must not dry any cell');
  const noWalls=connectedFlood(meta,heights,seeds,barriers,data.baseline+rise,false);
  assert.ok(f.wet.every((v,i)=>!v||noWalls.wet[i]),'Removing barriers must not reduce inundation');
  const exposure=exposedBuildings(buildings,f),count=exposure.filter(v=>v.exposed).length;
  assert.ok(f.depth.every(Number.isFinite));
  console.log(`PASS: real data ΔH=${rise} m: ${f.wet.reduce((a,b)=>a+b,0)} wet cells, ${count} adjacent building contours; ${(performance.now()-start).toFixed(0)} ms.`);
  previous=f;
}
console.log('PASS: actual OSM building topology, raster alignment, river attributes, cross-section continuity and monotone scenarios.');

// Exercise the exact browser exporter without constructing a WebGL scene.
const viewSource=fs.readFileSync(new URL('../dist/hydrology-view.js',import.meta.url),'utf8').replace(/^import.*$/gm,'').replace('export class HydrologyView','class HydrologyView').replaceAll('import.meta.url',JSON.stringify(new URL('../dist/hydrology-view.js',import.meta.url).href));
const View=vm.runInNewContext(viewSource+';HydrologyView',{flowFeatures});
const surfaceMask=bytes('surface-mask.bin');
const grid2d=makeFlowGrid(meta,seeds,{baseline:data.baseline,depth:8,rise:3,discharge:10000,manning:.03},heights,barriers);
const field={...grid2d,depth:Float32Array.from(grid2d.initialDepth),u:new Float32Array(grid2d.mask.length),v:new Float32Array(grid2d.mask.length),eta:Float32Array.from(grid2d.bed,(z,k)=>z+grid2d.initialDepth[k]),diagnostics:{time:0,relativeBalanceError:0}};
const {exposure,stats}=observeFlow(field,meta,surfaceMask,buildings);
const context={meta,buildings,exposure,data,state:{depth:8,rise:3,discharge:10000,manning:.03,obstacles:true},stats,flowField:field};
const exported=JSON.parse(JSON.stringify(View.prototype.createExport.call(context)));
assert.equal(exported.type,'FeatureCollection');assert.equal(exported.metadata.parameters.rise,3);
assert.equal(exported.features.filter(f=>f.properties.kind==='building_contact').length,stats.buildingsNearWater);
const cells=exported.features.filter(f=>f.properties.kind.endsWith('_cell'));
assert.equal(cells.length,field.depth.filter((v,k)=>v>.05&&field.mask[k]).length);
for(const f of exported.features){if(f.geometry.type==='Polygon')for(const ring of f.geometry.coordinates){assert.deepEqual(ring[0],ring.at(-1));assert.ok(ring.flat().every(Number.isFinite));}}
assert.ok(cells.every(f=>f.properties.waterElevation===data.baseline),'Requested rise must not instantly refill the interior');
assert.equal(exported.metadata.flow2d.diagnostics.time,0);
const small={width:2,height:2,bounds:[0,0,2,2],dx:10,dy:10,mask:Uint8Array.of(1,0,1,1),river:Uint8Array.of(1,0,0,0),depth:Float32Array.of(2,0,.5,0),u:Float32Array.of(.1,0,.2,0),v:Float32Array.of(.2,0,-.1,0),eta:Float32Array.of(2,0,.5,0)};
const observations=observeFlow(small,{width:2,height:2},Uint8Array.of(2,1,1,1),[{contactCells:[2]},{contactCells:[3]}]);
assert.equal(observations.stats.areaKm2,.0001);assert.equal(observations.stats.volumeM3,50);assert.equal(observations.stats.buildingsNearWater,1);
assert.equal(observations.exposure[0].depth,.5);assert.equal(observations.exposure[1].exposed,false);
const smallFeatures=flowFeatures(small);assert.equal(smallFeatures.length,2);assert.equal(smallFeatures[1].properties.depth,observations.exposure[0].depth);
assert.equal(smallFeatures[1].properties.vSouth,small.v[2]);
console.log('PASS: map observations and GeoJSON use identical wet cells, depths, vectors, building contacts, elapsed time and boundary budget; requested stage cannot instantly flood the map.');

const aftermath={...small,wave:{elapsed:60,event:{kind:'radial'}},depth:Float32Array.of(2,0,0,0),anomaly:Float32Array.of(0,0,0,0),maxDepth:Float32Array.of(2,0,.5,0)};
const historyFeatures=flowFeatures(aftermath);assert.equal(historyFeatures.length,2);
const dryAfterWave=historyFeatures.find(f=>f.properties.kind==='flood_cell');assert.equal(dryAfterWave.properties.currentlyWet,false);assert.equal(dryAfterWave.properties.maxDepthSinceSource,.5);
console.log('PASS: wave export preserves maximum inundation after the bank dries.');
