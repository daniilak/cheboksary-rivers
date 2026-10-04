import * as THREE from 'three';
import {seasonalScenario} from './hydrology.js?v=direction-1';
import {SedimentView} from './sediment-view.js?v=direction-1';
import {WaveView} from './wave-view.js?v=direction-1';
import {observeFlow,flowFeatures,flowDirection} from './flow-observations.js?v=direction-1';
const $=id=>document.getElementById(id);
const local=n=>n.toLocaleString('ru-RU',{maximumFractionDigits:2});

export class HydrologyView {
  constructor({world,meta,dem,seeds,barriers,surfaceMask,buildings,data,xy,onLevel,onFocus,onWaveFocus,onBed}) {
    Object.assign(this,{world,meta,dem,seeds,barriers,surfaceMask,buildings,data,xy,onLevel,onFocus,onWaveFocus,onBed});
    this.state={sediment:{enabled:true,grainMm:1,grainFraction:.5,supply:1},rise:0,discharge:2500,depth:8,manning:.03,day:0,peak:0,obstacles:true,playing:false,mode:'manual'};
    this.display='depth';this.group=new THREE.Group();world.add(this.group);this.use2D=true;this.flowField=null;this.flowKey=null;
    this.exposure=buildings.map(()=>({exposed:false,depth:0}));this.stats={};this.ranges=[];this.clock=0;this.selectedSection=40;this.selectedBuilding=-1;
    const [w,s,e,n]=meta.bounds;
    this.cellX=(e-w)*111320*Math.cos((s+n)*Math.PI/360)/(meta.width-1);
    this.cellY=(n-s)*111320/(meta.height-1);this.cellArea=this.cellX*this.cellY;
    this.buildBuildings();this.buildSections();this.buildFlow();this.waves=new WaveView(this);this.sediments=new SedimentView(this);this.bind();this.update();
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
    $('buildingResolution').textContent='Часть контуров становится препятствиями на сетке ~52 × 62 м';
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
      if(key==='rise'||key==='discharge'){this.state.mode='manual';this.state.day=0;}
      this.update();
    };
    $('peakRise').oninput=e=>{this.state.peak=Number(e.target.value);this.applyDay(this.state.day);};
    $('seasonDay').oninput=e=>{this.applyDay(Number(e.target.value));};
    $('seasonPlay').onclick=()=>this.toggleSeason();
    for(const button of document.querySelectorAll('[data-scenario]'))button.onclick=()=>{
      if(button.dataset.scenario==='base'){this.state.mode='manual';this.state.rise=0;this.state.discharge=2500;this.state.day=0;this.update();}
      if(button.dataset.scenario==='spring'){this.state.peak=0;this.applyDay(35);}
      if(button.dataset.scenario==='extreme'){this.state.mode='manual';this.state.day=0;this.state.rise=3;this.state.discharge=10000;this.update();}
    };
    $('showBuildings').onchange=e=>{this.buildingMesh.visible=e.target.checked;};
    $('useBuildings').onchange=e=>{this.state.obstacles=e.target.checked;this.update();};
    $('showSections').onchange=e=>{this.sectionLines.visible=e.target.checked;};
    $('mapDisplay').onchange=e=>{this.display=e.target.value;if(this.flowField)this.receiveField(this.flowField);};
    $('resetFlow').onclick=()=>{this.flowKey=null;this.geometryKey=null;this.queue2D();};
    $('section').oninput=e=>{this.selectedSection=Number(e.target.value);this.drawSection();};
    $('exportScenario').onclick=()=>this.export();
    $('focusBuildings').onclick=()=>{
      let index=this.exposure.findIndex(v=>v.exposed);
      if(index<0){let best=Infinity;for(let i=0;i<this.buildings.length;i++){const b=this.buildings[i];if(b.baseElevation<best&&b.area>80){best=b.baseElevation;index=i;}}}
      if(index>=0){this.inspectBuilding(index);this.onFocus(this.buildings[index]);}
    };
  }
  setRunning(running){if(running&&!this.flowWorker){this.flowKey=null;this.queue2D();return;}this.requestedRunning=running;this.state.playing=running;this.flowWorker?.postMessage({type:'run',running});this.sync();}
  toggleSeason(){this.setRunning(!this.state.playing);}
  applyDay(day){this.state.day=day;this.state.mode='season';Object.assign(this.state,seasonalScenario(day,this.state.peak));this.update();}
  sync(){
    const s=this.state;
    for(const [id,key] of [['stage','rise'],['discharge','discharge'],['assumedDepth','depth'],['roughness','manning'],['seasonDay','day'],['peakRise','peak']])$(id).value=s[key];
    $('stageValue').textContent=`+${s.rise.toFixed(2)} м`;$('dischargeValue').textContent=`${Math.round(s.discharge).toLocaleString('ru-RU')} м³/с`;
    $('depthValue').textContent=s.depth.toFixed(1)+' м';$('roughnessValue').textContent=s.manning.toFixed(3);
    $('dayValue').textContent=`${Math.round(s.day)} / 120`;$('peakValue').textContent=s.peak.toFixed(1)+' м';
    $('seasonPlay').textContent=s.playing?'Ⅱ Пауза':'▶ Продолжить';$('seasonPlay').setAttribute('aria-label',s.playing?'Приостановить всю симуляцию':'Продолжить всю симуляцию');
    $('hydroMode').textContent=s.mode==='season'?'ГРАНИЧНЫЕ УСЛОВИЯ ИЗ СЦЕНАРИЯ':'УРОВЕНЬ НА ВЫХОДЕ · РАСХОД НА ВХОДЕ';
    $('waterDatum').textContent=`${(this.data.baseline+s.rise).toFixed(2)} м EGM2008 на выходе · ноль ${this.data.baseline.toFixed(2)} м по DSM`;
    for(const b of document.querySelectorAll('[data-scenario]'))b.classList.toggle('active',b.dataset.scenario==='spring'?s.mode==='season':s.mode==='manual'&&(b.dataset.scenario==='base'?s.rise===0&&s.discharge===2500:s.rise===3&&s.discharge===10000));
  }
  update(){
    this.sync();this.drawSection();this.drawHydrograph();this.queue2D();
  }
  receiveField(field){
    this.flowField=field;this.state.playing=field.running;this.sync();
    this.sediments.receive(field);
    const waveLimit=field.wave?Math.max(.05,field.wave.event.raised,-field.wave.event.lowered):0;
    $('mapLegend').textContent=this.display==='wave'?(field.wave?`Синий − / оранжевый + · ±${waveLimit.toFixed(2)} м`:'Нет волны · глубина'):this.display==='change'?`Красный − / синий + · ±${(this.sediments.scale*1000).toFixed(3)} мм`:this.display==='mobility'?'Ниже / выше порога':'Светлее — мельче · темнее — глубже';
    if(this.renderedGridKey!==this.geometryKey||field.sediment){this.onBed?.(field);this.renderedGridKey=this.geometryKey;}
    const previous=this.exposure;
    Object.assign(this,observeFlow(field,this.meta,this.surfaceMask,this.buildings));
    const positions=[],colors=[],cells=[],[west,south,east,north]=field.bounds;
    const a=new THREE.Color('#83c9cd'),b=new THREE.Color('#08788f');
    for(let k=0;k<field.mask.length;k++){
      if(!field.mask[k]||field.depth[k]<=.05)continue;
      const [x,z]=this.xy(west+(k%field.width+.5)/field.width*(east-west),north-(Math.floor(k/field.width)+.5)/field.height*(north-south));
      const hx=field.dx*.0005,hz=field.dy*.0005,y=this.y(field.eta[k])+.0002;
      positions.push(x-hx,y,z-hz,x+hx,y,z-hz,x+hx,y,z+hz,x-hx,y,z-hz,x+hx,y,z+hz,x-hx,y,z+hz);
      cells.push(k);let color=a.clone().lerp(b,Math.min(1,field.depth[k]/4));
      if(this.display==='wave'&&field.wave&&field.river[k]){const value=field.anomaly[k],limit=Math.max(.05,field.wave.event.raised,-field.wave.event.lowered);color=new THREE.Color('#8bc3c8').lerp(new THREE.Color(value<0?'#2459b8':'#f9a350'),Math.min(1,Math.abs(value)/limit));}
      color=this.sediments.color(k,field,color);
      for(let i=0;i<6;i++)color.toArray(colors,colors.length);
    }
    if(this.floodMesh){this.group.remove(this.floodMesh);this.floodMesh.geometry.dispose();this.floodMesh.material.dispose();}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    this.floodMesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}));this.floodMesh.userData.cells=cells;this.group.add(this.floodMesh);
    const color=this.buildingMesh.geometry.attributes.color,dry=new THREE.Color('#c1bba6'),wet=new THREE.Color('#e27c46');
    for(let i=0;i<this.ranges.length;i++){
      if(this.coloredBuildings&&previous[i].exposed===this.exposure[i].exposed)continue;
      const [start,end]=this.ranges[i],c=this.exposure[i].exposed?wet:dry;for(let k=start;k<end;k++)color.setXYZ(k,c.r,c.g,c.b);
    }
    this.coloredBuildings=true;color.needsUpdate=true;
    $('floodArea').textContent=local(this.stats.areaKm2)+' км²';$('cityFloodArea').textContent=`в границе города ${local(this.stats.cityAreaKm2)} км²`;
    $('exposedCount').textContent=local(this.stats.buildingsNearWater);
    const d=field.diagnostics;
    $('velocityRange').textContent=d.maxSpeed.toFixed(2)+' м/с';
    const direction=flowDirection(field);
    $('flowDirection').textContent=field.wave?'Волновое движение':direction.sign>0?'Вниз по Волге → Новочебоксарск':direction.sign<0?'Вверх по Волге · обратный поток':'Течение устанавливается';
    $('flowDirection').dataset.reverse=String(!field.wave&&direction.sign<0);
    $('flowDirection').title=`Средний створ: Q = ${Math.round(direction.discharge)} м³/с; плюс — на восток. При подпоре и волнах возможен обратный поток.`;
    $('modelTime').textContent=`t = ${(d.time/3600).toFixed(2)} ч · ${field.running?'расчёт':'пауза'}`;
    $('flow2dStatus').textContent='';
    $('flowDetails').textContent=`${field.running?'Расчёт':'Пауза'} · ${(d.time/3600).toFixed(2)} ч · баланс ${(d.relativeBalanceError*100).toExponential(1)}% · Qвх ${Math.round((d.inletQ??0))} м³/с · Hвых ${d.outletLevel===null?'закрыт':d.outletLevel.toFixed(2)+' м'}`;
    $('hydroStatus').textContent=d.ceilingReached?'Достигнут предел высот расчётной области — результат за пределами применимости':d.edgeWet?'Вода достигла закрытого края карты: область нужно расширить':'';
    $('flowCaption').textContent='Белые трассеры: рассчитанное 2D-поле, показ ×600 · песочные: направление OSM';
    this.waves.receive(field);if(this.group.visible)this.onLevel(null);$('exportScenario').disabled=false;this.drawSection();
    if(this.selectedBuilding>=0)this.inspectBuilding(this.selectedBuilding);
  }
  drawHydrograph(){
    const points=Array.from({length:121},(_,d)=>{const v=seasonalScenario(d,this.state.peak);return `${d*2},${54-(v.discharge-2500)/7500*45}`;}).join(' ');
    $('hydrograph').innerHTML=`<polyline points="${points}" fill="none" stroke="#4f9f96" stroke-width="2"/><line x1="${this.state.day*2}" x2="${this.state.day*2}" y1="5" y2="58" stroke="#d89445" stroke-width="2"/><text x="2" y="72">0 дней</text><text x="60" y="72">пик 35</text><text x="194" y="72">120</text>`;
  }
  drawSection(){
    const sec=this.data.sections[this.selectedSection],f=this.flowField;
    $('sectionValue').textContent=`${this.selectedSection+1} / ${this.data.sections.length}`;
    if(!f){$('sectionStats').textContent='Ожидание поля воды…';$('sectionPhysics').textContent='';$('sectionPlot').innerHTML='';return;}
    const [west,south,east,north]=f.bounds,samples=[];let area=0,q=0;
    for(let i=0;i<100;i++){
      const t=(i+.5)/100,lon=sec.left[0]+t*(sec.right[0]-sec.left[0]),lat=sec.left[1]+t*(sec.right[1]-sec.left[1]);
      const x=Math.floor((lon-west)/(east-west)*f.width),y=Math.floor((north-lat)/(north-south)*f.height),k=y*f.width+x;
      if(x<0||x>=f.width||y<0||y>=f.height)continue;
      const h=f.mask[k]?f.depth[k]:0,normal=f.u[k]*sec.tangent[0]-f.v[k]*sec.tangent[1];
      area+=h*sec.width/100;q+=h*normal*sec.width/100;samples.push({x:15+t*270,bed:f.bed[k],eta:f.bed[k]+h,wet:h>.05});
    }
    if(!samples.length)return;
    const low=Math.min(...samples.map(p=>p.bed)),high=Math.max(...samples.map(p=>p.eta)),scale=48/Math.max(1,high-low);
    const points=key=>samples.map(p=>`${p.x.toFixed(1)},${(65-(p[key]-low)*scale).toFixed(1)}`).join(' ');
    $('sectionStats').textContent=`Срез 2D · ширина OSM ${Math.round(sec.width)} м · A ≈ ${Math.round(area).toLocaleString('ru-RU')} м²`;
    $('sectionPhysics').textContent=`Q через срез ≈ ${Math.round(q).toLocaleString('ru-RU')} м³/с · средняя v ≈ ${(area?q/area:0).toFixed(3)} м/с. Минус — обратный поток. Расход меняется при накоплении воды.`;
    $('sectionPlot').innerHTML=`<polyline points="${points('bed')}" fill="none" stroke="#7b8068" stroke-width="2"/><polyline points="${points('eta')}" fill="none" stroke="#399fa5" stroke-width="2"/><text x="18" y="82">Дно: допущение · вода: поле 2D</text>`;
  }
  animate(dt){
    if(!this.group.visible)return;
    this.flow.visible=!!this.flowField;
    if(this.flowField&&this.fieldTracers)this.animate2D(dt);
  }
  flowParameters(){return {sediment:{...this.state.sediment},baseline:this.data.baseline,depth:this.state.depth,rise:this.state.rise,discharge:this.state.discharge,manning:this.state.manning,obstacles:this.state.obstacles};}
  queue2D(){
    const parameters=this.flowParameters();
    const geometryKey=[parameters.depth,parameters.obstacles].join('/');
    const key=JSON.stringify(parameters);
    if(key===this.flowKey)return;
    this.flowKey=key;this.requestedRunning=true;this.state.playing=true;this.sync();clearTimeout(this.flowTimer);
    if(this.flowWorker&&geometryKey===this.geometryKey){
      this.flowTimer=setTimeout(()=>this.flowWorker.postMessage({type:'parameters',parameters:this.flowParameters(),running:this.requestedRunning}),200);return;
    }
    this.geometryKey=geometryKey;this.flowWorker?.terminate();this.flowWorker=null;this.flowField=null;this.fieldTracers=null;
    if(this.floodMesh){this.group.remove(this.floodMesh);this.floodMesh.geometry.dispose();this.floodMesh.material.dispose();this.floodMesh=null;}
    this.onLevel(this.data.baseline);$('exportScenario').disabled=true;$('waveLaunch').disabled=true;
    $('flow2dStatus').textContent='Новая геометрия: запуск из покоя при исходном уровне…';
    this.flowTimer=setTimeout(()=>{
      try{
        const worker=new Worker(new URL('./flow-worker.js?v=direction-1',import.meta.url),{type:'module'});this.flowWorker=worker;
        worker.onmessage=({data})=>{
          if(worker!==this.flowWorker)return;
          if(data.waveError){$('waveStatus').textContent=data.waveError;return;}
          if(data.error){worker.terminate();this.flowWorker=null;this.flowKey=null;this.state.playing=false;this.sync();$('flow2dStatus').textContent='Расчёт остановлен: '+data.error;return;}
          this.receiveField(data);
          const cells=[];for(let k=0;k<data.mask.length;k++)if(data.mask[k]&&data.depth[k]>.05)cells.push(k);
          this.wetFlowCells=cells;
          if(!this.fieldTracers)this.fieldTracers=Array.from({length:240},(_,i)=>{const k=cells[Math.floor(i*cells.length/240)];return {x:k%data.width+.5,y:Math.floor(k/data.width)+.5,home:k};});
        };
        worker.onerror=()=>{worker.terminate();this.flowWorker=null;this.flowKey=null;this.state.playing=false;this.sync();$('flow2dStatus').textContent='Ошибка 2D: расчёт остановлен, показан последний полученный снимок';};
        worker.postMessage({type:'init',running:this.requestedRunning,meta:this.meta,seeds:this.seeds,dem:this.dem,barriers:this.barriers,parameters:this.flowParameters()});
      }catch(error){$('flow2dStatus').textContent='2D недоступен: '+error.message;}
    },200);
  }
  animate2D(dt){
    const f=this.flowField,[west,south,east,north]=f.bounds;
    for(let i=0;i<this.fieldTracers.length;i++){
      const t=this.fieldTracers[i];let k=Math.floor(t.y)*f.width+Math.floor(t.x);
      if(t.x<0||t.x>=f.width||t.y<0||t.y>=f.height||!f.mask[k]||f.depth[k]<=.05){t.home=this.wetFlowCells[(i*137)%this.wetFlowCells.length];t.x=t.home%f.width+.5;t.y=Math.floor(t.home/f.width)+.5;k=t.home;}
      const u=f.u[k],v=f.v[k],speed=Math.hypot(u,v),lon=west+t.x/f.width*(east-west),lat=north-t.y/f.height*(north-south);
      const [x,z]=this.xy(lon,lat),dummy=this.dummy;
      const [w,s,e,n]=this.meta.bounds,col=Math.round((lon-w)/(e-w)*(this.meta.width-1)),row=Math.round((n-lat)/(n-s)*(this.meta.height-1));
      const visible=col>=0&&col<this.meta.width&&row>=0&&row<this.meta.height&&f.depth[k]>.05&&speed>1e-4;
      dummy.position.set(x,this.y(f.eta[k])+.065,z);dummy.rotation.set(0,Math.atan2(-u,-v),0);dummy.scale.setScalar(visible?.052:0);dummy.updateMatrix();this.flow.setMatrixAt(i,dummy.matrix);
      if(this.state.playing){t.x+=u*dt*600/f.dx;t.y+=v*dt*600/f.dy;}
    }
    this.flow.instanceMatrix.needsUpdate=true;
  }
  pick(ray){
    if(!this.group.visible)return false;if(this.waves.pick(ray))return true;if(!this.buildingMesh.visible)return false;
    const hit=ray.intersectObject(this.buildingMesh)[0];if(!hit)return false;
    const vertex=hit.faceIndex*3,index=this.ranges.findIndex(([a,b])=>vertex>=a&&vertex<b);if(index<0)return false;
    this.inspectBuilding(index);return true;
  }
  inspectBuilding(index){
    this.selectedBuilding=index;const b=this.buildings[index],ex=this.exposure[index];
    $('buildingInfo').hidden=false;$('buildingName').textContent=b.address||b.name||`Здание OSM ${b.osm}`;
    $('buildingDetails').textContent=`${Math.round(b.area)} м² · высота ${b.height} м (${b.heightSource==='height'?'тег OSM':b.heightSource.startsWith('building:')?'этажность OSM × 3 м':'принято 6 м'})`;
    $('buildingExposure').textContent=ex.exposed?`В соседней ячейке вода до ${ex.depth.toFixed(2)} м над DSM. Это оценка контакта, не глубина внутри здания.`:'Контакт с рассчитанным затоплением не обнаружен на этой сетке. Это не заключение о безопасности.';
    $('buildingLink').href='https://www.openstreetmap.org/'+b.osm;
  }
  createExport(){
    if(!this.flowField)throw Error('Дождитесь первого снимка расчёта');
    const features=flowFeatures(this.flowField);
    this.buildings.forEach((b,i)=>{if(this.exposure[i].exposed)features.push({type:'Feature',geometry:b.geometry,properties:{kind:'building_contact',osm:b.osm,address:b.address,adjacentCellDepth:this.exposure[i].depth,screening:'adjacent flooded grid cell; not indoor flooding'}});});
    return {type:'FeatureCollection',metadata:{model:'coupled 2D shallow-water channel and floodplain',wave:this.flowField.wave||null,sediment:this.flowField.sediment?Object.fromEntries(Object.entries(this.flowField.sediment).filter(([key])=>!['change','shear','mobility'].includes(key))):null,created:new Date().toISOString(),parametersRole:'requested controls; applied inlet/outlet values are in flow2d.diagnostics',osmSnapshot:this.data.osmSnapshot,baseline:this.data.baseline,verticalDatum:this.data.verticalDatum,parameters:{...this.state},statistics:this.stats,flow2d:{diagnostics:this.flowField.diagnostics,dx:this.flowField.dx,dy:this.flowField.dy,initialState:'baseline-connected water at rest; dry isolated depressions',bed:'initial synthetic flat channel and averaged DSM; optional coupled Exner bed-load evolution',boundaries:'OSM river portals only: west discharge, east stage; closed other edges; forcing ramp 1800 s'},limitations:'No measured bathymetry or gauge calibration. Sediment is an assumed uniform noncohesive 0.5 m layer, MPM bed load only, no suspended load, bank collapse, slope correction or mapped bank protection. DSM includes roofs/vegetation. Buildings occupy coarse cells at >=50% footprint coverage, narrow passages and small buildings unresolved. Contacts are not indoor flooding. High ground above baseline+12 m is closed. No tributary runoff, hydraulic structures, wind or ice. Seasonal day selects boundary values, not elapsed simulation time.'},features};
  }
  export(){
    if(!this.flowField)return;
    const payload=this.createExport();
    let link=$('scenarioDownload');
    if(link)URL.revokeObjectURL(link.href);else{link=document.createElement('a');link.id='scenarioDownload';$('exportScenario').after(link);}
    link.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/geo+json'}));
    link.download='cheboksary-water-scenario.geojson';link.textContent=`Скачать снимок ΔH=+${this.state.rise.toFixed(2)} м · ${payload.features.length} объектов`;
    link.click();
  }
}
