import * as THREE from './vendor/three/three.module.min.js';

// Stylized concept models, not representations of an actual product SKU.
export function createShowroom(container, reduced, onLost) {
  const canvas = container.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true, powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.65;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, .1, 60);
  camera.position.set(0, .6, 9.5);
  camera.lookAt(0, .1, 0);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x212530, 3));
  const light = (color, intensity, position) => {
    const l = new THREE.DirectionalLight(color, intensity); l.position.set(...position); scene.add(l);
  };
  light(0xffffff, 5, [3,5,4]); light(0xff602b, 4, [-4,1,1]); light(0x87bcff, 4, [1,3,-4]);
  const mat = (color, metalness=.3, roughness=.35) => new THREE.MeshStandardMaterial({color,metalness,roughness});
  const orange=mat(0xff642b,.45,.28), dark=mat(0x262a32,.5,.35), silver=mat(0xb4c1ce,.85,.25), rubber=mat(0x131719,.05,.7), cream=mat(0xece6d7,.15,.36);
  function mesh(group, geometry, material, pos=[0,0,0], rotation=[0,0,0]) {
    const m = new THREE.Mesh(geometry,material); m.position.set(...pos); m.rotation.set(...rotation); group.add(m); return m;
  }
  const box=(g,x,y,z,m,p,r)=>mesh(g,new THREE.BoxGeometry(x,y,z),m,p,r);
  const cylinder=(g,r1,r2,h,m,p,r)=>mesh(g,new THREE.CylinderGeometry(r1,r2,h,48),m,p,r);
  const torus=(g,r,t,m,p,rot)=>mesh(g,new THREE.TorusGeometry(r,t,10,56),m,p,rot);
  const models = [];
  const dumbbell = new THREE.Group();
  cylinder(dumbbell,.15,.15,2.6,silver,[0,0,0],[0,0,Math.PI/2]);
  cylinder(dumbbell,.18,.18,1.1,rubber,[0,0,0],[0,0,Math.PI/2]);
  for(let i=-5;i<=5;i++) torus(dumbbell,.18,.012,silver,[i*.09,0,0],[0,Math.PI/2,0]);
  for(const side of [-1,1]) {
    for(let i=0;i<3;i++) cylinder(dumbbell,.68-i*.07,.68-i*.07,.22,i===1?orange:dark,[side*(.86+i*.24),0,0],[0,0,Math.PI/2]);
    cylinder(dumbbell,.26,.26,.1,silver,[side*1.59,0,0],[0,0,Math.PI/2]);
    torus(dumbbell,.44,.018,orange,[side*1.52,0,0],[0,Math.PI/2,0]);
  }
  dumbbell.rotation.set(.15,.2,-.38); dumbbell.scale.setScalar(1.22); models.push(dumbbell);

  const rod = new THREE.Group();
  cylinder(rod,.032,.065,4.6,dark,[0,.2,0]);
  cylinder(rod,.085,.085,.8,rubber,[0,-1.8,0]);
  cylinder(rod,.09,.09,.08,orange,[0,-1.35,0]);
  cylinder(rod,.095,.095,.07,silver,[0,-2.24,0]);
  box(rod,.08,.36,.12,silver,[.15,-1.03,0]);
  cylinder(rod,.25,.25,.28,orange,[.35,-.96,.12],[Math.PI/2,0,0]);
  cylinder(rod,.18,.18,.33,silver,[.35,-.96,.12],[Math.PI/2,0,0]);
  torus(rod,.3,.025,silver,[.35,-.96,.18]);
  box(rod,.4,.045,.045,silver,[.51,-.96,-.2]);
  cylinder(rod,.065,.065,.22,rubber,[.73,-.96,-.2]);
  for(let i=0;i<6;i++) torus(rod,.095-i*.01,.013,silver,[.09,.0+i*.45,0],[0,Math.PI/2,0]);
  const linePoints=[new THREE.Vector3(.35,-.8,0),...Array.from({length:6},(_,i)=>new THREE.Vector3(.13,i*.45,0))];
  rod.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePoints),new THREE.LineBasicMaterial({color:0xa4b7b1,transparent:true,opacity:.7})));
  rod.rotation.set(.1,.2,-.56); models.push(rod);

  const guitar = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0,-1.7); shape.bezierCurveTo(-1.2,-1.8,-1.2,-.65,-.68,-.35);
  shape.bezierCurveTo(-.45,-.15,-.6,.55,-.33,.58); shape.lineTo(-.17,.1); shape.lineTo(.18,.1);
  shape.bezierCurveTo(.6,.75,.77,.68,.6,.1); shape.bezierCurveTo(.37,-.4,1.08,-.5,1,-1.1); shape.bezierCurveTo(.97,-1.6,.45,-1.78,0,-1.7);
  const bodyGeo=new THREE.ExtrudeGeometry(shape,{depth:.22,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.08,bevelThickness:.07,curveSegments:24});
  mesh(guitar,bodyGeo,orange,[0,.2,0]);
  box(guitar,.24,2.05,.15,mat(0x75462e,.05,.5),[0,1.03,.02]);
  box(guitar,.21,2,.045,dark,[0,1.03,.13]);
  box(guitar,.3,.53,.16,cream,[.035,2.25,.02],[0,0,-.13]);
  for(let i=0;i<16;i++) box(guitar,.22,.012,.008,silver,[0,.16+i*.117,.161]);
  for(const y of [-.72,-.4,-.07]) box(guitar,.47,.105,.07,cream,[0,y,.34]);
  box(guitar,.43,.16,.07,silver,[0,-.96,.34]);
  for(let i=0;i<6;i++) {
    box(guitar,.004,3.2,.004,silver,[-.075+i*.03,.62,.39]);
    cylinder(guitar,.046,.046,.13,silver,[i%2 ? .23 : -.17,2.08+Math.floor(i/2)*.14,0],[0,0,Math.PI/2]);
  }
  for(const p of [[.55,-.73,.35],[.62,-.95,.35]]) cylinder(guitar,.064,.064,.065,silver,p,[Math.PI/2,0,0]);
  guitar.rotation.set(-.1,-.32,.34); guitar.position.y=-.3; models.push(guitar);
  const rig=new THREE.Group(); scene.add(rig); models.forEach((g,i)=>{g.visible=i===0;rig.add(g);});
  const halo=torus(scene,2.85,.008,mat(0x65717d,.5,.55),[0,0,-1.2],[.2,.2,0]);
  const ring2=torus(scene,3.15,.004,mat(0x4b5259),[0,0,-1.3],[.2,.2,0]);
  let playing=!reduced, visible=true, lost=false, raf=0, last=0, angle=0, tilt=0, dragging=false, previous=0;
  function draw(){rig.rotation.set(tilt,angle,0);renderer.render(scene,camera);}
  function frame(now){
    raf=0;
    if(!playing || !visible || document.hidden || lost)return;
    if(now-last>=1000/30){angle+=Math.min((now-last)/1000,.05)*.28; last=now; draw();}
    raf=requestAnimationFrame(frame);
  }
  function sync(){cancelAnimationFrame(raf);raf=0;last=performance.now();if(playing&&visible&&!document.hidden&&!lost)raf=requestAnimationFrame(frame);}
  function resize(){const {width,height}=canvas.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height,false);camera.aspect=width/height;camera.position.z=width<420?11.5:9.5;camera.updateProjectionMatrix();draw();}
  const observer=new ResizeObserver(resize); observer.observe(canvas);
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();});intersection.observe(container);
  document.addEventListener('visibilitychange',sync);
  canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;dragging=true;previous=e.clientX;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!dragging)return;angle+=(e.clientX-previous)*.01;previous=e.clientX;draw();});
  const end=()=>{dragging=false;};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
  canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();if(e.key==='Home'){angle=0;tilt=0;}else if(e.key==='ArrowLeft')angle-=.15;else if(e.key==='ArrowRight')angle+=.15;else tilt=THREE.MathUtils.clamp(tilt+(e.key==='ArrowUp'?.1:-.1),-.6,.6);draw();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;sync();onLost();});
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);},{once:true});
  window.addEventListener('pageshow',sync);
  resize();sync();
  return {
    select(index){models.forEach((g,i)=>{g.visible=i===index;});angle=0;tilt=0;draw();},
    setPlaying(value){playing=value;sync();},isPlaying(){return playing;}
  };
}
