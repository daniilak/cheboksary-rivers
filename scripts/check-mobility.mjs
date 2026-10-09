import assert from 'node:assert/strict';
import fs from 'node:fs';
import {adjacency,walkDistances,objectDistance,reachedEdges} from '../dist/mobility-math.js';
// Two physically close sidewalks connected only by a distant explicit crossing.
const graph={nodes:[[0,0],[100,0],[100,10],[0,10],[500,0]],edges:[[0,1,100,0],[1,2,10,0],[2,3,100,0],[0,3,10,1],[1,4,400,128]],stops:[{edge:0,u:.1,offset:2,seeds:[[0,12],[1,92]]}]};
const adj=adjacency(graph);let r=walkDistances(graph,adj,{minutes:10,speed:1.2});
assert.equal(r.dist[3],22,'Mapped stairs used in ordinary walking');
r=walkDistances(graph,adj,{minutes:10,speed:1.2,limited:true});
assert.equal(r.dist[3],Infinity,'Limited budget cannot cross stairs or bridge the missing shortcut');
assert.equal(r.dist[4],Infinity,'Private/blocked edge not traversed');
assert.equal(objectDistance(graph,r,{edge:0,u:.15,offset:3}),10,'Same-edge stop/object distance uses direct edge travel');
assert.equal(objectDistance(graph,r,{edge:3,u:.5,offset:0}),Infinity,'Excluded edge cannot be reached by snapping');
assert.equal(reachedEdges(graph,r).some(v=>v[0]===3||v[0]===4),false);
const longer=walkDistances(graph,adj,{minutes:11,speed:1.2,limited:true});assert.equal(longer.dist[3],202,'Explicit long detour reaches opposite stop');
assert.ok(reachedEdges(graph,r).find(v=>v[0]===2)[2]<1,'Boundary edge is clipped to remaining walk budget');
const json=n=>JSON.parse(fs.readFileSync(new URL('../dist/data/mobility/'+n,import.meta.url)));
const report=json('report.json'),audit=json('audit.json'),network=json('walk-graph.json');
assert.equal(report.days.length,24);assert.equal(report.selection.eligibleDays.length,20);
assert.equal(report.auditSummary.rawRows,audit.days.reduce((n,d)=>n+d.counts.rawRows,0));
assert.equal(report.auditSummary.speedConstant,true);
assert.ok(audit.days.every(d=>d.sha256.length===64));
assert.ok(!report.selection.eligibleDays.includes('2026-09-14'));assert.ok(!report.selection.eligibleDays.includes('2026-10-07'));
assert.equal(audit.days.find(d=>d.date==='2026-10-07').hours[16].coverage,0,'No-data afternoon is not zero transport');
for(const c of report.candidates){assert.ok(c.evidence.length&&c.fieldwork&&c.limit&&c.sources.length);assert.ok(c.lon>=report.bounds[0]&&c.lon<=report.bounds[2]);assert.ok(c.lat>=report.bounds[1]&&c.lat<=report.bounds[3]);assert.ok(Math.abs(c.score-20*Object.entries(report.weights).reduce((n,[k,w])=>n+w*c.ratings[k],0))<.01);}
assert.ok(report.candidates.some(c=>c.type==='transfer'&&c.evidence.some(e=>e.includes('Существующий переход'))),'Existing crossings must be acknowledged');
for(const [a,b,l,f] of network.edges){assert.ok(a>=0&&b>=0&&a<network.nodes.length&&b<network.nodes.length);assert.ok(Number.isFinite(l)&&l>0);assert.ok(Number.isInteger(f));}
const real=walkDistances(network,adjacency(network),{stop:119,minutes:10,speed:4.5});
assert.ok(real.dist.some(Number.isFinite));assert.ok(reachedEdges(network,real).length>0);
assert.ok(fs.statSync(new URL('../dist/data/mobility/report.json',import.meta.url)).size<2_000_000,'Initial vitrine stays below 2 MB');
console.log('PASS: walk detours, barriers, same-edge snapping, bounded catchments, audit coverage, card evidence/ranking, actual OSM graph and small lazy-loaded report.');
