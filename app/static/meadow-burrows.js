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
  c.beginPath();c.ellipse(x,y,27,9,0,0,Math.PI);c.strokeStyle='#a48a55';c.lineWidth=5;c.stroke();
  c.beginPath();c.ellipse(x,y+1,28,9,0,.1,Math.PI-.1);c.strokeStyle='#c8b780';c.lineWidth=2;c.stroke();
}
export function drawBurrows(c,state,{width,height,reducedMotion=false}) {
  for(const hole of state.burrows||[]){
    const x=hole.x*width/1000,y=hole.y*height/600;
    const entering=state.rabbits.some(r=>r.burrow?.entryId===hole.id&&r.burrow.phase==='entering');
    const emerging=state.rabbits.some(r=>r.burrow?.exitId===hole.id&&r.burrow.phase==='emerging');
    c.save();
    oval(c,x,y+5,40,14,'#78925524');
    oval(c,x-1,y-3,34,17,'#b3b37b');oval(c,x,y-1,31,13,'#c8b27a');
    oval(c,x,y,27,10,'#69573b');oval(c,x,y+1,23,7,'#3d3f2c');
    oval(c,x-4,y-3,18,3,'#4b482f');
    rim(c,x,y);
    for(let i=0;i<9;i++){
      const px=x-34+i*8,py=y-10-Math.abs(i-4)*.65;
      const sway=(entering||emerging)&&!reducedMotion?Math.sin(state.time*11+i)*1.8:0;
      c.beginPath();c.moveTo(px-3,py+4);c.quadraticCurveTo(px-5+sway,py-1,px-3+sway,py-8-i%3*2);
      c.quadraticCurveTo(px+1,py-2,px,py+4);c.fillStyle=i%2?'#819d58':'#93ac67';c.fill();
    }
    for(const [dx,dy,r] of [[-29,8,3],[26,9,2.8],[34,3,2],[-20,13,1.8]])oval(c,x+dx,y+dy,r,r*.6,'#b49d68');
    // A tiny clover makes these little homes recognizable without labels.
    for(let i=0;i<3;i++)oval(c,x+28+Math.cos(i*2.1)*3,y-15+Math.sin(i*2.1)*3,3,2.6,'#658448');
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
  const depth=pose.depth*(rabbit.adult?77:59);
  drawRabbit(c,{...rabbit,y:rabbit.y+depth,moving:false,motionAmount:0,hopProgress:0},time,{shadow:false});
  c.restore();rim(c,rabbit.x,rabbit.y);
}
