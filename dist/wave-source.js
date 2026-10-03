// Idealized instantaneous water displacement, not an earthquake/landslide source model.
// The positive and negative lobes exchange volume; no water is manufactured.
export function displaceWater(solver,grid,source){
  const {kind,amplitude,radius,angle=0,lon,lat}=source;
  if(!['radial','dipole','seiche'].includes(kind)||![amplitude,radius,angle,lon,lat].every(Number.isFinite)||amplitude<=0||amplitude>5||radius<300||radius>2000)throw Error('Некорректные параметры источника');
  const [west,south,east,north]=grid.bounds;
  const cx=(lon-west)/(east-west)*grid.width,cy=(north-lat)/(north-south)*grid.height;
  const center=Math.floor(cy)*grid.width+Math.floor(cx);
  if(cx<0||cx>=grid.width||cy<0||cy>=grid.height||!grid.river[center]||!grid.mask[center]||solver.h[center]<.1)throw Error('Выберите источник в смоченном русле Волги');
  const profile=new Float64Array(grid.mask.length),theta=angle*Math.PI/180;
  let positive=0,negative=0,maxPositive=0;
  const length=Math.hypot(grid.width*grid.dx*Math.cos(theta),grid.height*grid.dy*Math.sin(theta));
  for(const k of solver.active){
    if(!grid.river[k]||solver.h[k]<.1)continue;
    const x=(k%grid.width+.5-cx)*grid.dx,y=(Math.floor(k/grid.width)+.5-cy)*grid.dy;
    const along=x*Math.cos(theta)+y*Math.sin(theta),r2=(x*x+y*y)/(radius*radius);
    let value=0;
    if(kind==='seiche')value=Math.cos(Math.PI*((k%grid.width+.5)*grid.dx*Math.cos(theta)+(Math.floor(k/grid.width)+.5)*grid.dy*Math.sin(theta))/Math.max(1,length));
    else if(r2<=9)value=(kind==='radial'?1-r2/2:along/radius)*Math.exp(-r2/2)*(1-r2/9)**2;
    profile[k]=value;
  }
  // Basin tilt uses the whole wet river; subtract its discrete mean before normalization.
  if(kind==='seiche'){
    let mean=0,n=0;for(const k of solver.active)if(grid.river[k]&&solver.h[k]>=.1){mean+=profile[k];n++;}
    for(const k of solver.active)if(grid.river[k]&&solver.h[k]>=.1)profile[k]-=mean/n;
  }
  for(const value of profile){if(value>0){positive+=value;maxPositive=Math.max(maxPositive,value);}else negative-=value;}
  if(positive<=1e-8||negative<=1e-8)throw Error('Источник не помещается в воду: уменьшите размер или перенесите центр');
  let maxAbs=0;
  for(const k of solver.active){profile[k]=profile[k]>0?profile[k]/maxPositive:profile[k]*positive/(negative*maxPositive);maxAbs=Math.max(maxAbs,Math.abs(profile[k]));}
  let scale=1;
  for(const k of solver.active){
    profile[k]/=maxAbs;
    const change=amplitude*profile[k];
    if(change<0)scale=Math.min(scale,.8*solver.h[k]/-change);
    if(change>0)scale=Math.min(scale,Math.max(0,grid.ceiling-.5-solver.bed[k]-solver.h[k])/change);
  }
  if(scale<.001)throw Error('Недостаточно глубины или запаса расчётной области для такой волны');
  let raised=0,lowered=0,displaced=0,net=0,energy=0;
  for(const k of solver.active){
    const change=amplitude*scale*profile[k];if(!change)continue;
    const old=solver.h[k],next=old+change;
    solver.h[k]=next;solver.hu[k]*=next/old;solver.hv[k]*=next/old;
    raised=Math.max(raised,change);lowered=Math.min(lowered,change);
    net+=change*grid.dx*grid.dy;if(change>0)displaced+=change*grid.dx*grid.dy;
    energy+=.5*1000*9.81*change*change*grid.dx*grid.dy;
  }
  return {...source,angle,time:solver.time,scale,raised,lowered,displacedVolume:displaced,netVolume:net,potentialEnergyEstimate:energy,centerCell:center};
}

export function nearestWetCell(grid,solver,[lon,lat]){
  const [w,s,e,n]=grid.bounds,x=(lon-w)/(e-w)*grid.width,y=(n-lat)/(n-s)*grid.height;
  let best=-1,distance=Infinity;
  for(const k of solver.active)if(grid.river[k]&&solver.h[k]>.1){const d=((k%grid.width+.5-x)*grid.dx)**2+((Math.floor(k/grid.width)+.5-y)*grid.dy)**2;if(d<distance){best=k;distance=d;}}
  return best;
}
