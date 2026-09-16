import { makePixelSprite, blitSprite } from './pixel-sprite.js?v=meadow20';
import { drawPixelCarrot } from './meadow-sprites.js?v=meadow20';

// All choreography follows the shared event clock. Nothing here chooses an
// event, moves a real rabbit, or owns a random number generator.
export const SURPRISE_COPY=Object.freeze({
  hero:{title:'A giant visitor',message:'A silver hero has landed. Mind those enormous boots!'},
  pirates:{title:'Pirates in the pond',message:'Their cannon fires bubbles. Even pirates need a gentle day.'},
  ufo:{title:'Visitors from above',message:'One curious rabbit is taking a very short space trip.'},
  carrot_rain:{title:'A carrot meteor shower',message:'Look up! Today the sky is serving carrots.'},
  rain:{title:'One small rain cloud',message:'A passing shower, little puddles, and a rainbow.'},
  mushrooms:{title:'Springy mushrooms',message:'The new mushrooms seem unusually bouncy.'},
  train:{title:'All aboard',message:'A tiny meadow train is giving rabbits a lift.'},
  dinosaur:{title:'Someone in the treetops',message:'A very tall visitor has stopped for a leafy snack.'},
  ghosts:{title:'The lantern dance',message:'Friendly little ghosts have brought their lanterns.'},
  king:{title:'The rabbit king',message:'A carrot carriage, a crooked parade, and a small royal gift.'},
});
const clamp=n=>Math.max(0,Math.min(1,n));
const ease=n=>{n=clamp(n);return n*n*(3-2*n);};
const ramp=(t,a,b)=>ease((t-a)/(b-a));
const hash=(seed,n)=>{let x=(seed^Math.imul(n+11,2654435761))>>>0;x^=x>>>16;x=Math.imul(x,2246822507);x^=x>>>13;return(x>>>0)/4294967296;};
const alpha=e=>Math.min(clamp(e.elapsed/.7),clamp((e.duration-e.elapsed)/1.8));
const snap=n=>Math.round(n/2)*2;
function block(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(snap(x),snap(y),Math.max(2,snap(w)),Math.max(2,snap(h)));}
function dot(c,x,y,color,size=3){block(c,x,y,size,size,color);}
function shadow(c,x,y,w,h,opacity=.18){c.save();c.globalAlpha*=opacity;block(c,x-w/2,y,w,h,'#253f38');c.restore();}
function oval(c,x,y,w,h,color){block(c,x-w*.35,y-h*.5,w*.7,h,color);block(c,x-w*.5,y-h*.25,w,h*.5,color);}
function spark(c,x,y,color,size=3){block(c,x-size,y,size*3,size,color);block(c,x,y-size,size,size*3,color);}
const atlas=new Map();
const mushroomSpots=[[360,330],[530,360],[680,410]];
const trainPosition=t=>t<8?-220+370*ramp(t,0,8):t<=18?150+(t-8)*70:850+480*ramp(t,18,24);
const P={outline:'#34473e',silver:'#d4dfd4',white:'#fff1d0',shade:'#8da6a0',dark:'#556e68',red:'#b55749',redLight:'#df8063',gold:'#deb362',goldLight:'#ffdfa1',blue:'#598f9b',blueLight:'#a0d6cb',green:'#70956a',leaf:'#9cba72',wood:'#936b48',woodDark:'#654f3d',pink:'#d694a5',purple:'#918fb8'};
function actor(kind,frame=0){
  const key=kind+frame;if(atlas.has(key))return atlas.get(key);
  let art;
  if(kind==='hero')art=makePixelSprite(58,84,P,({rect,rows})=>{
    // A silver, red-suited giant: fin, almond eyes, chest jewel and tall boots.
    const crouch=frame===1?7:0;
    rect(17,54,9,24,'red');rect(33,54,9,24,'red');
    rect(15,74,12,6,'silver');rect(32,74,14,6,'silver');
    rect(18,58,7,14,'silver');rect(34,58,7,14,'silver');
    rows(0,31+crouch,[[19,21],[16,27],[15,29],[14,31],[14,31],[15,29],[16,27],[16,27],[17,25],[17,25],[18,23],[18,23],[18,23],[18,23],[19,21],[19,21],[19,21],[19,21],[20,19],[20,19],[20,19],[20,19],[20,19]],'red');
    rect(18,32+crouch,6,19,'silver');rect(34,32+crouch,7,19,'silver');rect(23,43+crouch,12,8,'silver');
    rect(24,31+crouch,11,5,'silver');rect(27,36+crouch,5,6,'blueLight');rect(28,36+crouch,3,2,'white');
    if(frame===2){rect(10,15,7,27,'silver');rect(40,16,7,26,'silver');rect(9,11,8,8,'silver');rect(40,11,8,8,'silver');}
    else{rect(9,36+crouch,7,22,'red');rect(8,49+crouch,7,14,'silver');rect(41,36+crouch,7,21,'red');rect(41,48+crouch,8,14,'silver');}
    rows(0,9+crouch,[[23,12],[20,18],[19,20],[18,22],[18,22],[18,22],[18,22],[18,22],[18,22],[18,22],[19,20],[19,20],[20,18],[20,18],[21,16],[21,16],[22,14],[23,12],[24,10],[25,8]],'silver');
    rect(27,3+crouch,4,23,'shade');rect(27,3+crouch,2,22,'white');
    rect(19,16+crouch,7,4,'goldLight');rect(32,16+crouch,7,4,'goldLight');
    rect(20,15+crouch,4,1,'white');rect(34,15+crouch,4,1,'white');
    rect(25,25+crouch,8,2,'dark');rect(21,21+crouch,3,3,'shade');rect(35,21+crouch,3,3,'shade');
  });
  else if(kind==='ship')art=makePixelSprite(105,84,P,({rect,rows})=>{
    rect(45,7,3,58,'woodDark');rect(21,21,55,3,'wood');
    rows(0,23,Array.from({length:32},(_,i)=>[20+Math.floor(i/7),56-Math.floor(i/5)]),'white');
    rect(25,25,2,25,'goldLight');rect(67,24,3,27,'goldLight');
    rect(43,33,12,10,'dark');rect(40,36,18,5,'dark');rect(44,35,3,3,'white');rect(51,35,3,3,'white');
    rect(46,43,7,3,'dark');rect(37,46,24,2,'dark');rect(41,43,3,8,'dark');rect(56,43,3,8,'dark');
    rect(48,7,26,12,'red');rect(69,8,8,4,'redLight');rect(70,15,7,3,'redLight');
    rect(12,59,81,5,'gold');rect(8,56,13,9,'wood');rect(88,54,10,11,'wood');
    rows(0,64,[[12,82],[14,78],[16,74],[18,70],[20,66],[22,62],[24,58],[26,54],[28,50],[30,46],[33,40],[36,34]],'wood');
    rect(18,66,68,2,'woodDark');rect(24,71,55,2,'woodDark');
    for(let i=0;i<4;i++){rect(27+i*15,64,7,5,'woodDark');rect(28+i*15,64,5,2,'gold');}
    rect(77,52,17,7,'dark');rect(90,54,8,5,'shade');rect(80,59,5,4,'woodDark');
    rect(13,53,3,7,'gold');rect(88,51,3,7,'gold');
  });
  else if(kind==='pirate')art=makePixelSprite(29,39,P,({rect,rows})=>{
    rect(9,29,4,7,'woodDark');rect(18,29,3,7,'woodDark');rect(6,35,8,2,'dark');rect(17,35,7,2,'dark');
    rect(8,17,15,13,'blue');rect(9,20,13,3,'white');rect(9,25,13,3,'white');rect(8,28,15,3,'red');
    rect(3,18,5,11,'red');rect(23,19,3,9,'red');rect(3,28,4,3,'goldLight');
    rect(9,8,13,11,'goldLight');rect(11,14,8,5,'wood');rect(11,11,2,2,'dark');rect(16,10,6,3,'dark');
    rows(0,3,[[8,14],[7,16],[5,20],[3,24],[3,24],[5,20]],'dark');rect(13,4,4,3,'white');
    rect(4,31,2,3,'gold');rect(25,27,2,5,'silver');rect(23,32,4,2,'silver');
  });
  else if(kind==='ufo')art=makePixelSprite(88,42,P,({rect,rows})=>{
    rows(0,5,[[36,16],[31,26],[27,34],[25,38],[24,40],[23,42],[23,42],[22,44],[22,44],[22,44],[23,42],[24,40]],'blue');
    rect(31,7,16,2,'blueLight');rect(27,10,6,5,'blueLight');rect(36,11,18,6,'green');rect(39,10,12,3,'green');rect(39,13,4,3,'dark');rect(48,13,4,3,'dark');
    rows(0,18,[[22,44],[14,60],[8,72],[5,78],[3,82],[3,82],[5,78],[8,72],[12,64],[18,52],[24,40]],'silver');
    rect(14,21,60,3,'white');rect(12,27,64,3,'dark');rect(23,30,42,3,'shade');
    for(let i=0;i<6;i++)rect(16+i*11,25,5,3,(i+frame)%2?'gold':'blueLight');
    rect(31,32,26,4,'purple');rect(36,35,16,3,'blueLight');
  });
  else if(kind==='cloud')art=makePixelSprite(95,43,P,({rect})=>{
    rect(28,5,22,29,'shade');rect(21,10,42,27,'shade');rect(11,17,68,22,'shade');rect(5,24,83,13,'shade');
    rect(32,4,17,4,'silver');rect(23,10,12,5,'silver');rect(12,18,13,5,'silver');rect(6,26,13,5,'silver');
    rect(58,11,12,24,'silver');rect(64,15,10,20,'silver');rect(72,21,13,14,'silver');
    rect(12,34,70,6,'dark');rect(22,38,50,3,'dark');
    rect(35,23,3,4,'dark');rect(55,23,3,4,'dark');rect(44,30,7,2,'dark');
  });
  else if(kind==='mushroom')art=makePixelSprite(39,34,P,({rect,rows})=>{
    rect(16,18,9,12,'white');rect(20,20,5,10,'gold');rect(12,30,17,2,'gold');
    rows(0,4,[[16,9],[11,19],[8,25],[6,29],[4,33],[3,35],[3,35],[3,35],[4,33],[5,31],[6,29],[8,25],[11,19]],frame?'purple':'red');
    rect(10,8,5,3,'white');rect(24,9,6,3,'white');rect(17,5,4,2,'white');rect(17,14,5,2,'white');
    rect(6,17,28,2,'gold');rect(10,19,20,2,'wood');
  });
  else if(kind==='train')art=makePixelSprite(79,49,P,({rect,rows})=>{
    rect(7,36,65,4,'dark');rect(10,17,29,20,'red');rect(7,14,35,4,'redLight');
    rect(14,20,19,11,'blueLight');rect(23,20,3,11,'wood');rect(8,8,34,6,'dark');rect(11,7,29,2,'gold');
    rect(40,24,28,12,'green');rect(39,22,25,3,'leaf');rect(65,25,6,10,'gold');
    rect(54,10,8,14,'dark');rect(51,8,14,4,'dark');rect(52,8,12,2,'gold');
    rect(45,17,5,6,'gold');rect(69,34,7,5,'gold');
    for(const x of [18,35,55]){rect(x-4,37,10,8,'dark');rect(x-2,39,6,4,'gold');rect(x,40,2,2,'wood');}
    rect(11,37+(frame%2),50,2,'silver');
  });
  else if(kind==='carriage')art=makePixelSprite(58,35,P,({rect})=>{
    rect(4,10,49,18,'wood');rect(5,9,47,3,'gold');rect(6,19,45,2,'woodDark');rect(6,25,45,3,'woodDark');
    rect(8,10,3,16,'gold');rect(45,10,3,16,'gold');
    for(const x of [14,42]){rect(x-5,27,10,6,'dark');rect(x-2,28,5,3,'gold');}
    rect(1,25,5,3,'dark');rect(52,25,5,3,'dark');
  });
  else if(kind==='dinosaur')art=makePixelSprite(114,115,P,({rect,rows})=>{
    // The neck enters from the upper trees and bends down to a friendly head.
    rect(20,0,23,70,'green');rect(24,5,25,76,'green');rect(30,29,26,53,'green');rect(39,56,19,47,'green');
    rect(23,0,7,55,'leaf');rect(29,40,7,28,'leaf');rect(35,67,11,16,'leaf');
    rows(0,80,[[51,22],[45,34],[42,43],[41,50],[42,56],[44,59],[46,59],[47,59],[47,59],[47,59],[47,59],[47,59],[47,59],[47,59],[46,59],[46,58],[46,57],[46,56],[46,55],[47,52],[48,48],[50,43],[54,36],[58,27]],'green');
    rect(49,82,28,4,'leaf');rect(78,89,27,5,'leaf');rect(68,97,35,4,'gold');
    rect(52,89,4,4,'dark');rect(53,88,2,2,'white');rect(95,91,3,2,'dark');rect(99,97,3,2,'dark');
    if(frame)rect(87,98,13,5,'woodDark');else rect(83,99,17,2,'dark');
    for(let i=0;i<6;i++)rect(16+i*3,16+i*12,5,6,'gold');
    rect(52,100,8,3,'pink');
  });
  else if(kind==='ghost')art=makePixelSprite(35,40,P,({rect,rows})=>{
    rows(0,4,[[13,8],[10,14],[8,18],[7,20],[6,22],[6,22],[6,22],[6,22],[6,22],[6,22],[6,22],[6,22],[6,22],[6,22],[6,22],[6,22],[5,23],[4,24],[4,24],[4,24],[5,22],[6,20],[8,16]],'silver');
    rect(12,7,8,3,'white');rect(8,10,3,10,'white');rect(6,27,5,4,'silver');rect(17,27,5,3,'silver');rect(26,25,4,4,'silver');
    rect(11,14,2,4,'dark');rect(21,14,2,4,'dark');rect(15,22,5,1,'dark');
    rect(3,20,5,4,'silver');rect(27,18,5,4,'silver');
    rect(28,21,1,6,'gold');rect(25,26,8,10,'gold');rect(26,28,6,6,'goldLight');rect(28,29,2,4,'white');rect(25,35,8,2,'wood');
  });
  else if(kind==='king')art=makePixelSprite(52,66,P,({rect,rows})=>{
    rect(13,30,31,26,'red');rect(10,47,37,9,'red');rect(10,54,38,3,'gold');
    rows(0,28,[[20,12],[16,21],[13,27],[12,30],[11,31],[11,32],[11,32],[11,32],[11,32],[12,30],[12,30],[13,28],[14,27],[14,25],[15,23],[17,19],[18,17]],'white');
    rect(17,42,22,7,'silver');rect(14,46,10,4,'white');rect(32,46,10,4,'white');
    rect(21,9,5,16,'white');rect(31,7,5,17,'white');rect(23,11,2,10,'pink');rect(33,9,2,11,'pink');
    rect(19,23,20,16,'white');rect(23,21,12,4,'white');rect(22,28,2,3,'dark');rect(33,28,2,3,'dark');rect(28,33,3,2,'pink');
    rect(19,20,21,4,'gold');rect(19,14,4,8,'gold');rect(27,11,4,11,'gold');rect(36,14,4,8,'gold');
    rect(28,19,3,3,'red');rect(21,20,2,2,'blue');rect(36,20,2,2,'blue');rect(20,14,2,2,'goldLight');rect(28,11,2,2,'goldLight');
    rect(8,47,37,5,'gold');rect(11,51,29,5,'redLight');rect(17,55,18,4,'redLight');
    for(const x of [15,37]){rect(x-4,57,8,6,'dark');rect(x-2,58,4,3,'gold');}
    rect(9,48,35,2,'goldLight');
  });
  atlas.set(key,art);return art;
}

function environment(state,options){
  const e=state.surprise;if(!e||!SURPRISE_COPY[e.kind]||alpha(e)<=0)return null;
  const {width:W,height:H,reducedMotion=false}=options;
  return {e,t:e.elapsed,W,H,reduced:reducedMotion,unit:Math.max(.8,Math.min(1.25,W/750)),point:(x,y)=>[x*W/1000,y*H/600]};
}
function particles(c,env,{x,y,count=16,spread=90,color='#d2bb82',start=0,length=3,gravity=24}){
  const {e,t,point,reduced}=env;if(reduced)return;
  const age=(t-start)/length;if(age<=0||age>=1)return;
  c.save();c.globalAlpha*=1-age;
  for(let i=0;i<count;i++){
    const angle=hash(e.seed,i)*Math.PI*2,r=spread*(.35+hash(e.seed,i+80)*.65)*age;
    const p=point(x+Math.cos(angle)*r,y+Math.sin(angle)*r*.32-gravity*4*age*(1-age));
    dot(c,p[0],p[1],color,3+(i%2)*2);
  }c.restore();
}
function puddle(c,x,y,size=1){oval(c,x,y,65*size,12*size,'#779c88');oval(c,x,y-2,49*size,6*size,'#a1bca0');block(c,x-16*size,y-4,18*size,2,'#d2d4a5');}
function trail(c,env,color,count=14){
  const {t,e,point,reduced}=env;if(reduced)return;
  for(let i=0;i<count;i++){
    const life=(t*.3+i/count)%1;
    const [x,y]=point(150+hash(e.seed,i)*700,160+hash(e.seed,i+20)*330-life*26);
    c.save();c.globalAlpha*=Math.sin(life*Math.PI)*.65;spark(c,x,y,color,2);c.restore();
  }
}

export function drawSurpriseGround(c,state,options){
  const env=environment(state,options);if(!env)return;
  const {e,t,W,H,point,reduced,unit}=env;c.save();c.globalAlpha*=alpha(e);
  if(e.kind==='hero'){
    const [x,y]=point(500,280);
    if(t<3){shadow(c,x,y,45+55*ramp(t,0,3),10,.15+.07*ramp(t,0,3));}
    if(t>2.6){
      c.save();c.globalAlpha*=.20;
      block(c,x-24*unit,y-4,17*unit,10*unit,'#665f40');block(c,x+10*unit,y-4,18*unit,10*unit,'#665f40');c.restore();
    }
    particles(c,env,{x:500,y:280,count:22,spread:115,start:2.6,length:2.5});
  }else if(e.kind==='ufo'){
    c.save();c.globalAlpha*=.23;block(c,0,0,W,H,'#676088');c.restore();
    const target=state.rabbits.find(r=>r.id===e.rabbitIds[0])||e;
    if(t>4&&t<14){const [x,y]=point(target.x,target.y);oval(c,x,y,70*unit,16*unit,'#a0b898');}
    trail(c,env,'#c4bfde',10);
  }else if(e.kind==='carrot_rain'){
    c.save();c.globalAlpha*=.09*(1-ramp(t,15,23));block(c,0,0,W,H,'#36536a');c.restore();
    for(const [i,p] of [[0,[360,250]],[1,[600,360]],[2,[420,450]]]){
      const hit=4+i*3;
      if(t>hit){const [x,y]=point(...p);c.save();c.globalAlpha*=.18*(1-ramp(t,15,24));oval(c,x,y,42*unit,13*unit,'#6c6844');c.restore();}
      particles(c,env,{x:p[0],y:p[1],count:12,spread:50,start:hit,length:1.8,color:'#dfbd7b'});
    }
  }else if(e.kind==='rain'){
    c.save();c.globalAlpha*=.1*(1-ramp(t,15,21));block(c,0,0,W,H,'#526d77');c.restore();
    c.save();c.globalAlpha*=ramp(t,2,8)*(1-ramp(t,18,24));
    for(const [x,y,s] of [[290,290,.8],[430,390,1.1],[590,300,.9],[690,440,.65]]){const p=point(x,y);puddle(c,p[0],p[1],s*unit);}
    c.restore();
  }else if(e.kind==='mushrooms'){
    const growth=ramp(t,0,3)*(1-ramp(t,20,24));
    for(const [i,spot] of mushroomSpots.entries()){
      const [x,y]=point(...spot);shadow(c,x,y,44*unit,5);
      blitSprite(c,actor('mushroom',i%2),x,y,1.35*unit*growth,1,19,31);
    }
    particles(c,env,{x:e.x,y:e.y,count:20,spread:130,start:20,length:4,color:'#cba3b8',gravity:40});
  }else if(e.kind==='train'){
    const show=ramp(t,0,2)*(1-ramp(t,22,24));const [x,y]=point(0,530);
    c.save();c.globalAlpha*=show;
    for(let i=0;i<24;i++){const xx=i*W/23;block(c,xx,y-5,4,19,'#86714c');}
    block(c,0,y-3,W,3,'#5b7469');block(c,0,y+10,W,3,'#5b7469');block(c,0,y-2,W,2,'#bec4a1');c.restore();
  }else if(e.kind==='ghosts'){
    c.save();c.globalAlpha*=.57;block(c,0,0,W,H,'#2d3b68');c.restore();
    for(const hole of state.burrows||[]){const [x,y]=point(hole.x,hole.y);c.save();c.globalAlpha*=.4;oval(c,x,y,45*unit,9*unit,'#bfc99e');c.restore();}
    trail(c,env,'#dfce99',18);
    for(const id of e.rabbitIds){const r=state.rabbits.find(a=>a.id===id);if(!r)continue;const [x,y]=point(r.x,r.y);c.save();c.globalAlpha*=.5;block(c,x-10,y+4,4,3,'#b8d2c7');block(c,x+5,y+7,4,3,'#b8d2c7');c.restore();}
  }else if(e.kind==='king'){
    if(!reduced)for(let i=0;i<24;i++){const fall=(t*.13+hash(e.seed,i))%1;const [x,y]=point(180+hash(e.seed,i+50)*640,210+fall*260);dot(c,x+Math.sin(fall*9+i)*8,y,i%2?'#f0c7ad':'#e7d29a',3);}
  }
  c.restore();
}

export function drawSurpriseForeground(c,state,options){
  const env=environment(state,options);if(!env)return;
  const {e,t,W,H,point,reduced,unit}=env;c.save();c.globalAlpha*=alpha(e);
  const clock=reduced?0:t;
  if(e.kind==='hero'){
    const lift=t<3?230*(1-ramp(t,0,3)):t>20?300*ramp(t,20,24):0;
    const [x,y]=point(500,280-lift);const frame=t<3||t>20?2:t<5?1:0;
    blitSprite(c,actor('hero',frame),x,y,1.65*unit,1,29,80);
    if(t>20)particles(c,env,{x:500,y:280,count:16,spread:85,start:20,length:3,color:'#dccca0'});
  }else if(e.kind==='pirates'){
    const sail=ramp(t,0,4)-ramp(t,20,24),[x,y]=point(1010-185*sail,135);
    const bob=reduced?0:Math.round(Math.sin(clock*1.4)*2);
    shadow(c,x,y+3,100*unit,9,.2);blitSprite(c,actor('ship'),x,y+bob,1.3*unit,1,53,74);
    if(t>4&&t<20){
      const [px,py]=point(760-65*ramp(t,4,8)+20*Math.sin(clock*.5),265+25*Math.sin(clock*.4));
      shadow(c,px,py,29*unit,5);blitSprite(c,actor('pirate'),px,py-(reduced?0:Math.abs(Math.sin(clock*6))*3),1.6*unit);
      if(!reduced)for(let i=0;i<5;i++){
        const age=(t*.27+i*.19)%1,p=point(865-age*150,145+age*100-Math.sin(age*Math.PI)*80);
        bubble(c,p[0],p[1],(6+i%3*2)*unit,.5);
      }
    }
  }else if(e.kind==='ufo'){
    const target=state.rabbits.find(r=>r.id===e.rabbitIds[0])||e;
    const enter=ramp(t,0,4),exit=ramp(t,19,24),[x,y]=point(target.x+(1-enter)*500-exit*600,target.y-155-(1-enter)*90-exit*100);
    if(t>4&&t<14){
      const [gx,gy]=point(target.x,target.y);c.save();c.globalAlpha*=.15;
      c.fillStyle='#e3e6b8';c.beginPath();c.moveTo(x-13*unit,y);c.lineTo(x+13*unit,y);c.lineTo(gx+44*unit,gy);c.lineTo(gx-44*unit,gy);c.closePath();c.fill();c.restore();
      if(!reduced)for(let i=0;i<8;i++){const phase=(t*.25+i/8)%1;const p=point(target.x+(hash(e.seed,i)-.5)*42,target.y-phase*150);dot(c,p[0],p[1],'#d1dabc',3);}
    }
    blitSprite(c,actor('ufo',Math.floor(clock*2)%2),x,y,1.45*unit,1,44,35);
  }else if(e.kind==='carrot_rain'){
    for(const [i,target] of [[0,[360,250]],[1,[600,360]],[2,[420,450]]]){
      const hit=4+i*3,progress=ramp(t,hit-2.4,hit);if(t<hit-2.4||t>hit)continue;
      const [x,y]=point(target[0]-190*(1-progress),target[1]-360*(1-progress));
      if(!reduced)for(let j=1;j<9;j++){c.save();c.globalAlpha*=1-j/10;block(c,x-j*5*unit,y-j*9*unit,5*unit,6*unit,j%2?'#f7d995':'#d7ae67');c.restore();}
      drawPixelCarrot(c,x,y,1.85*unit);
    }
  }else if(e.kind==='rain'){
    const travel=ramp(t,0,20),[x,y]=point(170+650*travel,155);const fade=1-ramp(t,15,20);
    c.save();c.globalAlpha*=fade;blitSprite(c,actor('cloud'),x,y,1.6*unit,1,47,39);
    if(!reduced&&t>1&&t<17)for(let i=0;i<36;i++){
      const fall=(t*.7+hash(e.seed,i))%1;const [dx,dy]=point((hash(e.seed,i+60)-.5)*170,20+fall*205);
      block(c,x+dx+fall*7,y+dy,2,5,'#b4cdc0');if(fall>.93)block(c,x+dx-2,y+dy+4,6,2,'#d3dec4');
    }c.restore();
    if(t>14){
      const [rx,ry]=point(600,250),colors=['#d9978b','#d8b476','#c8ca85','#86b393','#88aeba','#a79bbe'];
      c.save();c.globalAlpha*=.75*ramp(t,14,17);const radius=90*unit;
      for(let k=0;k<colors.length;k++)for(let i=0;i<22;i++){
        const angle=Math.PI+i*Math.PI/21;const r=radius-k*4*unit;dot(c,rx+Math.cos(angle)*r,ry+Math.sin(angle)*r*.7,colors[k],5*unit);
      }c.restore();
    }
  }else if(e.kind==='mushrooms'){
    if(t>20)trail(c,env,'#e0b9bd',18);
  }else if(e.kind==='train'){
    const trainX=trainPosition(t);
    const [x,y]=point(trainX,530),carScale=1.3*unit;
    for(let i=2;i>=0;i--){const [cx,cy]=point(trainX-80-i*62,530);shadow(c,cx,cy,58*carScale,6);blitSprite(c,actor('carriage'),cx,cy,carScale,1,29,32);}
    blitSprite(c,actor('train',Math.floor(clock*4)%2),x,y,carScale,1,39,44);
    if(!reduced)for(let i=0;i<7;i++){
      const age=(t*.3+i/7)%1;c.save();c.globalAlpha*=.5*(1-age);oval(c,x+22*unit-age*95*unit,y-50*unit-age*50*unit,(9+age*16)*unit,(8+age*12)*unit,'#e9ddbd');c.restore();
    }
  }else if(e.kind==='dinosaur'){
    const lean=ramp(t,0,5)*(1-ramp(t,19,24)),[x,y]=point(520-100*(1-lean),150-210*(1-lean));
    const sneeze=t>10&&t<12;blitSprite(c,actor('dinosaur',sneeze?1:0),x,y,1.55*unit,1,95,95);
    if(!reduced&&t>9.8&&t<17)for(let i=0;i<24;i++){
      const progress=clamp((t-9.8-hash(e.seed,i)*1.2)/5.5);if(progress<=0||progress>=1)continue;
      const [lx,ly]=point(520+progress*(100+hash(e.seed,i+40)*280),150+progress*280+Math.sin(progress*8+i)*18);
      block(c,lx,ly,6,3,i%2?'#b7b372':'#7f9a5c');
    }
  }else if(e.kind==='ghosts'){
    // Lanterns rise from the actual shared burrows, then make a loose dance.
    for(const [i,hole] of (state.burrows||[]).entries()){
      const emerge=ramp(t,i*.3,4+i*.3)*(1-ramp(t,20,24));if(emerge<=0)continue;
      const [x,y]=point(hole.x+Math.sin(clock*.65+i)*22,hole.y-20-35*emerge-(reduced?0:Math.sin(clock*1.4+i)*6));
      c.save();c.globalAlpha*=emerge*.85;blitSprite(c,actor('ghost'),x,y,1.25*unit,i%2?-1:1,17,35);c.restore();
    }
    const [mx,my]=point(710,90);oval(c,mx,my,25*unit,25*unit,'#d8dabc');oval(c,mx+8*unit,my-5*unit,23*unit,23*unit,'#788c7c');
  }else if(e.kind==='king'){
    const kingX=t<4?-50+250*ramp(t,0,4):t<=20?200+(t-4)*37.5:800+300*ramp(t,20,24),[x,y]=point(kingX,400);
    shadow(c,x,y,63*unit,8);blitSprite(c,actor('king'),x,y,1.8*unit,1,26,62);
    if(t>20){particles(c,env,{x:800,y:400,count:13,spread:55,start:20,length:3,color:'#ecd399'});}
  }
  c.restore();
}

function bubble(c,x,y,radius,opacity=.85){
  c.save();c.globalAlpha*=opacity;
  // Stepped outline keeps bubbles in the same pixel language as the meadow.
  for(let i=0;i<24;i++){const a=i*Math.PI/12;dot(c,x+Math.cos(a)*radius,y+Math.sin(a)*radius,'#c8e6d7',3);}
  block(c,x-radius*.4,y-radius*.65,7,3,'#f0f3d6');dot(c,x-radius*.62,y-radius*.35,'#e1efdc',3);c.restore();
}

// lift is in canonical meadow units, BEFORE projection. Apply the same lift
// to drawing and hit testing. Ground positions / physics stay server-owned.
export function surpriseRabbitPose(rabbit,event,{reducedMotion=false}={}){
  const pose={lift:0,bubble:false,antenna:false,dance:false,idle:undefined};
  if(!event||alpha(event)<=0||rabbit.burrow||['roped','basket','burrow'].includes(rabbit.state)||!event.rabbitIds.includes(rabbit.id))return pose;
  const t=event.elapsed;
  if(event.kind==='pirates'){
    pose.bubble=t>=6&&t<12;pose.lift=pose.bubble?(reducedMotion?24:40*Math.sin((t-6)/6*Math.PI)):0;
  }else if(event.kind==='ufo'){
    pose.lift=80*ramp(t,5,8)*(1-ramp(t,10,13));pose.antenna=t>=13&&t<24;
  }else if(event.kind==='mushrooms'&&t>6&&t<18){
    const target=mushroomSpots[event.rabbitIds.indexOf(rabbit.id)];
    if(target&&Math.hypot(rabbit.x-target[0],rabbit.y-target[1])<30){
      const edge=ramp(t,6,7)*(1-ramp(t,17,18));
      pose.lift=(reducedMotion?12:15+Math.abs(Math.sin((t-6)*2.2+rabbit.id*.7))*48)*edge;
    }
  }else if(event.kind==='train'&&t>=8&&t<=18){
    const index=event.rabbitIds.indexOf(rabbit.id),targetX=Math.max(30,Math.min(970,trainPosition(t)-80-index*62));
    if(Math.hypot(rabbit.x-targetX,rabbit.y-530)<40)pose.lift=16*ramp(t,8,9)*(1-ramp(t,17,18));
  }else if(event.kind==='ghosts'&&t>4&&t<20){
    pose.dance=true;pose.lift=reducedMotion?0:Math.abs(Math.sin(t*2.7+rabbit.id))*9;
  }
  if(pose.lift||pose.bubble||pose.dance)pose.idle=false;
  return pose;
}

// The real, server-created carrots become smaller as their shared food timer
// runs down. Return to the ordinary carrot scale as the event fades away.
export function surpriseCarrotScale(carrot,event){
  if(!event||event.kind!=='carrot_rain'||!event.carrotIds.includes(carrot.id))return 1;
  return 1+1.6*clamp(carrot.remaining/carrot.lifetime)*alpha(event);
}

// This receives the already lifted SCREEN-space rabbit, not world coordinates.
export function drawSurpriseRabbitEffect(c,rabbit,event,{reducedMotion=false}={}){
  const pose=surpriseRabbitPose(rabbit,event,{reducedMotion});if(!pose.bubble&&!pose.antenna&&!pose.dance)return;
  const size=(rabbit.adult?1:.67)*(rabbit.renderScale||1),x=rabbit.x,y=rabbit.y;
  c.save();c.globalAlpha*=alpha(event);
  if(pose.bubble)bubble(c,x,y-27*size,43*size);
  if(pose.antenna){
    const direction=rabbit.direction||1;
    block(c,x+9*direction*size,y-65*size,3*size,14*size,'#78938a');
    block(c,x+7*direction*size,y-69*size,7*size,5*size,'#d1cf8c');
    if(!reducedMotion&&Math.floor(event.elapsed*1.5)%2===0)dot(c,x+9*direction*size,y-70*size,'#f0e5b2',3*size);
  }
  if(pose.dance){dot(c,x-17*size,y+4,'#cedbb2',3);dot(c,x+17*size,y+2,'#e3d7a3',3);}
  c.restore();
}
