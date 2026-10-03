// Finite-volume, hydrostatically reconstructed 2D shallow-water equations.
// h [m], hu/hv [m²/s], dx/dy [m], t [s]. Cartesian y points south.
// Rusanov flux + hydrostatic pressure correction; reflective solid banks.
const G=9.81, DRY=1e-6;
export class ShallowWater2D {
  constructor({width,height,dx,dy,bed,mask,level,inletQ=null,outletLevel=null,roughness=.03,initialDepth=null,inletMask=null,outletMask=null}) {
    if(![dx,dy,roughness].every(Number.isFinite)||roughness<0||(inletQ!==null&&(!Number.isFinite(inletQ)||inletQ<0))||(outletLevel!==null&&!Number.isFinite(outletLevel)))throw Error('Invalid flow boundary or roughness');
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||dx<=0||dy<=0||bed.length!==width*height||mask.length!==bed.length||!Number.isFinite(level))throw Error('Invalid shallow-water grid');
    Object.assign(this,{width,height,dx,dy,inletQ,outletLevel,roughness});
    for(const array of [initialDepth,inletMask,outletMask])if(array&&array.length!==bed.length)throw Error("Invalid initial/boundary mask");
    this.inletMask=inletMask;this.outletMask=outletMask;
    this.bed=Float64Array.from(bed);this.mask=Uint8Array.from(mask);
    this.h=new Float64Array(bed.length);this.hu=new Float64Array(bed.length);this.hv=new Float64Array(bed.length);
    this.dh=new Float64Array(bed.length);this.du=new Float64Array(bed.length);this.dv=new Float64Array(bed.length);
    this.active=[];this.inlets=[];this.time=0;this.boundaryVolume=0;this.roundoffVolume=0;
    for(let k=0;k<bed.length;k++)if(mask[k]){if(!Number.isFinite(bed[k]))throw Error('Non-finite bed');this.active.push(k);this.h[k]=initialDepth?initialDepth[k]:Math.max(0,level-bed[k]);if(!Number.isFinite(this.h[k])||this.h[k]<0)throw Error("Invalid initial depth");if(k%width===0&&(!inletMask||inletMask[k]))this.inlets.push(k);}
    this.initialVolume=this.volume();
  }
  volume(){let v=0;for(const k of this.active)v+=this.h[k]*this.dx*this.dy;return v;}
  stableDt(){
    let dt=Infinity;
    for(const k of this.active){const h=this.h[k];if(h<DRY)continue;const c=Math.sqrt(G*h),u=Math.abs(this.hu[k]/h),v=Math.abs(this.hv[k]/h);dt=Math.min(dt,.35/((u+c)/this.dx+(v+c)/this.dy));}
    if(this.inletQ>0&&this.inlets.length)for(const k of this.inlets){const h=Math.max(.05,this.h[k]),u=this.inletQ/(this.inlets.length*this.dy*h);dt=Math.min(dt,.25*this.dx/(u+Math.sqrt(G*h)));}
    return Math.min(5,dt);
  }
  // Update one oriented interface. Normal points east (axis=0) or south (axis=1).
  face(left,right,axis,dt,kind='normal') {
    const {h,hu,hv,bed,dh,du,dv}=this;
    const l=left>=0?left:right,r=right>=0?right:left;
    let hl=h[l],hr=h[r],ul=hl>DRY?hu[l]/hl:0,ur=hr>DRY?hu[r]/hr:0,vl=hl>DRY?hv[l]/hl:0,vr=hr>DRY?hv[r]/hr:0;
    let zl=bed[l],zr=bed[r];
    if(kind==='wall'){
      if(left<0){ul=axis===0?-ur:ur;vl=axis===1?-vr:vr;}
      else{ur=axis===0?-ul:ul;vr=axis===1?-vl:vl;}
    }else if(kind==='outlet'){
      hr=Math.max(0,this.outletLevel-zr); // prescribed downstream stage; extrapolate velocity
    }
    if(hl===0&&hr===0&&kind!=='inlet')return;
    const crest=Math.max(zl,zr),a=Math.max(0,hl+zl-crest),b=Math.max(0,hr+zr-crest);
    const unL=axis===0?ul:vl,unR=axis===0?ur:vr,utL=axis===0?vl:ul,utR=axis===0?vr:ur;
    const speed=Math.max(Math.abs(unL)+Math.sqrt(G*a),Math.abs(unR)+Math.sqrt(G*b));
    let fm=.5*(a*unL+b*unR)-.5*speed*(b-a);
    let fn=.5*(a*unL*unL+.5*G*a*a+b*unR*unR+.5*G*b*b)-.5*speed*(b*unR-a*unL);
    let ft=.5*(a*unL*utL+b*unR*utR)-.5*speed*(b*utR-a*utL);
    if(kind==='inlet'){
      fm=this.inletQ/(this.inlets.length*this.dy);
      fn=fm*fm/Math.max(hr,.05)+.5*G*hr*hr;ft=0;
    }
    const factor=dt/(axis===0?this.dx:this.dy);
    if(left>=0){dh[left]-=factor*fm;const pressure=fn+.5*G*(hl*hl-a*a);du[left]-=factor*(axis===0?pressure:ft);dv[left]-=factor*(axis===0?ft:pressure);}
    if(right>=0){dh[right]+=factor*fm;const pressure=fn+.5*G*(hr*hr-b*b);du[right]+=factor*(axis===0?pressure:ft);dv[right]+=factor*(axis===0?ft:pressure);}
    if(left<0)this.boundaryVolume+=fm*dt*(axis===0?this.dy:this.dx);
    if(right<0)this.boundaryVolume-=fm*dt*(axis===0?this.dy:this.dx);
  }
  step(maxDt=5){
    if(!Number.isFinite(maxDt)||maxDt<=0)throw Error('Invalid time step');
    const dt=Math.min(maxDt,this.stableDt()),w=this.width,h=this.height;
    this.dh.fill(0);this.du.fill(0);this.dv.fill(0);
    for(const k of this.active){
      const x=k%w,y=Math.floor(k/w);
      if(x<w-1&&this.mask[k+1])this.face(k,k+1,0,dt);
      else this.face(k,-1,0,dt,x===w-1&&this.outletLevel!==null&&(!this.outletMask||this.outletMask[k])?'outlet':'wall');
      if(y<h-1&&this.mask[k+w])this.face(k,k+w,1,dt);else this.face(k,-1,1,dt,'wall');
      if(x===0||!this.mask[k-1])this.face(-1,k,0,dt,x===0&&this.inletQ!==null&&(!this.inletMask||this.inletMask[k])?'inlet':'wall');
      if(y===0||!this.mask[k-w])this.face(-1,k,1,dt,'wall');
    }
    for(const k of this.active){
      const next=this.h[k]+this.dh[k];
      if(next< -1e-8||!Number.isFinite(next))throw Error('Positivity/CFL failure');
      if(next<0)this.roundoffVolume-=next*this.dx*this.dy;
      this.h[k]=Math.max(0,next);this.hu[k]+=this.du[k];this.hv[k]+=this.dv[k];
      if(this.h[k]<DRY){this.hu[k]=0;this.hv[k]=0;continue;}
      const speed=Math.hypot(this.hu[k],this.hv[k])/this.h[k];
      const friction=1+dt*G*this.roughness**2*speed/this.h[k]**(4/3);
      this.hu[k]/=friction;this.hv[k]/=friction;
      if(!Number.isFinite(this.hu[k])||!Number.isFinite(this.hv[k]))throw Error('Non-finite momentum');
    }
    this.time+=dt;return dt;
  }
  diagnostics(){
    const volume=this.volume(),expected=this.initialVolume+this.boundaryVolume+this.roundoffVolume;
    let maxSpeed=0,minDepth=Infinity;
    for(const k of this.active){minDepth=Math.min(minDepth,this.h[k]);if(this.h[k]>DRY)maxSpeed=Math.max(maxSpeed,Math.hypot(this.hu[k],this.hv[k])/this.h[k]);}
    return {time:this.time,volume,expectedVolume:expected,boundaryVolume:this.boundaryVolume,balanceError:volume-expected,relativeBalanceError:Math.abs(volume-expected)/Math.max(1,this.initialVolume),roundoffVolume:this.roundoffVolume,maxSpeed,minDepth};
  }
}
