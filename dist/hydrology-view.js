import * as THREE from 'three';
import {connectedFlood, sectionHydraulics, seasonalScenario, exposedBuildings} from './hydrology.js';
const $=id=>document.getElementById(id);
const local=n=>n.toLocaleString('ru-RU',{maximumFractionDigits:2});

export class HydrologyView {
  constructor({world,meta,dem,seeds,barriers,surfaceMask,buildings,data,xy,onLevel,onFocus}) {
    Object.assign(this,{world,meta,dem,seeds,barriers,surfaceMask,buildings,data,xy,onLevel,onFocus});
    this.state={rise:0,discharge:2500,depth:8,manning:.03,day:0,peak:.3,obstacles:true,playing:false,mode:'manual'};
    this.group=new THREE.Group();world.add(this.group);this.use2D=true;this.flowField=null;this.flowKey=null;
    this.ranges=[];this.clock=0;this.selectedSection=40;this.selectedBuilding=-1;
    const [w,s,e,n]=meta.bounds;
    this.cellX=(e-w)*111320*Math.cos((s+n)*Math.PI/360)/(meta.width-1);
    this.cellY=(n-s)*111320/(meta.height-1);this.cellArea=this.cellX*this.cellY;
    this.buildBuildings();this.buildSections();this.buildFlow();this.bind();this.update();
  }
  y(z){return (z-this.meta.min)*.012;}
  buildBuildings(){
    const positions=[],ranges=[];
    for(const b of this.buildings){
      const begin=positions.length/3;
      const rings=b.geometry.coordinates.map(r=>r.slice(0,-1).map(p=>{const [x,z]=this.xy(...p);return new THREE.Vector2(x,z);}));
      const low=this.y(b.baseElevation)+.012,high=low+b.height*.012;
      const push=(p,y)=>positions.push(p.x,y,p.y);
      const all=rings.flat();
      for(const tri of THREE.ShapeUtils.triangulateShape(rings[0],rings.slice(1))) for(const i of tri)push(all[i],high);
      for(const ring of rings)for(let i=0;i<ring.length;i++){
        const a=ring[i],c=ring[(i+1)%ring.length];
        push(a,low);push(c,low);push(c,high);push(a,low);push(c,high);push(a,high);
      }
      ranges.push([begin,positions.length/3]);
    }
    this.ranges=ranges;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new THREE.BufferAttribute(new Float32Array(positions.length),3));geometry.computeVertexNormals();
    this.buildingMesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,side:THREE.DoubleSide}));
    this.group.add(this.buildingMesh);
    $('buildingCount').textContent=local(this.buildings.length);
    $('buildingResolution').textContent=`${local(this.data.resolvedBuildingCount)} контуров различимы сеткой ~30 м`;
  }
  buildSections(){
    const p=[];
    for(const s of this.data.sections){for(const c of [s.left,s.right]){const [x,z]=this.xy(...c);p.push(x,this.y(this.data.baseline)+.05,z);}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    this.sectionLines=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xe1b55b,transparent:true,opacity:.5,depthTest:false}));
    this.sectionLines.visible=false;this.group.add(this.sectionLines);
    $('section').max=this.data.sections.length-1;
    this.selectedSection=Math.floor(this.data.sections.length/2);$('section').value=this.selectedSection;
  }
  buildFlow(){
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,-1,-.42,0,.5,0,0,.15,.42,0,.5],3));geo.setIndex([0,1,2,0,2,3]);
    this.flow=new THREE.InstancedMesh(geo,new THREE.MeshBasicMaterial({color:0xdbfbf4,side:THREE.DoubleSide,transparent:true,opacity:.9,depthTest:false}),240);
    this.flow.frustumCulled=false;this.flow.renderOrder=4;this.group.add(this.flow);
    this.dummy=new THREE.Object3D();
    this.tracers=Array.from({length:240},(_,i)=>({chainage:this.data.sections[0].chainage+(this.data.sections.at(-1).chainage-this.data.sections[0].chainage)*(i/240),lane:.15+((i*0.61803398875)%1)*.7}));
  }
  bind(){
    for(const [id,key] of [['stage','rise'],['discharge','discharge'],['assumedDepth','depth'],['roughness','manning']])$(id).oninput=e=>{
      this.state[key]=Number(e.target.value);
      if(key==='rise'||key==='discharge'){this.state.mode='manual';this.state.playing=false;this.state.day=0;}
      this.update();
    };
    $('peakRise').oninput=e=>{this.state.peak=Number(e.target.value);this.applyDay(this.state.day);};
    $('seasonDay').oninput=e=>{this.state.playing=false;this.applyDay(Number(e.target.value));};
    $('seasonPlay').onclick=()=>this.toggleSeason();
    for(const button of document.querySelectorAll('[data-scenario]'))button.onclick=()=>{
      this.state.playing=false;
      if(button.dataset.scenario==='base'){this.state.mode='manual';this.state.rise=0;this.state.discharge=2500;this.state.day=0;this.update();}
      if(button.dataset.scenario==='spring'){this.state.peak=.3;this.applyDay(35);}
      if(button.dataset.scenario==='extreme'){this.state.mode='manual';this.state.day=0;this.state.rise=3;this.state.discharge=10000;this.update();}
    };
    $('showBuildings').onchange=e=>{this.buildingMesh.visible=e.target.checked;};
    $('useBuildings').onchange=e=>{this.state.obstacles=e.target.checked;this.update();};
    $('showSections').onchange=e=>{this.sectionLines.visible=e.target.checked;};
    $('use2D').onchange=e=>{this.use2D=e.target.checked;this.flowKey=null;this.queue2D();};
    $('recomputeFlow').onclick=()=>{this.flowKey=null;this.queue2D();};
    $('section').oninput=e=>{this.selectedSection=Number(e.target.value);this.drawSection();};
    $('exportScenario').onclick=()=>this.export();
    $('focusBuildings').onclick=()=>{
      let index=this.exposure.findIndex(v=>v.exposed);
      if(index<0){let best=Infinity;for(let i=0;i<this.buildings.length;i++){const b=this.buildings[i];if(b.baseElevation<best&&b.area>80){best=b.baseElevation;index=i;}}}
      if(index>=0){this.inspectBuilding(index);this.onFocus(this.buildings[index]);}
    };
  }
  toggleSeason(){if(this.state.day>=120)this.applyDay(0);this.state.mode='season';this.state.playing=!this.state.playing;this.flowKey=null;this.queue2D();this.sync();}
  applyDay(day){this.state.day=day;this.state.mode='season';Object.assign(this.state,seasonalScenario(day,this.state.peak));this.update();}
  sync(){
    const s=this.state;
    for(const [id,key] of [['stage','rise'],['discharge','discharge'],['assumedDepth','depth'],['roughness','manning'],['seasonDay','day'],['peakRise','peak']])$(id).value=s[key];
    $('stageValue').textContent=`+${s.rise.toFixed(2)} м`;$('dischargeValue').textContent=`${Math.round(s.discharge).toLocaleString('ru-RU')} м³/с`;
    $('depthValue').textContent=s.depth.toFixed(1)+' м';$('roughnessValue').textContent=s.manning.toFixed(3);
    $('dayValue').textContent=`${Math.round(s.day)} / 120`;$('peakValue').textContent=s.peak.toFixed(1)+' м';
    $('seasonPlay').textContent=s.playing?'Ⅱ':'▶';$('seasonPlay').setAttribute('aria-label',s.playing?'Приостановить половодье':'Проиграть половодье');
    $('hydroMode').textContent=s.mode==='season'?'СЕЗОННЫЙ СЦЕНАРИЙ · НЕ НАБЛЮДЕНИЯ':'ЗАДАННЫЕ УРОВЕНЬ И РАСХОД';
    $('waterDatum').textContent=`${(this.data.baseline+s.rise).toFixed(2)} м EGM2008 · ноль сценария ${this.data.baseline.toFixed(2)} м по DSM`;
    for(const b of document.querySelectorAll('[data-scenario]'))b.classList.toggle('active',b.dataset.scenario==='spring'?s.mode==='season':s.mode==='manual'&&(b.dataset.scenario==='base'?s.rise===0:s.rise===3));
  }
  update(){
    this.sync();const level=this.data.baseline+this.state.rise;
    this.flood=connectedFlood(this.meta,this.dem,this.seeds,this.barriers,level,this.state.obstacles);
    this.exposure=exposedBuildings(this.buildings,this.flood);
    let cells=0,cityCells=0,volume=0,maxDepth=0;
    const positions=[],colors=[],{width:w,height:h,bounds:[west,south,east,north]}=this.meta;
    const a=new THREE.Color('#83c9cd'),b=new THREE.Color('#08788f');
    for(let k=0;k<this.dem.length;k++){
      if(!this.flood.wet[k]||this.seeds[k]||this.surfaceMask[k]===2||this.flood.depth[k]<=0)continue;
      cells++;if(this.surfaceMask[k]===1)cityCells++;volume+=this.flood.depth[k]*this.cellArea;maxDepth=Math.max(maxDepth,this.flood.depth[k]);
      const row=Math.floor(k/w),col=k%w,[x,z]=this.xy(west+col/(w-1)*(east-west),north-row/(h-1)*(north-south));
      const hx=this.cellX*.0005,hz=this.cellY*.0005,y=this.y(level)+.025;
      positions.push(x-hx,y,z-hz,x+hx,y,z-hz,x+hx,y,z+hz,x-hx,y,z-hz,x+hx,y,z+hz,x-hx,y,z+hz);
      const color=a.clone().lerp(b,Math.min(1,this.flood.depth[k]/3));for(let i=0;i<6;i++)color.toArray(colors,colors.length);
    }
    if(this.floodMesh){this.group.remove(this.floodMesh);this.floodMesh.geometry.dispose();this.floodMesh.material.dispose();}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    this.floodMesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true,opacity:.72}));this.group.add(this.floodMesh);
    const color=this.buildingMesh.geometry.attributes.color;
    const dry=new THREE.Color('#c1bba6'),wet=new THREE.Color('#e27c46');
    for(let i=0;i<this.ranges.length;i++){const [start,end]=this.ranges[i],c=this.exposure[i].exposed?wet:dry;for(let k=start;k<end;k++)color.setXYZ(k,c.r,c.g,c.b);}
    color.needsUpdate=true;
    this.stats={areaKm2:cells*this.cellArea/1e6,cityAreaKm2:cityCells*this.cellArea/1e6,volumeM3:volume,maxDepth,buildingsNearWater:this.exposure.filter(v=>v.exposed).length};
    $('floodArea').textContent=local(this.stats.areaKm2)+' км²';$('cityFloodArea').textContent=`в границе города ${local(this.stats.cityAreaKm2)} км²`;
    $('exposedCount').textContent=local(this.stats.buildingsNearWater);
    const velocities=this.data.sections.map(s=>sectionHydraulics(s.width,this.state.depth+this.state.rise,this.state.discharge,this.state.manning).velocity);
    $('velocityRange').textContent=`${Math.min(...velocities).toFixed(2)}–${Math.max(...velocities).toFixed(2)} м/с`;
    $('hydroStatus').textContent=`Связность с Волгой · 4 соседа · ${this.state.obstacles?'здания-препятствия включены':'препятствия зданий отключены'}`;
    this.sectionLines.position.y=this.state.rise*.012;
    this.onLevel(level);this.drawSection();this.drawHydrograph();this.queue2D();if(this.selectedBuilding>=0)this.inspectBuilding(this.selectedBuilding);
  }
  drawHydrograph(){
    const points=Array.from({length:121},(_,d)=>{const v=seasonalScenario(d,this.state.peak);return `${d*2},${54-(v.discharge-2500)/7500*45}`;}).join(' ');
    $('hydrograph').innerHTML=`<polyline points="${points}" fill="none" stroke="#4f9f96" stroke-width="2"/><line x1="${this.state.day*2}" x2="${this.state.day*2}" y1="5" y2="58" stroke="#d89445" stroke-width="2"/><text x="2" y="72">0 дней</text><text x="60" y="72">пик 35</text><text x="194" y="72">120</text>`;
  }
  drawSection(){
    const sec=this.data.sections[this.selectedSection],depth=this.state.depth+this.state.rise;
    const h=sectionHydraulics(sec.width,depth,this.state.discharge,this.state.manning);
    $('sectionValue').textContent=`${this.selectedSection+1} / ${this.data.sections.length}`;
    $('sectionStats').textContent=`Ширина OSM ${Math.round(sec.width)} м · A = ${Math.round(h.area).toLocaleString('ru-RU')} м² · v = ${h.velocity.toFixed(3)} м/с`;
    $('sectionPhysics').textContent=`Fr = ${h.froude.toFixed(3)} · уклон потерь ${h.frictionSlope.toExponential(2)} м/м · Q = A × v`;
    $('sectionPlot').innerHTML=`<path d="M15 9V66H285V9" fill="#399fa52b" stroke="#7b8068" stroke-width="2"/><path d="M15 22H285" stroke="#399fa5" stroke-width="2"/><text x="90" y="17">${Math.round(sec.width)} м · OSM</text><text x="85" y="48">${depth.toFixed(1)} м · допущение</text><text x="18" y="82">Прямоугольное дно задано, не измерено</text>`;
  }
  animate(dt){
    if(!this.group.visible)return;
    if(this.state.playing){this.clock+=dt;if(this.clock>.3){const day=Math.min(120,this.state.day+this.clock*3);this.clock=0;this.applyDay(day);if(day===120){this.state.playing=false;this.sync();}}}
    if(this.flowField){this.animate2D(dt);return;}
    const sections=this.data.sections,first=sections[0],last=sections.at(-1);
    for(let i=0;i<this.tracers.length;i++){
      const t=this.tracers[i];let j=0;while(j<sections.length-2&&sections[j+1].chainage<t.chainage)j++;
      const a=sections[j],b=sections[j+1],f=Math.min(1,Math.max(0,(t.chainage-a.chainage)/(b.chainage-a.chainage)));
      const interpolate=(p,q)=>p.map((v,k)=>v+(q[k]-v)*f);
      const left=interpolate(a.left,b.left),right=interpolate(a.right,b.right),p=left.map((v,k)=>v+(right[k]-v)*t.lane);
      const [x,z]=this.xy(...p),v=sectionHydraulics(a.width+(b.width-a.width)*f,this.state.depth+this.state.rise,this.state.discharge,this.state.manning).velocity;
      t.chainage+=v*dt*600;if(t.chainage>last.chainage)t.chainage=first.chainage+(t.chainage-first.chainage)%(last.chainage-first.chainage);
      const {dummy}=this;dummy.position.set(x,this.y(this.data.baseline+this.state.rise)+.065,z);
      dummy.rotation.set(0,Math.atan2(-a.tangent[0],a.tangent[1]),0);const [west,south,east,north]=this.meta.bounds;
      const col=Math.round((p[0]-west)/(east-west)*(this.meta.width-1)),row=Math.round((north-p[1])/(north-south)*(this.meta.height-1));
      const visible=col>=0&&col<this.meta.width&&row>=0&&row<this.meta.height&&this.seeds[row*this.meta.width+col];
      dummy.scale.setScalar(visible?.052:0);dummy.updateMatrix();this.flow.setMatrixAt(i,dummy.matrix);
    }
    this.flow.instanceMatrix.needsUpdate=true;
  }
  queue2D(){
    const key=[this.state.rise,this.state.discharge,this.state.depth,this.state.manning,this.use2D,this.state.playing].join('/');
    if(key===this.flowKey)return;this.flowKey=key;
    clearTimeout(this.flowTimer);this.flowWorker?.terminate();this.flowField=null;this.fieldTracers=null;
    $('flowCaption').textContent='Стрелки Волги: 1D Q / A, время ×600 · малые реки: направление OSM';
    if(!this.use2D){$('flow2dStatus').textContent='2D выключен · на карте одномерная оценка';return;}
    if(this.state.playing){$('flow2dStatus').textContent='Остановите дни, чтобы рассчитать 2D-поток для выбранного сценария';return;}
    $('flow2dStatus').textContent='Подготовка 2D-потока по берегам OSM…';
    this.flowTimer=setTimeout(()=>{
      try{
        this.flowWorker=new Worker(new URL('./flow-worker.js',import.meta.url),{type:'module'});
        this.flowWorker.onmessage=({data})=>{
          if(key!==this.flowKey)return;
          if(data.error){this.flowField=null;$('flow2dStatus').textContent='2D не рассчитан: '+data.error;return;}
          this.flowField=data;
          if(!this.fieldTracers){const cells=[];for(let k=0;k<data.mask.length;k++)if(data.mask[k])cells.push(k);this.fieldTracers=Array.from({length:240},(_,i)=>{const k=cells[Math.floor(i*cells.length/240)];return {x:k%data.width+.5,y:Math.floor(k/data.width)+.5,home:k};});}
          const d=data.diagnostics;
          $('flow2dStatus').textContent=`2D SWE · ${Math.round(d.time/60)} / 60 мин · max v ${d.maxSpeed.toFixed(2)} м/с · ошибка баланса ${(d.relativeBalanceError*100).toExponential(1)}%`;
          $('flowCaption').textContent='Белые стрелки: 2D Волги ×600 · песочные: направление малых рек OSM';
          if(data.complete)this.flowWorker.terminate();
        };
        this.flowWorker.onerror=()=>{if(key!==this.flowKey)return;this.flowField=null;$('flow2dStatus').textContent='2D недоступен в этом браузере · показана 1D-оценка';};
        this.flowWorker.postMessage({meta:this.meta,seeds:this.seeds,parameters:{baseline:this.data.baseline,depth:this.state.depth,rise:this.state.rise,discharge:this.state.discharge,manning:this.state.manning}});
      }catch(error){$('flow2dStatus').textContent='2D недоступен: '+error.message;}
    },400);
  }
  animate2D(dt){
    const f=this.flowField,[west,south,east,north]=f.bounds;
    for(let i=0;i<this.fieldTracers.length;i++){
      const t=this.fieldTracers[i];let k=Math.floor(t.y)*f.width+Math.floor(t.x);
      if(t.x<0||t.x>=f.width||t.y<0||t.y>=f.height||!f.mask[k]){t.x=t.home%f.width+.5;t.y=Math.floor(t.home/f.width)+.5;k=t.home;}
      const u=f.u[k],v=f.v[k],speed=Math.hypot(u,v),lon=west+t.x/f.width*(east-west),lat=north-t.y/f.height*(north-south);
      const [x,z]=this.xy(lon,lat),dummy=this.dummy;
      const [w,s,e,n]=this.meta.bounds,col=Math.round((lon-w)/(e-w)*(this.meta.width-1)),row=Math.round((n-lat)/(n-s)*(this.meta.height-1));
      const visible=col>=0&&col<this.meta.width&&row>=0&&row<this.meta.height&&this.seeds[row*this.meta.width+col]&&speed>1e-4;
      dummy.position.set(x,this.y(f.eta[k])+.065,z);dummy.rotation.set(0,Math.atan2(-u,-v),0);dummy.scale.setScalar(visible?.052:0);dummy.updateMatrix();this.flow.setMatrixAt(i,dummy.matrix);
      t.x+=u*dt*600/f.dx;t.y+=v*dt*600/f.dy;
    }
    this.flow.instanceMatrix.needsUpdate=true;
  }
  pick(ray){
    if(!this.group.visible||!this.buildingMesh.visible)return false;
    const hit=ray.intersectObject(this.buildingMesh)[0];if(!hit)return false;
    const vertex=hit.faceIndex*3,index=this.ranges.findIndex(([a,b])=>vertex>=a&&vertex<b);if(index<0)return false;
    this.inspectBuilding(index);return true;
  }
  inspectBuilding(index){
    this.selectedBuilding=index;const b=this.buildings[index],ex=this.exposure[index];
    $('buildingInfo').hidden=false;$('buildingName').textContent=b.address||b.name||`Здание OSM ${b.osm}`;
    $('buildingDetails').textContent=`${Math.round(b.area)} м² · высота ${b.height} м (${b.heightSource==='height'?'тег OSM':b.heightSource.startsWith('building:')?'этажность OSM × 3 м':'принято 6 м'})`;
    $('buildingExposure').textContent=ex.exposed?`В соседней ячейке вода до ${ex.depth.toFixed(2)} м над DSM. Это оценка контакта, не глубина внутри здания.`:'Контакт со связанным затоплением не обнаружен на этой сетке. Это не заключение о безопасности.';
    $('buildingLink').href='https://www.openstreetmap.org/'+b.osm;
  }
  createExport(){
    const {width:w,height:h,bounds:[west,south,east,north]}=this.meta;
    const dx=(east-west)/(w-1),dy=(north-south)/(h-1),features=[];
    for(let k=0;k<this.dem.length;k++)if(this.flood.wet[k]&&!this.seeds[k]&&this.surfaceMask[k]!==2&&this.flood.depth[k]>0){
      const lon=west+(k%w)*dx,lat=north-Math.floor(k/w)*dy;
      const x0=Math.max(west,lon-dx/2),x1=Math.min(east,lon+dx/2),y0=Math.max(south,lat-dy/2),y1=Math.min(north,lat+dy/2);
      features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]},properties:{kind:'flood_cell',depthAboveDsm:this.flood.depth[k],city:this.surfaceMask[k]===1}});
    }
    this.buildings.forEach((b,i)=>{if(this.exposure[i].exposed)features.push({type:'Feature',geometry:b.geometry,properties:{kind:'building_contact',osm:b.osm,address:b.address,adjacentCellDepth:this.exposure[i].depth,screening:'adjacent flooded DEM cell; not indoor flooding'}});});
    for(const s of this.data.sections)features.push({type:'Feature',geometry:{type:'LineString',coordinates:[s.left,s.right]},properties:{kind:'section',chainage:s.chainage,width:s.width,assumedDepth:this.state.depth+this.state.rise,...sectionHydraulics(s.width,this.state.depth+this.state.rise,this.state.discharge,this.state.manning)}});
    if(this.flowField){const f=this.flowField,[west,south,east,north]=f.bounds;for(let k=0;k<f.mask.length;k++)if(f.mask[k])features.push({type:'Feature',geometry:{type:'Point',coordinates:[west+(k%f.width+.5)/f.width*(east-west),north-(Math.floor(k/f.width)+.5)/f.height*(north-south)]},properties:{kind:'flow2d',uEast:f.u[k],vSouth:f.v[k],waterElevation:f.eta[k],speed:Math.hypot(f.u[k],f.v[k])}});}
    const payload={type:'FeatureCollection',metadata:{model:'connected equilibrium flood screening + 1D section diagnostics + optional river-only 2D SWE',created:new Date().toISOString(),osmSnapshot:this.data.osmSnapshot,baseline:this.data.baseline,verticalDatum:this.data.verticalDatum,parameters:{...this.state},statistics:this.stats,flow2d:this.flowField?{diagnostics:this.flowField.diagnostics,dx:this.flowField.dx,dy:this.flowField.dy,initialState:'rest',bed:'synthetic flat bed',banks:'fixed OSM mask',boundaries:'west prescribed discharge; east prescribed stage; reflective banks'}:null,limitations:'No measured bathymetry, no calibrated gauges, DSM includes roofs/vegetation, footprint-adjacent exposure is not indoor flooding. Flood screening is equilibrium and independent of the optional transient river-only 2D SWE solver. 2D bathymetry is synthetic and banks are fixed; no calibration or dam operation.'},features};
    return payload;
  }
  export(){
    const payload=this.createExport();
    let link=$('scenarioDownload');
    if(link)URL.revokeObjectURL(link.href);else{link=document.createElement('a');link.id='scenarioDownload';$('exportScenario').after(link);}
    link.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/geo+json'}));
    link.download='cheboksary-water-scenario.geojson';link.textContent=`Скачать снимок ΔH=+${this.state.rise.toFixed(2)} м · ${payload.features.length} объектов`;
    link.click();
  }
}
