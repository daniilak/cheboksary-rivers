// SI units. A connected, equilibrium flood screening model and 1D section diagnostics.
// Neither module infers bathymetry or solves the shallow-water momentum equations.
export function connectedFlood(meta, dem, seeds, barriers, level, useBuildings = true) {
  const {width:w,height:h}=meta, count=w*h;
  if(dem.length!==count||seeds.length!==count||barriers.length!==count||!Number.isFinite(level)) throw Error('Invalid flood inputs');
  const wet=new Uint8Array(count), depth=new Float32Array(count), queue=new Int32Array(count);
  let head=0,tail=0;
  for(let k=0;k<count;k++)if(seeds[k]&&!(useBuildings&&barriers[k])){wet[k]=1;queue[tail++]=k;}
  const visit=k=>{if(wet[k]||(useBuildings&&barriers[k])||!Number.isFinite(dem[k])||dem[k]>=level)return;wet[k]=1;depth[k]=level-dem[k];queue[tail++]=k;};
  while(head<tail){const k=queue[head++],x=k%w;if(x>0)visit(k-1);if(x<w-1)visit(k+1);if(k>=w)visit(k-w);if(k<count-w)visit(k+w);}
  return {wet,depth};
}

export function sectionHydraulics(width, depth, discharge, manning=.03) {
  if(![width,depth,discharge,manning].every(Number.isFinite)||width<=0||depth<=0||discharge<0||manning<=0)throw Error('Invalid hydraulic inputs');
  // Rectangular synthetic section. Continuity is exact; roughness determines required energy slope.
  const area=width*depth, radius=area/(width+2*depth), velocity=discharge/area;
  const frictionSlope=(velocity*manning/radius**(2/3))**2;
  return {area,radius,velocity,frictionSlope,froude:velocity/Math.sqrt(9.81*depth),unitDischarge:discharge/width};
}

export function seasonalScenario(day, peakRise=.3, baseQ=2500, peakQ=10000) {
  if(![day,peakRise,baseQ,peakQ].every(Number.isFinite)||day<0||day>120||peakRise<0||baseQ<0||peakQ<baseQ)throw Error('Invalid seasonal scenario');
  // An illustrative 120-day event, with a 35-day rise and slower recession. Not observations.
  const pulse=day<=35?Math.sin(Math.PI/2*day/35)**2:Math.cos(Math.PI/2*(day-35)/85)**2;
  return {rise:peakRise*pulse,discharge:baseQ+(peakQ-baseQ)*pulse};
}

export function exposedBuildings(buildings, flood) {
  return buildings.map(b=>{
    let depth=0,cell=-1;
    for(const k of b.contactCells)if(flood.wet[k]&&flood.depth[k]>depth){depth=flood.depth[k];cell=k;}
    return {depth,cell,exposed:depth>.05};
  });
}
