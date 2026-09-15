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
    rect(c,x+dx,y+dy,w,h,'#84714b');
  for(const [dx,dy,w,h] of [[-30,0,3,6],[-27,6,12,3],[-18,9,36,3],[15,6,12,3],[27,0,3,6]])
    rect(c,x+dx,y+dy,w,h,'#c5b383');
  rect(c,x-24,y+6,9,3,'#e0cc99');rect(c,x-15,y+9,15,3,'#d5c493');
  rect(c,x+18,y+9,9,3,'#625a40');rect(c,x-12,y+12,6,3,'#a28c60');
  // Short turf lips make the opening feel cut into the mound, not painted on it.
  rect(c,x-33,y,6,3,'#8ca267');rect(c,x+27,y,6,3,'#6f8956');
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
    // Low grassy terraces catch light at the upper left. A soil face and a
    // short lower-right shadow give depth without enlarging the actual opening.
    c.save();c.globalAlpha*=.17;
    steppedOval(c,x+6,y+6,[[-30,0,69,12],[-21,12,54,6]],'#384d35');
    c.restore();
    steppedOval(c,x,y,[[-24,-24,48,42],[-33,-18,66,36],[-39,-9,78,21],[-30,12,60,9]],'#718953');
    steppedOval(c,x,y,[[-30,-9,63,24],[-36,-3,72,12],[-24,12,51,6]],'#a18b5b');
    rect(c,x+30,y-6,6,15,'#7b6c47');rect(c,x+21,y+12,9,6,'#7b6c47');
    rect(c,x-30,y-3,12,9,'#c5b383');rect(c,x-24,y+9,12,6,'#c5b383');
    // Broad, quiet turf shapes; the small broken edge exposes roots and soil.
    steppedOval(c,x,y,[[-18,-27,36,9],[-27,-24,54,12],[-33,-18,66,12],[-36,-12,72,6]],'#8fa368');
    rect(c,x-18,y-27,30,3,'#b2bc7d');rect(c,x-27,y-21,30,3,'#a5b474');
    rect(c,x-33,y-15,21,3,'#a5b474');rect(c,x+24,y-18,9,9,'#79945b');
    rect(c,x-30,y-6,9,3,'#a0af70');rect(c,x+21,y-6,9,3,'#6e8853');
    rect(c,x-33,y,3,6,'#ddc68d');rect(c,x+30,y+3,3,6,'#b59e6b');
    const sway=(entering||emerging)&&!reducedMotion?Math.sin(state.time*9+hole.id)*1.1:0;
    grassClump(c,x-26,y-18,.72,sway);
    grassClump(c,x+28,y-10,.6,-sway*.7);
    // The opening retains its original 54-by-20 logical footprint.
    steppedOval(c,x,y,[[-15,-9,30,18],[-24,-6,48,12],[-27,-3,54,6]],'#685b3d');
    steppedOval(c,x,y,[[-15,-6,30,12],[-24,-3,48,9]],'#35452f');
    rect(c,x-15,y-6,33,3,'#2c3929');rect(c,x-21,y-3,39,3,'#2c3929');
    rim(c,x,y);
    for(const [dx,dy] of [[-33,9],[30,9],[-21,15]]){
      rect(c,x+dx,y+dy,6,3,'#a49768');rect(c,x+dx,y+dy-3,3,3,'#d5c493');
    }
    if(hole.id%2)flower(c,x-33,y-15);
    c.restore();
  }
}
function entryDirt(c,rabbit){
  const progress=clamp(1-rabbit.burrow.remaining/burrowDurations.entering);
  // Five short, staggered crumbs are tied to the shared phase, so no particle
  // collection or per-frame randomness is needed. They settle before entry ends.
  for(let i=0;i<5;i++){
    const age=(progress-.16-i*.065)/.48;
    if(age<=0||age>=1)continue;
    const side=(i+rabbit.id)%2?1:-1;
    const reach=15+(rabbit.id+i*7)%12;
    const x=rabbit.x+side*(12+reach*age);
    const y=rabbit.y+3-(9+(i%3)*3)*4*age*(1-age)+age*6;
    rect(c,x,y,3,3,i%2?'#d7bd84':'#a28c60');
  }
}
export function drawBurrowRabbit(c,rabbit,time,drawRabbit,{reducedMotion=false}={}) {
  const pose=burrowPose(rabbit,reducedMotion);
  if(!pose.visible)return;
  if(!rabbit.burrow){drawRabbit(c,rabbit,time,{reducedMotion});return;}
  c.save();c.globalAlpha=pose.opacity;
  // Ears disappear last and emerge first through the same stepped front edge.
  const x=snap(rabbit.x),y=snap(rabbit.y);
  c.beginPath();
  c.rect(x-57,y-102,114,102);
  c.rect(x-27,y,54,3);c.rect(x-24,y+3,48,3);c.rect(x-15,y+6,30,3);
  c.clip();
  const depth=pose.depth*(rabbit.adult?77:59)*(rabbit.renderScale||1);
  drawRabbit(c,{...rabbit,y:rabbit.y+depth,moving:false,motionAmount:0,hopProgress:0},time,{shadow:false,idle:false,reducedMotion});
  c.restore();rim(c,rabbit.x,rabbit.y);
  if(!reducedMotion&&rabbit.burrow.phase==='entering')entryDirt(c,rabbit);
}
