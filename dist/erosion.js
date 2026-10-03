// Deterministic, qualitative erosion/deposition on the original DEM grid.
// Heights are metres. Seeking always starts from the unchanged source surface.
export class TerrainEvolution {
  constructor(meta, source) {
    this.meta=meta;this.base=new Float32Array(source);this.current=new Float32Array(source);
    this.changed=[];this.delta=new Float32Array(source.length);
    const [w,s,e,n]=meta.bounds;
    this.w=w;this.n=n;this.dx=(e-w)/(meta.width-1);this.dy=(n-s)/(meta.height-1);
    this.mx=111320*Math.cos((n+s)*Math.PI/360);this.my=111320;
  }
  reset(){for(const i of this.changed){this.current[i]=this.base[i];this.delta[i]=0}this.changed=[];return this.current}
  apply(reaches, year, sediment) {
    this.reset();if(year<=0)return this.current;
    const erosion=new Map(),deposit=new Map();const growth=1-Math.exp(-year/85);
    const stamp=(lon,lat,radius,amplitude,target,bed=null)=>{
      const x=(lon-this.w)/this.dx,y=(this.n-lat)/this.dy;
      const rx=radius/(this.dx*this.mx),ry=radius/(this.dy*this.my);
      const xmin=Math.max(1,Math.floor(x-rx)),xmax=Math.min(this.meta.width-2,Math.ceil(x+rx));
      const ymin=Math.max(1,Math.floor(y-ry)),ymax=Math.min(this.meta.height-2,Math.ceil(y+ry));
      for(let j=ymin;j<=ymax;j++)for(let i=xmin;i<=xmax;i++){
        const d=((i-x)/rx)**2+((j-y)/ry)**2;if(d>=1)continue;
        const k=j*this.meta.width+i,weight=bed===null?(1-d)**2:Math.min(1,(1-Math.sqrt(d))/.55);
        const requested=bed===null?amplitude:Math.max(amplitude,(this.base[k]-bed)*Math.min(1,year/30));
        const v=Math.max(0,requested)*weight;
        if(v>(target.get(k)||0))target.set(k,v);
      }
    };
    for(const reach of reaches){
      const radius=reach.volga?140:65;
      for(let i=1;i<reach.original.length-1;i++){
        const a=reach.original[i],b=reach.moved[i];
        const mx=(b[0]-a[0])*this.mx,my=(b[1]-a[1])*this.my,motion=Math.hypot(mx,my);
        if(motion<.15)continue;
        const strength=growth*Math.min(1,motion/25),depth=(reach.volga?5:11)*strength;
        // Sweep the cut across the migrating channel; rebuild bars on the vacated side.
        for(const t of [.35,.7,1])stamp(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,radius,depth*t,erosion,reach.levels?.[i]);
        stamp(a[0]-(b[0]-a[0])*.4,a[1]-(b[1]-a[1])*.4,radius*.8,5*strength*sediment,deposit);
      }
    }
    const indices=new Set([...erosion.keys(),...deposit.keys()]);
    for(const k of indices){const d=Math.max(-60,Math.min(7,(deposit.get(k)||0)-(erosion.get(k)||0)));if(Math.abs(d)<.002)continue;this.delta[k]=d;this.current[k]=this.base[k]+d;this.changed.push(k)}
    return this.current;
  }
  stats(){let cut=0,fill=0;for(const i of this.changed){cut=Math.min(cut,this.delta[i]);fill=Math.max(fill,this.delta[i])}return {cells:this.changed.length,cut:-cut,fill}}
}
