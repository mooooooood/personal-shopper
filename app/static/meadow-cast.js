import { seatPalette } from './meadow-seats.js?v=meadow13';

const clamp = value => Math.max(0, Math.min(1, value));

// Cosmetic flight only. Landing, misses and catches always come from the server.
export function castPose(rope, width=1000, height=600) {
  const progress=clamp(rope.castElapsed/rope.castDuration);
  const start={x:rope.anchorX*width/1000,y:rope.anchorY*height/600-18};
  const ground={x:rope.castX*width/1000,y:rope.castY*height/600};
  const distance=Math.hypot(ground.x-start.x,ground.y-start.y);
  const lift=Math.sin(progress*Math.PI)*Math.min(85,25+distance*.15);
  return {progress,start,ground,
    x:start.x+(ground.x-start.x)*progress,
    y:start.y+(ground.y-18-start.y)*progress-lift,
    lift, rotation:Math.sin(progress*Math.PI*2)*.35,
    scale:.45+.55*Math.sin(progress*Math.PI/2)};
}

function strokeRope(c,start,end,colors,slack=16) {
  c.beginPath();c.moveTo(start.x,start.y);
  c.quadraticCurveTo((start.x+end.x)/2,(start.y+end.y)/2+slack,end.x,end.y+10);
  c.strokeStyle=colors[0];c.lineWidth=3.4;c.stroke();
  c.strokeStyle=colors[1];c.lineWidth=1.3;c.stroke();
}
function loop(c,x,y,colors,scale=1,rotation=0) {
  c.save();c.translate(x,y);c.rotate(rotation);c.scale(scale,scale);
  c.beginPath();c.ellipse(0,0,29,18,0,0,Math.PI*2);
  c.strokeStyle=colors[0];c.lineWidth=3.5;c.stroke();
  c.strokeStyle=colors[1];c.lineWidth=1.3;c.stroke();c.restore();
}
export function drawCast(c,rope,width,height,own) {
  const pose=castPose(rope,width,height),colors=seatPalette(rope.seatId);
  c.save();c.lineCap='round';
  // Fixed landing marker makes the short flight readable, especially on touch.
  c.globalAlpha=own?.6:.3;c.setLineDash([3,5]);
  c.beginPath();c.ellipse(pose.ground.x,pose.ground.y,31,13,0,0,Math.PI*2);
  c.strokeStyle=colors[0];c.lineWidth=1.5;c.stroke();c.setLineDash([]);
  c.globalAlpha=.12;
  c.beginPath();c.ellipse(pose.x,pose.y+pose.lift+18,24*pose.scale,8*pose.scale,0,0,Math.PI*2);
  c.fillStyle='#4c5940';c.fill();c.globalAlpha=1;
  strokeRope(c,pose.start,pose,colors,20*Math.sin(pose.progress*Math.PI));
  loop(c,pose.x,pose.y,colors,pose.scale,pose.rotation);c.restore();
}
export function drawRetractingCast(c,result,age,width,height) {
  if(result.outcome!=='missed'||age<0||age>.8)return;
  const progress=1-(1-clamp(age/.8))**2;
  const start={x:result.anchorX*width/1000,y:result.anchorY*height/600-18};
  const end={x:result.x*width/1000,y:result.y*height/600-18};
  const point={x:end.x+(start.x-end.x)*progress,y:end.y+(start.y-end.y)*progress};
  c.save();c.lineCap='round';c.globalAlpha=1-progress*.8;
  const colors=seatPalette(result.seatId);
  strokeRope(c,start,point,colors,20*(1-progress));
  loop(c,point.x,point.y,colors,1-progress*.65,progress*.5);c.restore();
}
export function drawLandingDust(c,x,y,age) {
  if(age<0||age>.8)return;
  c.save();c.globalAlpha=(1-age/.8)*.3;c.fillStyle='#bba374';
  for(let i=0;i<7;i++){
    const angle=i*Math.PI*2/7;
    c.beginPath();c.ellipse(x+Math.cos(angle)*(18+age*30),y+Math.sin(angle)*(5+age*9),3+age*2,2+age,angle,0,Math.PI*2);c.fill();
  }
  c.restore();
}
