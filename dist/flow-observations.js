// Diagnostics and export read the same conservative water state that drives the map.
export function sourceToFlow(k,meta,field){
  const x=Math.floor(((k%meta.width)+.5)*field.width/meta.width);
  const y=Math.floor((Math.floor(k/meta.width)+.5)*field.height/meta.height);
  return y*field.width+x;
}
export function observeFlow(field,meta,surfaceMask,buildings){
  const cellArea=field.dx*field.dy;
  let cells=0,cityArea=0,volume=0,maxDepth=0;
  const flood=k=>field.mask[k]&&!field.river[k]&&field.depth[k]>.05;
  for(let k=0;k<field.mask.length;k++)if(flood(k)){cells++;volume+=field.depth[k]*cellArea;maxDepth=Math.max(maxDepth,field.depth[k]);}
  const sourceArea=cellArea*field.mask.length/(meta.width*meta.height);
  for(let k=0;k<surfaceMask.length;k++)if(surfaceMask[k]===1&&flood(sourceToFlow(k,meta,field)))cityArea+=sourceArea;
  const exposure=buildings.map(b=>{
    let depth=0;
    for(const contact of b.contactCells){const k=sourceToFlow(contact,meta,field);if(flood(k))depth=Math.max(depth,field.depth[k]);}
    return {depth,exposed:depth>.05};
  });
  return {exposure,stats:{areaKm2:cells*cellArea/1e6,cityAreaKm2:cityArea/1e6,volumeM3:volume,maxDepth,buildingsNearWater:exposure.filter(v=>v.exposed).length}};
}
export function flowFeatures(field){
  const features=[],[west,south,east,north]=field.bounds,dx=(east-west)/field.width,dy=(north-south)/field.height;
  for(let k=0;k<field.mask.length;k++)if(field.mask[k]&&field.depth[k]>.05){
    const x=west+(k%field.width)*dx,y=north-Math.floor(k/field.width)*dy;
    features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[[[x,y],[x+dx,y],[x+dx,y-dy],[x,y-dy],[x,y]]]},properties:{kind:field.river[k]?'river_cell':'flood_cell',depth:field.depth[k],waterElevation:field.eta[k],uEast:field.u[k],vSouth:field.v[k],speed:Math.hypot(field.u[k],field.v[k])}});
  }
  return features;
}
