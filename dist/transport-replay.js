// Lossless replay payload; full observations and stop visits stay in the worker.
// Float64 preserves timestamps, microdegrees and speeds; NaN encodes null.
export function packReplayDay(day){
 const {tracks,...meta}=day,transfer=[];
 const replay={...meta,tracks:tracks.map(({points,visits,...track})=>{
  const pointData=new Float64Array(points.length*5);
  for(let i=0;i<points.length;i++)for(let j=0;j<5;j++)pointData[i*5+j]=points[i][j]??NaN;
  transfer.push(pointData.buffer);return {...track,pointData};
 })};
 return {day:replay,transfer};
}
export function pointCount(track){return track.pointData?track.pointData.length/5:track.points.length;}
export function pointValue(track,index,column){const value=track.pointData?track.pointData[index*5+column]:track.points[index][column];return Number.isNaN(value)?null:value;}
