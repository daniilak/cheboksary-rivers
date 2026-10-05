import * as THREE from 'three';

// Only the appearance is animated here. Heights, wet cells and velocities come
// from the hydraulic solver; optical ripples never change its water balance.
export function waterGeometry(field, xy, elevation, colorAt) {
  const {width,height,depth,eta,mask,u,v}=field;
  const stride=width+1,count=stride*(height+1);
  const level=new Float64Array(count),wetDepth=new Float64Array(count);
  const vx=new Float64Array(count),vz=new Float64Array(count),weights=new Uint8Array(count);
  const cells=[];
  for(let k=0;k<mask.length;k++){
    if(!mask[k]||depth[k]<=.05)continue;
    cells.push(k);
    const corner=Math.floor(k/width)*stride+k%width;
    for(const c of [corner,corner+1,corner+stride,corner+stride+1]){
      level[c]+=eta[k];wetDepth[c]+=depth[k];vx[c]+=u[k];vz[c]+=v[k];weights[c]++;
    }
  }
  const positions=new Float32Array(cells.length*18),colors=new Float32Array(positions.length);
  const depths=new Float32Array(cells.length*6),velocities=new Float32Array(cells.length*12);
  const [west,south,east,north]=field.bounds;
  for(let i=0;i<cells.length;i++){
    const k=cells[i],corner=Math.floor(k/width)*stride+k%width,color=colorAt(k);
    // Keep two triangles per cell so wave-source picking still resolves the
    // original solver cell. Adjacent tiles share the same corner elevations.
    const corners=[corner,corner+stride,corner+1,corner+1,corner+stride,corner+stride+1];
    for(let j=0;j<6;j++){
      const c=corners[j],n=weights[c],vertex=i*6+j;
      const [x,z]=xy(west+(c%stride)/width*(east-west),north-Math.floor(c/stride)/height*(north-south));
      positions.set([x,elevation(level[c]/n)+.0002,z],vertex*3);
      color.toArray(colors,vertex*3);depths[vertex]=wetDepth[c]/n;
      // Grid v points south; world z has that same sign.
      velocities.set([vx[c]/n,vz[c]/n],vertex*2);
    }
  }
  return {cells,positions,colors,depths,velocities};
}

const vertexShader=`
  attribute float waterDepth;
  attribute vec2 waterVelocity;
  varying vec3 vWorld;
  varying vec3 vTint;
  varying float vDepth;
  varying vec2 vFlow;
  void main(){
    vec4 world=modelMatrix*vec4(position,1.0);
    vWorld=world.xyz;vTint=color;vDepth=waterDepth;vFlow=waterVelocity;
    gl_Position=projectionMatrix*viewMatrix*world;
  }
`;
const fragmentShader=`
  uniform float uTime;
  uniform float uDiagnostic;
  uniform float uHasBackground;
  uniform vec2 uResolution;
  uniform sampler2D uBackground;
  uniform sampler2D uBackgroundDepth;
  uniform float uNear;
  uniform float uFar;
  varying vec3 vWorld;
  varying vec3 vTint;
  varying float vDepth;
  varying vec2 vFlow;
  #include <common>
  #include <packing>
  float noise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    vec3 q=fract(vec3(i.xyx)*.1031);q+=dot(q,q.yzx+33.33);
    float a=fract((q.x+q.y)*q.z);
    q=fract(vec3((i+vec2(1.0,0.0)).xyx)*.1031);q+=dot(q,q.yzx+33.33);
    float b=fract((q.x+q.y)*q.z);
    q=fract(vec3((i+vec2(0.0,1.0)).xyx)*.1031);q+=dot(q,q.yzx+33.33);
    float c=fract((q.x+q.y)*q.z);
    q=fract(vec3((i+vec2(1.0)).xyx)*.1031);q+=dot(q,q.yzx+33.33);
    float d=fract((q.x+q.y)*q.z);
    return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
  }
  vec2 ripple(vec2 p,vec2 direction,float frequency,float phase,float strength){
    float angle=dot(p,direction)*frequency+phase;
    // Fade subpixel waves instead of allowing moire at the city-wide scale.
    float visible=1.0-smoothstep(.5,2.5,fwidth(angle));
    return direction*cos(angle)*strength*visible;
  }
  void main(){
    vec3 normal=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
    if(normal.y<0.0)normal=-normal;
    vec2 p=vWorld.xz-vFlow*uTime*.025;
    float shallow=smoothstep(.05,.8,vDepth);
    float warp=noise(p*19.0)*4.0+noise(p*47.0)*1.4;
    vec2 slope=ripple(p,normalize(vec2(.9,.35)),210.0,-uTime*1.4+warp,.14)
      +ripple(p,normalize(vec2(-.4,.92)),340.0,uTime*1.1-warp,.07)
      +ripple(p,normalize(vec2(.65,-.76)),95.0,-uTime*.65+warp*.7,.09);
    normal=normalize(normal+vec3(slope.x,0.0,slope.y)*shallow);
    vec3 eye=normalize(cameraPosition-vWorld);
    vec3 sun=normalize(vec3(-12.0,23.0,-8.0));
    float facing=max(dot(normal,eye),0.0);
    float fresnel=.025+.975*pow(1.0-facing,5.0);
    vec3 reflected=reflect(-eye,normal);
    vec3 sky=mix(vec3(.69,.78,.72),vec3(.42,.64,.73),smoothstep(0.0,.85,reflected.y));
    sky+=vec3(.10)*smoothstep(.48,.8,noise(reflected.xz*5.0));
    float glint=pow(max(dot(reflect(-sun,normal),eye),0.0),160.0);
    vec2 uv=gl_FragCoord.xy/uResolution;
    vec3 viewNormal=mat3(viewMatrix)*normal;
    vec2 refracted=clamp(uv+viewNormal.xy*.012*shallow,vec2(.001),vec2(.999));
    float sceneZ=perspectiveDepthToViewZ(texture2D(uBackgroundDepth,refracted).x,uNear,uFar);
    float surfaceZ=perspectiveDepthToViewZ(gl_FragCoord.z,uNear,uFar);
    // Do not drag above-water banks/buildings into the underwater image.
    if(sceneZ>surfaceZ+.0001)refracted=uv;
    vec3 bottom=texture2D(uBackground,refracted).rgb;
    vec3 transmission=exp(-vec3(.40,.16,.11)*max(vDepth,0.0));
    vec3 body=vec3(.025,.20,.21);
    vec3 water=bottom*transmission+body*(1.0-transmission);
    // Subtle light focusing on shallow beds; a visual cue, not a bed process.
    float caustic=pow(max(0.0,sin(p.x*260.0+sin(p.y*170.0+uTime*.5))
      *sin(p.y*240.0+sin(p.x*150.0-uTime*.4))),9.0);
    water+=vec3(.12,.15,.10)*caustic*exp(-vDepth*.8)*shallow;
    water=mix(water,sky,fresnel*.72)+vec3(1.0,.92,.73)*glint*.65;
    water*=.96+.10*dot(normal,sun);
    if(uHasBackground<.5)water=mix(body,sky,fresnel*.72)+glint*.4;
    // Scientific overlays remain opaque and retain each cell's own color.
    water=mix(water,vTint*(.94+.06*max(dot(normal,sun),0.0)),uDiagnostic);
    gl_FragColor=vec4(water,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class WaterSurface {
  constructor(group){
    this.group=group;this.time=0;this.background=null;
    this.material=new THREE.ShaderMaterial({vertexShader,fragmentShader,vertexColors:true,side:THREE.DoubleSide,
      uniforms:{uTime:{value:0},uDiagnostic:{value:0},uHasBackground:{value:0},uResolution:{value:new THREE.Vector2(1,1)},
        uBackground:{value:null},uBackgroundDepth:{value:null},uNear:{value:.02},uFar:{value:180}}});
  }
  update(field,xy,elevation,colorAt,diagnostic){
    const data=waterGeometry(field,xy,elevation,colorAt);
    if(!this.mesh){this.mesh=new THREE.Mesh(new THREE.BufferGeometry(),this.material);this.group.add(this.mesh);}
    const g=this.mesh.geometry;
    for(const [name,array,size] of [['position',data.positions,3],['color',data.colors,3],['waterDepth',data.depths,1],['waterVelocity',data.velocities,2]]){
      const old=g.getAttribute(name);
      if(old?.array.length===array.length){old.array.set(array);old.needsUpdate=true;}
      else g.setAttribute(name,new THREE.BufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
    }
    g.computeBoundingSphere();this.mesh.userData.cells=data.cells;
    this.material.uniforms.uDiagnostic.value=diagnostic?1:0;
    return this.mesh;
  }
  animate(dt,running){if(running)this.time+=dt;this.material.uniforms.uTime.value=this.time;}
  reset(){if(this.mesh){this.group.remove(this.mesh);this.mesh.geometry.dispose();this.mesh=null;}this.time=0;}
  render(renderer,scene,camera){
    const mesh=this.mesh;
    if(!mesh?.visible||!this.group.visible||this.material.uniforms.uDiagnostic.value===1){renderer.render(scene,camera);return;}
    const size=renderer.getDrawingBufferSize(new THREE.Vector2());
    if(!this.background){
      this.background=new THREE.WebGLRenderTarget(size.x,size.y,{depthBuffer:true});
      this.background.depthTexture=new THREE.DepthTexture(size.x,size.y);
    }else if(this.background.width!==size.x||this.background.height!==size.y)this.background.setSize(size.x,size.y);
    const uniforms=this.material.uniforms;
    uniforms.uResolution.value.copy(size);uniforms.uNear.value=camera.near;uniforms.uFar.value=camera.far;
    const previous=renderer.getRenderTarget();
    mesh.visible=false;
    try{renderer.setRenderTarget(this.background);renderer.render(scene,camera);}
    finally{mesh.visible=true;renderer.setRenderTarget(previous);}
    uniforms.uBackground.value=this.background.texture;uniforms.uBackgroundDepth.value=this.background.depthTexture;uniforms.uHasBackground.value=1;
    renderer.render(scene,camera);
  }
}
