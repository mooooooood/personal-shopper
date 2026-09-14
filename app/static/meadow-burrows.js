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
const snap=n=>Math.round(n/3)*3;
function rect(c,x,y,w,h,color){
  const x0=snap(x),y0=snap(y);
  c.fillStyle=color;c.fillRect(x0,y0,Math.max(3,snap(x+w)-x0),Math.max(3,snap(y+h)-y0));
}
function steppedOval(c,x,y,rows,color){
  for(const [left,top,width,height] of rows)rect(c,x+left,y+top,width,height,color);
}
function rim(c,x,y){
  // Five square steps form the front earth wall, which covers the sinking rabbit.
  for(const [dx,dy,w,h] of [[-30,0,6,9],[-27,6,12,6],[-18,9,36,6],[15,6,12,6],[24,0,6,9]])
    rect(c,x+dx,y+dy,w,h,'#8d7951');
  for(const [dx,dy,w,h] of [[-30,0,3,6],[-27,6,12,3],[-18,9,36,3],[15,6,12,3],[27,0,3,6]])
    rect(c,x+dx,y+dy,w,h,'#c5b383');
  rect(c,x-24,y+6,9,3,'#e0cc99');rect(c,x-15,y+9,15,3,'#d5c493');
}
function grassClump(c,x,y,size,sway){
  const shift=Math.abs(sway)>.5?Math.sign(sway)*3:0;
  rect(c,x-6,y-6*size,3,6*size,'#577648');
  rect(c,x-6+shift,y-9*size,3,3,'#6c8c50');
  rect(c,x,y-12*size,3,12*size,'#6c8c50');
  rect(c,x+shift,y-15*size,3,3,'#839e59');
  rect(c,x+6,y-9*size,3,9*size,'#839e59');
  rect(c,x-3,y-3,9,3,'#6c8c50');
}
function flower(c,x,y){
  rect(c,x,y,3,9,'#6c8c50');rect(c,x-3,y+6,3,3,'#839e59');
  rect(c,x-3,y-3,9,3,'#f5e4b3');rect(c,x,y-6,3,9,'#f5e4b3');
  rect(c,x,y-3,3,3,'#c6994e');
}
export function drawBurrows(c,state,{width,height,reducedMotion=false}) {
  for(const hole of state.burrows||[]){
    const x=hole.x*width/1000,y=hole.y*height/600;
    const entering=state.rabbits.some(r=>r.burrow?.entryId===hole.id&&r.burrow.phase==='entering');
    const emerging=state.rabbits.some(r=>r.burrow?.exitId===hole.id&&r.burrow.phase==='emerging');
    c.save();c.imageSmoothingEnabled=false;
    // Flat stepped soil bands match the meadow's three-unit pixel grid.
    steppedOval(c,x,y,[[-27,-15,51,36],[-36,-9,69,27],[-39,0,78,12]],'#90a262');
    steppedOval(c,x,y,[[-21,-15,42,30],[-30,-12,60,30],[-36,-6,72,18]],'#a49768');
    steppedOval(c,x,y,[[-21,-15,39,27],[-30,-9,60,21],[-33,-3,66,12]],'#c5b383');
    rect(c,x-24,y-12,39,3,'#d5c493');rect(c,x-30,y-6,12,3,'#e0cc99');
    rect(c,x+18,y-9,9,3,'#d5c493');
    const sway=(entering||emerging)&&!reducedMotion?Math.sin(state.time*9+hole.id)*1.1:0;
    grassClump(c,x-29,y-7,.85,sway);
    grassClump(c,x+25,y-11,.72,-sway*.7);
    grassClump(c,x+34,y+1,.6,sway*.5);
    // The opening retains its original 54-by-20 logical footprint.
    steppedOval(c,x,y,[[-15,-9,30,18],[-24,-6,48,12],[-27,-3,54,6]],'#685b3d');
    steppedOval(c,x,y,[[-15,-6,30,12],[-24,-3,48,9]],'#35452f');
    rect(c,x-15,y-6,33,3,'#2c3929');rect(c,x-21,y-3,39,3,'#2c3929');
    rim(c,x,y);
    for(const [dx,dy] of [[-33,9],[30,9],[-21,15]]){
      rect(c,x+dx,y+dy,6,3,'#a49768');rect(c,x+dx,y+dy-3,3,3,'#d5c493');
    }
    flower(c,x-35,y-10);
    if(hole.id%2)flower(c,x+32,y-14);
    c.restore();
  }
}
export function drawBurrowRabbit(c,rabbit,time,drawRabbit,{reducedMotion=false}={}) {
  const pose=burrowPose(rabbit,reducedMotion);
  if(!pose.visible)return;
  if(!rabbit.burrow){drawRabbit(c,rabbit,time);return;}
  c.save();c.globalAlpha=pose.opacity;
  // Ears disappear last and emerge first through the same stepped front edge.
  const x=snap(rabbit.x),y=snap(rabbit.y);
  c.beginPath();
  c.rect(x-57,y-102,114,102);
  c.rect(x-27,y,54,3);c.rect(x-24,y+3,48,3);c.rect(x-15,y+6,30,3);
  c.clip();
  const depth=pose.depth*(rabbit.adult?77:59)*(rabbit.renderScale||1);
  drawRabbit(c,{...rabbit,y:rabbit.y+depth,moving:false,motionAmount:0,hopProgress:0},time,{shadow:false});
  c.restore();rim(c,rabbit.x,rabbit.y);
}
