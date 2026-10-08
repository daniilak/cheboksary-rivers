import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeDay,positionsAt,moments,haversine} from '../dist/transport-math.js';
import {decodeCoordinates,parseMoscowTime,importGPS,tsvRows} from '../dist/transport-import.js';
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
near(haversine(0,0,1,0),111194.92664455874,1e-5);
assert.deepEqual(decodeCoordinates(81087409,64156218),[47.25,56.125]);
assert.deepEqual(decodeCoordinates(47.25,56.125),[47.25,56.125]);
assert.equal(parseMoscowTime('07.10.2026 08:00:00'),Date.parse('2026-10-07T05:00:00Z')/1000);
assert.deepEqual([...tsvRows('a\tb\r\n"x\ty"\t"z""q"\r\n')],[['a','b'],['x\ty','z"q']]);
const day={start:0,end:600,bounds:[0,-.1,.1,.1],tracks:[{id:'a',route:'1',number:'1',type:'А',points:[[0,0,0,null,90],[60,1000,0,6.7,90],[120,1000,0,0,90],[600,2000,0,null,90]],visits:[]}]};
const full=analyzeDay(day);near(full.vehicleHours,120/3600);near(full.distanceKm,111.19492664455874/1000);near(full.slowShare,.5);assert.equal(full.vehicles,1);assert.equal(full.routes.length,1);assert.equal(full.cells.length,1);near(full.cells[0].load,120/600/.0625);
const clipped=analyzeDay(day,{from:30,to:90});near(clipped.vehicleHours,60/3600);near(clipped.slowShare,.5);near(clipped.distanceKm,full.distanceKm/2);
assert.equal(analyzeDay(day,{route:'absent'}).vehicles,0);assert.equal(analyzeDay(day,{type:'Т'}).vehicleHours,0);
assert.equal(positionsAt(day,-1).length,0);assert.equal(positionsAt(day,121).length,1);assert.equal(positionsAt(day,241).length,0);near(positionsAt(day,30)[0].lon,.0005);near(positionsAt(day,200)[0].lon,.001); // Never interpolate over missing GPS.
assert.equal(positionsAt({...day,tracks:[day.tracks[0],{...day.tracks[0],route:'other'}]},60).length,1);
const m=moments([10,10,10]);near(m.mean,10);near(m.cv,0);near(m.wait,5);near(moments([5,15]).wait,6.25);
const arrivals={...day,end:2400,tracks:[{...day.tracks[0],points:Array.from({length:9},(_,i)=>[i*300,1000,0,null,0]),visits:[[0,0,0],[600,0,0],[1200,0,0],[1800,0,0]]}]};
assert.equal(analyzeDay(arrivals).intervals[0].count,0); // Repeated passages by one vehicle are not headways.
const alternating={...arrivals,tracks:[{...arrivals.tracks[0],visits:[[0,0,0],[1200,0,0]]},{...arrivals.tracks[0],id:'b',visits:[[600,0,0],[1800,0,0]]}]};const interval=analyzeDay(alternating).intervals[0];assert.equal(interval.count,3);near(interval.mean,10);near(interval.wait,5);
const stops=JSON.parse(readFileSync(new URL('../dist/data/transport/stops.json',import.meta.url)));assert.equal(stops.stops.length,722);assert.equal(stops.inMap,557);assert.equal(new Set(stops.stops.map(s=>s.type+':'+s.id)).size,722);
const manifest=JSON.parse(readFileSync(new URL('../dist/data/transport/manifest.json',import.meta.url)));assert.equal(manifest.days.length,7);
for(const info of manifest.days){const d=JSON.parse(readFileSync(new URL('../dist/data/transport/'+info.file,import.meta.url)));let points=0;for(const t of d.tracks){let last=-Infinity;for(const p of t.points){assert.ok(p[0]>last);last=p[0];assert.ok(p[1]/1e6>=d.bounds[0]&&p[1]/1e6<=d.bounds[2]);assert.ok(p[2]/1e6>=d.bounds[1]&&p[2]/1e6<=d.bounds[3]);assert.ok(p[3]===null||(p[3]>=0&&p[3]<=120));points++;}for(const e of t.visits)assert.ok(stops.stops[e[1]].inMap);}assert.equal(points,info.quality.points);const r=analyzeDay(d);assert.equal(r.vehicles,info.quality.vehicles);assert.ok(r.vehicleHours>0&&r.speed>=0&&r.speed<=120&&r.slowShare>=0&&r.slowShare<=1);near(r.routes.reduce((n,x)=>n+x.hours,0),r.vehicleHours,1e-6);near(r.cells.reduce((n,x)=>n+x.seconds/3600,0),r.vehicleHours,1e-6);console.log(info.date,JSON.stringify({vehicles:r.vehicles,hours:r.vehicleHours,speed:r.speed,slow:r.slowShare,peak:r.peak.vehicles,intervals:r.intervals.length}));}
console.log('Transport: numerical statistics, Moscow time, decoding, gaps, filters, headways and 7 daily archives passed.');
