// Cosmetic burrow art. Rabbit identities, destinations and phases come from
// the shared server; this module never teleports or creates a rabbit.
export const burrowDurations={entering:.9,underground:2,emerging:.9};
const clamp=value=>Math.max(0,Math.min(1,value));
export function burrowPose(rabbit,reducedMotion=false) {
  const trip=rabbit.burrow;
  if(!trip)return {visible:true,depth:0,opacity:1};
  if(trip.phase==='underground')return {visible:false,depth:1,opacity:0};
  const progress=clamp(1-trip.remaining/burrowDurations[trip.phase]);
  const eased=progress*progress*(3-2*progress);
  const depth=trip.phase==='entering'?eased:1-eased;
  return {visible:depth<1,depth:reducedMotion?0:depth,opacity:reducedMotion?1-depth:1};
}
function oval(c,x,y,rx,ry,color,angle=0){c.beginPath();c.ellipse(x,y,rx,ry,angle,0,Math.PI*2);c.fillStyle=color;c.fill();}
function rim(c,x,y){
  c.save();c.lineCap='round';
  // The front wall covers the rabbit as it sinks; its lit edge stays thin.
  c.beginPath();c.ellipse(x+1,y+2,28,9,0,.02,Math.PI-.02);c.strokeStyle='#8c8259';c.lineWidth=6;c.stroke();
  c.beginPath();c.ellipse(x,y,27,9,0,.06,Math.PI-.06);c.strokeStyle='#b39f70';c.lineWidth=4;c.stroke();
  c.beginPath();c.ellipse(x-1,y,27,9,0,.5,Math.PI-.08);c.strokeStyle='#c9b282';c.lineWidth=1.8;c.stroke();
  oval(c,x-21,y+6,3.5,1,'#deca9a',-.22);
  c.restore();
}
function grassClump(c,x,y,size,sway){
  c.save();c.translate(x,y);c.scale(size,size);
  for(const [dx,dy,bend,color] of [[-5,-7,-7,'#68815b'],[0,-11,-2,'#829767'],[4,-8,6,'#95a674']]){
    c.beginPath();c.moveTo(dx-2,2);
    c.quadraticCurveTo(dx+bend+sway,dy*.55,dx+bend*.55+sway,dy);
    c.quadraticCurveTo(dx+3+sway*.3,dy*.55,dx+2,2);
    c.fillStyle=color;c.fill();
  }
  c.restore();
}
function flower(c,x,y,size){
  c.beginPath();c.moveTo(x,y+5*size);c.quadraticCurveTo(x-2*size,y+2*size,x,y);
  c.strokeStyle='#71885c';c.lineWidth=1;c.stroke();
  for(let i=0;i<5;i++){
    const angle=i*Math.PI*2/5;
    oval(c,x+Math.cos(angle)*1.7*size,y+Math.sin(angle)*1.7*size,1.6*size,1.2*size,'#e9e4c7',angle);
  }
  oval(c,x,y,size,size,'#c5a969');
}
export function drawBurrows(c,state,{width,height,reducedMotion=false}) {
  for(const hole of state.burrows||[]){
    const x=hole.x*width/1000,y=hole.y*height/600;
    const entering=state.rabbits.some(r=>r.burrow?.entryId===hole.id&&r.burrow.phase==='entering');
    const emerging=state.rabbits.some(r=>r.burrow?.exitId===hole.id&&r.burrow.phase==='emerging');
    c.save();
    // Small, offset layers keep the earth grounded without a blurred canvas filter.
    oval(c,x+5,y+7,43,16,'#3249360c');
    oval(c,x+4,y+7,36,12,'#32493616');
    oval(c,x+2,y+5,32,11,'#32493620');
    oval(c,x-1,y-2,36,17,'#98a177');
    oval(c,x+1,y,33,15,'#a49a6c');
    oval(c,x-2,y-3,32,13,'#c0ac7c');
    oval(c,x-5,y-6,24,8,'#c9b282');
    // One quiet crescent catches the same upper-left sunlight as the meadow.
    c.beginPath();c.ellipse(x-2,y-3,32,13,0,Math.PI*1.08,Math.PI*1.77);
    c.strokeStyle='#dcc798';c.lineWidth=1.7;c.stroke();
    const sway=(entering||emerging)&&!reducedMotion?Math.sin(state.time*9+hole.id)*1.1:0;
    grassClump(c,x-29,y-7,.85,sway);
    grassClump(c,x+25,y-11,.72,-sway*.7);
    grassClump(c,x+34,y+1,.6,sway*.5);
    // The uninterrupted dark center keeps each entrance easy to read.
    oval(c,x,y,27,10,'#77734f');
    oval(c,x+1,y+1,25,8.5,'#3e5039');
    oval(c,x+1,y-1,22.5,6.7,'#324936');
    oval(c,x+2,y-3,18,3.7,'#2b402f');
    rim(c,x,y);
    for(const [dx,dy,r] of [[-29,8,3],[27,9,2.6],[34,4,1.8],[-20,13,1.6]]){
      oval(c,x+dx+1,y+dy+1,r*1.15,r*.6,'#32493624');
      oval(c,x+dx,y+dy,r,r*.65,'#ae9e70',-.2);
      oval(c,x+dx-.5,y+dy-.6,r*.7,r*.25,'#d0bc8d',-.2);
    }
    flower(c,x-35,y-7,.8);
    if(hole.id%2)flower(c,x+32,y-11,.65);
    c.restore();
  }
}
export function drawBurrowRabbit(c,rabbit,time,drawRabbit,{reducedMotion=false}={}) {
  const pose=burrowPose(rabbit,reducedMotion);
  if(!pose.visible)return;
  if(!rabbit.burrow){drawRabbit(c,rabbit,time);return;}
  c.save();c.globalAlpha=pose.opacity;
  // Sink below the front lip: ears disappear last and emerge first.
  c.beginPath();c.moveTo(rabbit.x-55,rabbit.y-100);c.lineTo(rabbit.x+55,rabbit.y-100);
  c.lineTo(rabbit.x+55,rabbit.y);c.lineTo(rabbit.x+26,rabbit.y);
  c.ellipse(rabbit.x,rabbit.y,26,8,0,0,Math.PI);c.lineTo(rabbit.x-55,rabbit.y);c.closePath();c.clip();
  const depth=pose.depth*(rabbit.adult?77:59)*(rabbit.renderScale||1);
  drawRabbit(c,{...rabbit,y:rabbit.y+depth,moving:false,motionAmount:0,hopProgress:0},time,{shadow:false});
  c.restore();rim(c,rabbit.x,rabbit.y);
}
