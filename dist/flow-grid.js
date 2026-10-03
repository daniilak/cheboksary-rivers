// The river-only 2D domain is coarser than flood screening, with fixed OSM banks.
// Bathymetry is explicitly synthetic: a flat bed below the reference water surface.
export function makeFlowGrid(meta,seeds,{baseline,depth,rise,discharge,manning},factor=4) {
  if(!Number.isInteger(factor)||factor<1)throw Error('Invalid grid coarsening');
  if(seeds.length!==meta.width*meta.height||![baseline,depth,rise,discharge,manning].every(Number.isFinite)||depth<=0||rise<0||discharge<0||manning<0)throw Error('Invalid flow scenario');
  const width=Math.ceil(meta.width/factor),height=Math.ceil(meta.height/factor);
  const [w,s,e,n]=meta.bounds,sourceDx=(e-w)/(meta.width-1),sourceDy=(n-s)/(meta.height-1);
  const bounds=[w-sourceDx/2,s-sourceDy/2,e+sourceDx/2,n+sourceDy/2];
  const dx=(bounds[2]-bounds[0])*111320*Math.cos((s+n)*Math.PI/360)/width,dy=(bounds[3]-bounds[1])*111320/height;
  const mask=new Uint8Array(width*height),bed=new Float64Array(width*height).fill(baseline-depth);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let water=0,count=0;
    for(let j=Math.floor(y*meta.height/height);j<Math.floor((y+1)*meta.height/height);j++)for(let i=Math.floor(x*meta.width/width);i<Math.floor((x+1)*meta.width/width);i++){water+=seeds[j*meta.width+i]?1:0;count++;}
    mask[y*width+x]=water/count>=.5?1:0;
  }
  // Retain only water connected to the western inlet. Isolated OSM fragments aren't reservoirs with an independent source.
  const connected=new Uint8Array(mask.length),queue=new Int32Array(mask.length);let head=0,tail=0;
  for(let y=0;y<height;y++){const k=y*width;if(mask[k]){connected[k]=1;queue[tail++]=k;}}
  while(head<tail){const k=queue[head++],x=k%width,y=Math.floor(k/width);for(const q of [x? k-1:-1,x<width-1?k+1:-1,y?k-width:-1,y<height-1?k+width:-1])if(q>=0&&mask[q]&&!connected[q]){connected[q]=1;queue[tail++]=q;}}
  if(!Array.from({length:height},(_,y)=>connected[y*width+width-1]).some(Boolean))throw Error('2D river domain has no connected outlet');
  return {width,height,dx,dy,bed,mask:connected,level:baseline+rise,inletQ:discharge,outletLevel:baseline+rise,roughness:manning,bounds};
}
