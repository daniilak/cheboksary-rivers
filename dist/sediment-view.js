import * as THREE from 'three';
const $=id=>document.getElementById(id);
const mm=m=>(m*1000).toLocaleString('ru-RU',{maximumFractionDigits:3});
export class SedimentView {
  constructor(view){
    this.view=view;this.display='depth';
    for(const [id,key] of [['sedimentEnabled','enabled'],['grainSize','grainMm'],['grainShear','grainFraction'],['sedimentSupply','supply']])$(id).onchange=e=>{
      view.state.sediment[key]=key==='enabled'?e.target.checked:Number(e.target.value);
      view.flowKey=JSON.stringify(view.flowParameters());view.flowWorker?.postMessage({type:'sediment',parameters:view.state.sediment});
    };
    $('sedimentDisplay').onchange=e=>{this.display=e.target.value;if(view.flowField)view.receiveField(view.flowField);};
    $('sedimentExperiment').onclick=()=>{Object.assign(view.state,{depth:2,discharge:10000,rise:0,day:0,mode:'manual',sediment:{enabled:true,grainMm:1,grainFraction:.5,supply:1}});$('sedimentEnabled').checked=true;$('grainSize').value='1';$('grainShear').value='.5';$('sedimentSupply').value='1';view.geometryKey=null;view.flowKey=null;view.update();view.onWaveFocus(view.data.sections[42].center,1500);};
    $('sedimentContinue').onclick=()=>view.setRunning(true);
    $('sedimentFocus').onclick=()=>{
      const f=view.flowField;if(!f?.sediment)return;let cell=-1,best=-1;
      for(let k=0;k<f.mask.length;k++)if(f.mask[k]&&f.depth[k]>.05){const v=Math.abs(f.sediment.change[k]);if(v>best){cell=k;best=v;}}
      if(cell>=0){const [w,s,e,n]=f.bounds;view.onWaveFocus([w+(cell%f.width+.5)/f.width*(e-w),n-(Math.floor(cell/f.width)+.5)/f.height*(n-s)],500);}
    };
  }
  setMode(active){
    $('sedimentPanel').hidden=!active;this.active=active;document.body.classList.toggle('sediment-mode',active);document.querySelector('#riverControls h3').textContent=active?'Волга · подвижное дно':'Волга · течение и затопление';
    this.display=active?'change':'depth';$('sedimentDisplay').value=this.display;
    if(this.view.flowField)this.view.receiveField(this.view.flowField);
  }
  color(k,field,fallback){
    const s=field.sediment;if(!s||!this.active)return fallback;
    if(this.display==='change')return new THREE.Color('#dce4d6').lerp(new THREE.Color(s.change[k]<0?'#b84c2d':'#285abd'),Math.min(1,Math.abs(s.change[k])/this.scale));
    if(this.display==='mobility')return new THREE.Color('#dce4d6').lerp(new THREE.Color(s.mobility[k]>1?'#ce652d':'#3f8e8b'),Math.min(1,s.mobility[k]>1?(s.mobility[k]-1)/3:1-s.mobility[k]));
    return fallback;
  }
  receive(field){
    const s=field.sediment;if(!s)return;
    this.scale=Math.max(.0001,s.maxErosion,s.maxDeposition);
    $('sedimentErosion').textContent=mm(s.maxErosion)+' мм';$('sedimentDeposition').textContent=mm(s.maxDeposition)+' мм';
    $('sedimentClock').textContent=`${(field.diagnostics.time/3600).toFixed(2)} ч физического времени · ${field.running?'расчёт':'пауза'}`;
    $('sedimentContinue').disabled=field.running;
    $('sedimentLegend').textContent=this.display==='change'?`Красный: размыв · синий: отложение · шкала ±${mm(this.scale)} мм`:this.display==='mobility'?'Бирюзовый: ниже порога · оранжевый: выше порога τ / τкр = 1':'Окраска по глубине воды';
    $('sedimentMobility').textContent=`Выше порога: ${(s.mobileAreaFraction*100).toFixed(1)}% мокрой площади · максимум τ/τкр ${s.maxMobility.toFixed(2)} · τкр ${s.criticalShear.toFixed(2)} Па`;
    $('sedimentReason').textContent=!s.parameters.enabled?'Дно зафиксировано переключателем. Напряжение рассчитывается, грунт не переносится.':s.maxMobility<=1?'Сейчас поток ниже порога движения выбранного зерна. Нулевой перенос при этих условиях — результат расчёта.':'Поток перемещает грунт. Дно меняется там, где вынос наносов отличается от их поступления; одинаковый перенос сам по себе не вызывает размыв.';
    $('sedimentBudget').textContent=`Вход / выход: ${s.incomingSolidM3.toFixed(3)} / ${s.outgoingSolidM3.toFixed(3)} м³ твёрдой фазы. Невязка: ${s.balanceErrorM3.toExponential(2)} м³.`;
    $('sedimentLayer').textContent=s.limitedSteps?`В ${s.limitedSteps} шагах перенос ограничен остатком слоя. Ниже исходного дна −0,5 м задано неразмываемое основание.`:'Однородный слой 0,5 м, пористость 40%. Грунт условный, не карта отложений Волги.';
  }
}
