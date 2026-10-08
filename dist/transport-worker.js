import {analyzeDay} from './transport-math.js?v=performance-3';
import {packReplayDay} from './transport-replay.js';
import {importGPS} from './transport-import.js';
let day,generation=0,controller;
const cache=new Map();
async function load(data){
 generation=data.generation;controller?.abort();const abort=controller=new AbortController();
 try{
  let next=cache.get(data.date);
  if(!next){
   const response=await fetch(data.url,{signal:abort.signal});if(!response.ok)throw Error('GPS: HTTP '+response.status);
   if(data.remote){self.postMessage({type:'progress',generation:data.generation,progress:'Нормализация координат и времени GPS…'});next=importGPS(await response.text(),data.date,data.bounds,data.stops);}
   else next=await response.json();
  }
  if(abort.signal.aborted||data.generation!==generation)return;
  cache.delete(data.date);cache.set(data.date,next);if(cache.size>2)cache.delete(cache.keys().next().value);
  day=next;const packed=packReplayDay(day);
  self.postMessage({type:'loaded',generation,day:packed.day},packed.transfer);
 }catch(error){if(!abort.signal.aborted&&data.generation===generation)self.postMessage({type:'loaded',generation,error:error.message});}
}
self.onmessage=({data})=>{
 if(data.type==='load'){load(data);return;}
 try{
  if(data.day)day=data.day; // Independent numerical test protocol.
  if(data.generation!==undefined&&data.generation!==generation)throw Error('GPS-день уже изменился');
  if(!day)throw Error('GPS ещё не загружен');
  self.postMessage({id:data.id,result:analyzeDay(day,data.filter)});
 }catch(error){self.postMessage({id:data.id,error:error.message});}
};
