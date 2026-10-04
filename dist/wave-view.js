import * as THREE from 'three';
const $=id=>document.getElementById(id);
const names={radial:'Круговая волна',dipole:'Гребень и впадина',seiche:'Перекос водоёма'};
export class WaveView{
  constructor(view){
    this.view=view;this.active=true;this.picking=false;
    const index=Math.floor(view.data.sections.length/2);
    this.state={kind:'radial',amplitude:1,radius:700,angle:0,index,source:[...view.data.sections[index].center],closed:false,rate:30};
    this.marker=new THREE.Mesh(new THREE.RingGeometry(.97,1.03,80),new THREE.MeshBasicMaterial({color:0xf2a34f,side:THREE.DoubleSide,depthTest:false}));
    this.marker.rotation.x=-Math.PI/2;this.marker.renderOrder=6;this.marker.visible=false;view.group.add(this.marker);
    this.gaugeMarkers=['#568fba','#ce8843','#6a9c69'].map(color=>{const m=new THREE.Mesh(new THREE.SphereGeometry(.055,12,8),new THREE.MeshBasicMaterial({color,depthTest:false}));m.renderOrder=7;m.visible=false;view.group.add(m);return m;});
    for(const [id,key] of [['waveAmplitude','amplitude'],['waveRadius','radius'],['waveAngle','angle']])$(id).oninput=e=>{this.state[key]=Number(e.target.value);this.sync();};
    $('waveKind').onchange=e=>{this.state.kind=e.target.value;this.sync();};
    $('waveClosed').onchange=e=>{this.state.closed=e.target.checked;};
    $('waveRate').onchange=e=>{this.state.rate=Number(e.target.value);if(view.flowField?.wave)view.flowWorker?.postMessage({type:'rate',rate:this.state.rate});};
    $('waveSource').max=view.data.sections.length-1;
    $('waveSource').oninput=e=>{this.state.index=Number(e.target.value);this.state.source=[...view.data.sections[this.state.index].center];this.picking=false;this.sync();};
    $('wavePick').onclick=()=>{this.picking=!this.picking;this.sync();};
    $('waveLaunch').onclick=()=>this.launch();
    $('waveSettingsButton').onclick=()=>{$('waveControls').open=true;$('waveControls').scrollIntoView({block:'nearest',behavior:'smooth'});this.sync();};
    $('waveControls').ontoggle=()=>this.updateMarker();
    this.sync();
  }
  sync(){
    const s=this.state;
    $('waveAmplitudeValue').textContent=s.amplitude.toFixed(1)+' м';$('waveRadiusValue').textContent=s.radius+' м';
    $('waveSource').value=s.index;$('waveSourceValue').textContent=`${s.source[1].toFixed(4)}° N · ${s.source[0].toFixed(4)}° E`;
    $('wavePick').textContent=this.picking?'Нажмите на воду…':'Указать на карте';$('wavePick').classList.toggle('active',this.picking);
    $('waveRadius').disabled=s.kind==='seiche';$('waveAngle').disabled=s.kind==='radial';
    $('waveSourceNote').textContent=s.kind==='seiche'?'Перекос всей водной области; выбранная точка служит центром наблюдений.':'Кольцо показывает масштаб ядра. Возмущение плавно затухает до нуля на трёх радиусах.';
    this.updateMarker();
  }
  updateMarker(){
    const s=this.state,f=this.view.flowField;
    this.marker.visible=this.active&&s.kind!=='seiche'&&(this.picking||$('waveControls').open);
    const [x,z]=this.view.xy(...s.source);let elevation=this.view.data.baseline;
    if(f){const [w,b,e,n]=f.bounds,col=Math.floor((s.source[0]-w)/(e-w)*f.width),row=Math.floor((n-s.source[1])/(n-b)*f.height);elevation=f.eta[row*f.width+col]||elevation;}
    this.marker.position.set(x,this.view.y(elevation)+.075,z);this.marker.scale.setScalar(s.radius/1000);
    this.gaugeMarkers.forEach((marker,i)=>{marker.visible=this.active&&!!f?.wave;if(marker.visible){const g=f.wave.gauges[i],[gx,gz]=this.view.xy(...g.resolvedCoordinates);marker.position.set(gx,this.view.y(f.eta[g.cell])+.08,gz);}});
  }
  pick(ray){
    if(!this.active||!this.picking)return false;
    const v=this.view,f=v.flowField,hit=v.floodMesh&&ray.intersectObject(v.floodMesh)[0];
    if(!hit||!f){$('waveStatus').textContent='Нажмите на смоченное русло Волги.';return true;}
    const k=v.floodMesh.userData.cells[Math.floor(hit.faceIndex/2)];
    if(!f.river[k]||f.depth[k]<.1){$('waveStatus').textContent='Источник должен находиться в воде Волги глубже 10 см.';return true;}
    const [w,s,e,n]=f.bounds;this.state.source=[w+(k%f.width+.5)/f.width*(e-w),n-(Math.floor(k/f.width)+.5)/f.height*(n-s)];
    this.state.index=this.nearestSection();this.picking=false;$('waveStatus').textContent='Источник выбран. Настройте амплитуду и запустите волну.';this.sync();return true;
  }
  nearestSection(){
    const p=this.state.source;let best=0,d=Infinity;
    this.view.data.sections.forEach((s,i)=>{const r=((s.center[0]-p[0])*Math.cos(p[1]*Math.PI/180))**2+(s.center[1]-p[1])**2;if(r<d){d=r;best=i;}});return best;
  }
  launch(){
    const v=this.view,s=this.state;if(!v.flowWorker||!v.flowField)return;
    const index=this.nearestSection(),sections=v.data.sections;
    const gauges=[{name:'Западнее',coordinates:sections[Math.max(0,index-14)].center},{name:'Источник',coordinates:s.source},{name:'Восточнее',coordinates:sections[Math.min(sections.length-1,index+14)].center}];
    v.onWaveFocus?.(s.source,s.kind==='seiche'?1500:s.radius);v.requestedRunning=true;
    v.flowWorker.postMessage({type:'wave',source:{kind:s.kind,amplitude:s.amplitude,radius:s.radius,angle:s.angle,lon:s.source[0],lat:s.source[1]},closed:s.closed,rate:s.rate,gauges});
    $('waveStatus').textContent='Подготовка возмущения…';
  }
  receive(field){
    $('waveLaunch').disabled=false;
    this.updateMarker();const w=field.wave;
    if(!w){$('waveTime').textContent='';$('waveStatus').textContent='';$('waveGraph').innerHTML='';$('waveGaugeStats').textContent='';$('wavePeak').textContent='—';$('waveExtent').textContent='';return;}
    $('waveTime').textContent=`Волна: ${(w.elapsed/60).toFixed(2)} мин · ${field.running?'расчёт':'пауза'} · ×${w.rate}`;
    $('wavePeak').textContent=w.maxChange.toFixed(2)+' м';
    const event=w.event;let flooded=0;for(let k=0;k<field.mask.length;k++)if(field.mask[k]&&!field.river[k]&&field.maxDepth[k]>.05)flooded++;
    $('waveExtent').textContent=`Максимальный охват суши ${(flooded*field.dx*field.dy/1e6).toFixed(2)} км² с начала опыта`;
    $('waveStatus').textContent=event.scale<.999?'Амплитуда ограничена глубиной':w.closed?'Замкнутый бассейн':'';
    $('waveGaugeStats').textContent=w.gauges.map(g=>`${g.name}: пик |ΔH| ${g.peak.toFixed(2)} м, ≥5 см ${g.arrival===null?'ещё нет':(g.arrival/60).toFixed(2)+' мин'}`).join(' · ');
    const limit=Math.max(.05,...w.history.flatMap(p=>p.values.map(Math.abs))),duration=Math.max(60,w.elapsed),colors=['#568fba','#ce8843','#6a9c69'];
    $('waveGraph').innerHTML=`<line x1="25" x2="285" y1="60" y2="60" stroke="#aabbb0"/><text x="0" y="12">+${limit.toFixed(2)}</text><text x="0" y="109">−${limit.toFixed(2)} м</text><text x="250" y="125">${(duration/60).toFixed(1)} мин</text>`+w.gauges.map((g,i)=>`<polyline points="${w.history.map(p=>`${25+p.time/duration*260},${60-p.values[i]/limit*48}`).join(' ')}" fill="none" stroke="${colors[i]}" stroke-width="2"/>`).join('');
  }
}
