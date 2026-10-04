// Scenario bed-load transport, SI units. Original MPM (8, 3/2, Shields 0.047)
// with an explicit, unmeasured grain-shear fraction. Not a cohesive-bank model.
const G=9.81, RHO=1000, S=2.65, POROSITY=.4;
export class Sediment2D {
  constructor(flow,options={}) {
    this.flow=flow;const n=flow.h.length;
    this.initialBed=flow.bed.slice();this.floor=Float64Array.from(flow.bed,z=>z-.5);
    for(const name of ['shear','mobility','qx','qy','fx','fy','west','outgoing','delta','factor'])this[name]=new Float64Array(n);
    this.boundarySolidVolume=0;this.incomingSolidVolume=0;this.outgoingSolidVolume=0;this.limitedSteps=0;this.steps=0;
    this.configure(options);this.history=[{time:flow.time,parameters:{...this.options}}];
  }
  configure({enabled=false,grainMm=1,grainFraction=.5,supply=1}={}) {
    if(typeof enabled!=='boolean'||![grainMm,grainFraction,supply].every(Number.isFinite)||grainMm<.5||grainMm>10||grainFraction<.1||grainFraction>1||supply<0||supply>2)throw Error('Invalid sediment scenario');
    const options={enabled,grainMm,grainFraction,supply};
    if(this.history&&JSON.stringify(options)!==JSON.stringify(this.options))this.history.push({time:this.flow.time,parameters:{...options}});
    this.options=options;this.criticalShear=.047*(S-1)*RHO*G*grainMm/1000;
  }
  capacity(h,u,v,n) {
    if(h<=.01)return {shear:0,ratio:0,qx:0,qy:0};
    const speed=Math.hypot(u,v),shear=RHO*G*n*n*speed*speed/Math.cbrt(h)*this.options.grainFraction;
    const d=this.options.grainMm/1000,theta=shear/((S-1)*RHO*G*d);
    const q=8*Math.sqrt((S-1)*G*d**3)*Math.max(0,theta-.047)**1.5;
    return {shear,ratio:shear/this.criticalShear,qx:speed?q*u/speed:0,qy:speed?q*v/speed:0};
  }
  prepare() {
    const f=this.flow,{width:w,height:h}=f;
    for(const a of [this.fx,this.fy,this.west,this.outgoing,this.delta])a.fill(0);
    for(const k of f.active){
      const c=this.capacity(f.h[k],f.h[k]>.01?f.hu[k]/f.h[k]:0,f.h[k]>.01?f.hv[k]/f.h[k]:0,f.roughness);
      this.shear[k]=c.shear;this.mobility[k]=c.ratio;
      const available=f.bed[k]-this.floor[k]>1e-12;
      this.qx[k]=available?c.qx:0;this.qy[k]=available?c.qy:0;
    }
    if(!this.options.enabled)return Infinity;
    // Oriented upwind solid-volume flux [m³/s] at each face. No flux through solids.
    const face=(a,b,axis)=>{
      const velocity=k=>f.h[k]>.01?(axis===0?f.hu[k]:f.hv[k])/f.h[k]:0;
      const direction=(velocity(a)+velocity(b))/2,donor=direction>=0?a:b;
      if(f.bed[donor]+f.h[donor]<=Math.max(f.bed[a],f.bed[b]))return 0; // cannot climb an unsubmerged step
      const q=(axis===0?this.qx:this.qy)[donor];
      const flux=(direction*q>0?q:0)*(axis===0?f.dy:f.dx);
      this.outgoing[flux>=0?a:b]+=Math.abs(flux);return flux;
    };
    for(const k of f.active){
      const x=k%w,y=Math.floor(k/w);
      if(x<w-1&&f.mask[k+1])this.fx[k]=face(k,k+1,0);
      else if(x===w-1&&f.outletLevel!==null&&(!f.outletMask||f.outletMask[k])){
        const q=this.qx[k]*f.dy;this.fx[k]=q>=0?q:q*this.options.supply;
        if(q>0)this.outgoing[k]+=q;
      }
      if(y<h-1&&f.mask[k+w])this.fy[k]=face(k,k+w,1);
      if(x===0&&f.inletQ!==null&&(!f.inletMask||f.inletMask[k])){
        // Sediment supplied at a prescribed water inflow uses its actual Q / width / h.
        const c=this.capacity(f.h[k],f.inletQ/(Math.max(1,f.inlets.length)*f.dy*Math.max(.01,f.h[k])),0,f.roughness);
        this.west[k]=Math.max(0,c.qx)*f.dy*this.options.supply;
      }
    }
    // Bound bed motion per hydraulic step; never accelerate morphology independently.
    for(const k of f.active){
      const x=k%w,y=Math.floor(k/w);
      this.delta[k]+=this.west[k]-this.fx[k]-this.fy[k];
      if(x<w-1&&f.mask[k+1])this.delta[k+1]+=this.fx[k];
      if(y<h-1&&f.mask[k+w])this.delta[k+w]+=this.fy[k];
    }
    let dt=Infinity;const bulk=(1-POROSITY)*f.dx*f.dy;
    for(const k of f.active)if(this.delta[k])dt=Math.min(dt,.02*Math.max(.01,f.h[k])*bulk/Math.abs(this.delta[k]));
    return dt;
  }
  step(dt) {
    if(!Number.isFinite(dt)||dt<=0)throw Error('Invalid sediment step');
    if(!this.options.enabled)return;
    const f=this.flow,w=f.width,bulk=(1-POROSITY)*f.dx*f.dy;let limited=false;
    this.delta.fill(0);
    for(const k of f.active){
      this.factor[k]=this.outgoing[k]?Math.min(1,Math.max(0,f.bed[k]-this.floor[k])*bulk/(dt*this.outgoing[k])):1;
      if(this.factor[k]<1-1e-10)limited=true;
    }
    const transfer=(a,b,q)=>{
      const donor=q>=0?a:b,volume=q*dt*(donor>=0?this.factor[donor]:1);
      if(a>=0)this.delta[a]-=volume;else{this.boundarySolidVolume+=volume;this.incomingSolidVolume+=Math.max(0,volume);this.outgoingSolidVolume+=Math.max(0,-volume);}
      if(b>=0)this.delta[b]+=volume;else{this.boundarySolidVolume-=volume;this.incomingSolidVolume+=Math.max(0,-volume);this.outgoingSolidVolume+=Math.max(0,volume);}
    };
    for(const k of f.active){const x=k%w,y=Math.floor(k/w);
      if(this.west[k])transfer(-1,k,this.west[k]);
      if(this.fx[k])transfer(k,x<w-1&&f.mask[k+1]?k+1:-1,this.fx[k]);
      if(this.fy[k])transfer(k,y<f.height-1&&f.mask[k+w]?k+w:-1,this.fy[k]);
    }
    for(const k of f.active)f.bed[k]+=this.delta[k]/bulk;
    // h and hu/hv remain conservative variables. Changed bed enters the next SWE
    // reconstruction; do not hold eta fixed by inventing/removing water here.
    this.steps++;if(limited)this.limitedSteps++;
  }
  snapshot() {
    const f=this.flow,change=Float32Array.from(f.bed,(z,k)=>z-this.initialBed[k]);
    let eroded=0,deposited=0,maxErosion=0,maxDeposition=0,mobile=0,wet=0,maxMobility=0,solidChange=0;
    for(const k of f.active){const dz=f.bed[k]-this.initialBed[k],bulk=dz*(1-POROSITY)*f.dx*f.dy;
      solidChange+=bulk;eroded+=Math.max(0,-bulk);deposited+=Math.max(0,bulk);maxErosion=Math.max(maxErosion,-dz);maxDeposition=Math.max(maxDeposition,dz);
      const c=this.capacity(f.h[k],f.h[k]>.01?f.hu[k]/f.h[k]:0,f.h[k]>.01?f.hv[k]/f.h[k]:0,f.roughness);
      this.shear[k]=c.shear;this.mobility[k]=c.ratio;
      if(f.h[k]>.01){wet++;if(c.ratio>1)mobile++;maxMobility=Math.max(maxMobility,c.ratio);}
    }
    return {change,shear:Float32Array.from(this.shear),mobility:Float32Array.from(this.mobility),parameters:{...this.options},history:this.history,porosity:POROSITY,initialLayer:.5,criticalShear:this.criticalShear,maxErosion,maxDeposition,erodedSolidM3:eroded,depositedSolidM3:deposited,boundarySolidM3:this.boundarySolidVolume,incomingSolidM3:this.incomingSolidVolume,outgoingSolidM3:this.outgoingSolidVolume,balanceErrorM3:solidChange-this.boundarySolidVolume,mobileAreaFraction:wet?mobile/wet:0,maxMobility,steps:this.steps,limitedSteps:this.limitedSteps};
  }
}
