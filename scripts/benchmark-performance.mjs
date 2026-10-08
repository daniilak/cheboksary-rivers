// Run locally; timings are measurements, not hardware-dependent CI thresholds.
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {packReplayDay} from '../dist/transport-replay.js';
import {positionsAt} from '../dist/transport-math.js';
const json=fs.readFileSync(new URL('../dist/data/transport/2026-10-01.json',import.meta.url),'utf8');
const day=JSON.parse(json),median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
const sample=fn=>{const times=[];for(let i=0;i<7;i++){const start=performance.now();fn();times.push(performance.now()-start);}return +median(times).toFixed(2);};
const packed=packReplayDay(day).day;
const parsing=sample(()=>JSON.parse(json)),cloning=sample(()=>structuredClone(day));
const transfers=[];for(let i=0;i<7;i++){const payload=packReplayDay(day),start=performance.now();structuredClone(payload.day,{transfer:payload.transfer});transfers.push(performance.now()-start);}
const replay=sample(()=>{for(let i=0;i<600;i++)positionsAt(packed,28800+i);})/600;
console.log(JSON.stringify({date:day.date,points:day.quality.points,jsonParseMs:parsing,nestedCloneMs:cloning,packedTransferMs:+median(transfers).toFixed(2),replayFrameCpuMs:+replay.toFixed(3),workerReplayBytes:day.quality.points*5*8},null,2));
