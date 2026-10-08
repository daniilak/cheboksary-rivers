import {analyzeDay} from './transport-math.js';
let day;
self.onmessage=({data})=>{try{if(data.day)day=data.day;if(!day)throw Error('GPS ещё не загружен');const result=analyzeDay(day,data.filter);self.postMessage({id:data.id,result});}catch(error){self.postMessage({id:data.id,error:error.message});}};
