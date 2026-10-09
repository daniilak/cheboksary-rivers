// Network distances in metres. Pure functions shared with the worker and tests.
export function allowed(flags,limited=false){return !(flags&128)&&(!limited||!(flags&(1|2|4|64|256)));}
class Heap{
 constructor(){this.a=[];}
 push(v){const a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p][0]<=v[0])break;a[i]=a[p];i=p;}a[i]=v;}
 pop(){const a=this.a,out=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1][0]<a[c][0])c++;if(a[c][0]>=v[0])break;a[i]=a[c];i=c;}a[i]=v;}return out;}
 get length(){return this.a.length;}
}
export function adjacency(graph){const adj=Array.from({length:graph.nodes.length},()=>[]);graph.edges.forEach(([a,b,l,f],i)=>{adj[a].push([b,l,f,i]);adj[b].push([a,l,f,i]);});return adj;}
export function walkDistances(graph,adj,{stop=null,minutes=10,speed=4.5,limited=false}={}){
 const budget=minutes*speed*1000/60,dist=new Float64Array(graph.nodes.length).fill(Infinity),heap=new Heap(),starts=new Map();
 const snaps=stop===null?graph.stops:[graph.stops[stop]];
 for(const ss of snaps){if(!ss||!allowed(graph.edges[ss.edge][3],limited))continue;const same=starts.get(ss.edge)||[];same.push(ss);starts.set(ss.edge,same);for(const [n,cost] of ss.seeds)if(cost<=budget&&cost<dist[n]){dist[n]=cost;heap.push([cost,n]);}}
 while(heap.length){const [cost,node]=heap.pop();if(cost!==dist[node])continue;for(const [next,len,flags] of adj[node]){if(!allowed(flags,limited))continue;const c=cost+len;if(c<=budget&&c<dist[next]){dist[next]=c;heap.push([c,next]);}}}
 return {dist,budget,starts,limited};
}
export function objectDistance(graph,result,ss){
 if(!ss||!allowed(graph.edges[ss.edge][3],result.limited))return Infinity;
 const [a,b,l]=graph.edges[ss.edge];let d=ss.offset+Math.min(result.dist[a]+ss.u*l,result.dist[b]+(1-ss.u)*l);
 for(const st of result.starts.get(ss.edge)||[])d=Math.min(d,ss.offset+st.offset+Math.abs(ss.u-st.u)*l);return d;
}
export function reachedEdges(graph,result){
 const ranges=[];
 graph.edges.forEach(([a,b,l,f],i)=>{if(!allowed(f,result.limited))return;const spans=[];
  if(result.dist[a]<=result.budget)spans.push([0,Math.min(1,(result.budget-result.dist[a])/l)]);
  if(result.dist[b]<=result.budget)spans.push([Math.max(0,1-(result.budget-result.dist[b])/l),1]);
  for(const st of result.starts.get(i)||[]){const r=(result.budget-st.offset)/l;if(r>=0)spans.push([Math.max(0,st.u-r),Math.min(1,st.u+r)]);}
  spans.sort((x,y)=>x[0]-y[0]);const merged=[];for(const span of spans){const last=merged.at(-1);if(last&&last[1]>=span[0])last[1]=Math.max(last[1],span[1]);else merged.push([...span]);}
  for(const [from,to] of merged)if(to>from)ranges.push([i,from,to]);
 });return ranges;
}
