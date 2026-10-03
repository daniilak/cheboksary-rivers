// One finite-volume domain for channel and floodplain. Land is initially dry,
// apart from baseline-connected low cells. Synthetic bathymetry is confined to OSM water.
export function makeFlowGrid(meta,seeds,{baseline,depth,rise,discharge,manning,obstacles=true},dem,barriers,factor=2) {
  const size=meta.width*meta.height;
  if(!Number.isInteger(factor)||factor<1||seeds.length!==size||dem?.length!==size||barriers?.length!==size)throw Error('Invalid flow grid inputs');
  if(![baseline,depth,rise,discharge,manning].every(Number.isFinite)||depth<=0||rise<0||rise>6||discharge<0||manning<0)throw Error('Invalid flow scenario');
  const width=Math.ceil(meta.width/factor),height=Math.ceil(meta.height/factor),count=width*height;
  const [w,s,e,n]=meta.bounds,sourceDx=(e-w)/(meta.width-1),sourceDy=(n-s)/(meta.height-1);
  const bounds=[w-sourceDx/2,s-sourceDy/2,e+sourceDx/2,n+sourceDy/2];
  const dx=(bounds[2]-bounds[0])*111320*Math.cos((s+n)*Math.PI/360)/width,dy=(bounds[3]-bounds[1])*111320/height;
  const mask=new Uint8Array(count),river=new Uint8Array(count),solid=new Uint8Array(count),bed=new Float64Array(count),initialDepth=new Float64Array(count);
  const inletMask=new Uint8Array(count),outletMask=new Uint8Array(count);
  // Cells more than 12 m above the reference are dry, impermeable high ground.
  // Report any approach to this truncation in the worker; never silently extend the level range.
  const ceiling=baseline+12;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let water=0,buildings=0,total=0,land=0,z=0;
    for(let j=Math.floor(y*meta.height/height);j<Math.floor((y+1)*meta.height/height);j++)for(let i=Math.floor(x*meta.width/width);i<Math.floor((x+1)*meta.width/width);i++){
      const k=j*meta.width+i;water+=!!seeds[k];buildings+=!!barriers[k];total++;
      if(!seeds[k]){if(!Number.isFinite(dem[k]))throw Error('Missing DEM elevation');z+=dem[k];land++;}
    }
    const k=y*width+x;river[k]=water/total>=.5?1:0;solid[k]=obstacles&&buildings/total>=.5?1:0;
    bed[k]=river[k]?baseline-depth:z/Math.max(1,land);
    mask[k]=!solid[k]&&bed[k]<=ceiling?1:0;
    inletMask[k]=x===0&&river[k]&&mask[k]?1:0;outletMask[k]=x===width-1&&river[k]&&mask[k]?1:0;
  }
  const connected=new Uint8Array(count),queue=new Int32Array(count);let head=0,tail=0;
  for(let k=0;k<count;k++)if(inletMask[k]){connected[k]=1;queue[tail++]=k;}
  while(head<tail){const k=queue[head++],x=k%width,y=Math.floor(k/width);for(const q of [x?k-1:-1,x<width-1?k+1:-1,y?k-width:-1,y<height-1?k+width:-1])if(q>=0&&mask[q]&&bed[q]<baseline&&!connected[q]){connected[q]=1;queue[tail++]=q;}}
  if(!outletMask.some((v,k)=>v&&connected[k]))throw Error('River has no connected outlet');
  for(let k=0;k<count;k++)if(connected[k])initialDepth[k]=baseline-bed[k];
  return {width,height,dx,dy,bed,mask,river,solid,initialDepth,inletMask,outletMask,level:baseline,inletQ:discharge,outletLevel:baseline,roughness:manning,bounds,ceiling};
}
