import { createSeededRandom } from './meadow-model.js?v=meadow13';

// All scenery is painted once on resize. Only a few water lines and sun motes
// move per frame; nothing here changes the shared world or its collision map.
const TAU=Math.PI*2;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const oval=(c,x,y,rx,ry,color,angle=0)=>{
  c.beginPath();c.ellipse(x,y,Math.max(.01,rx),Math.max(.01,ry),angle,0,TAU);c.fillStyle=color;c.fill();
};
function stroke(c,points,color,width=1){
  c.beginPath();c.moveTo(...points[0]);for(const p of points.slice(1))c.lineTo(...p);
  c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.stroke();
}
function glow(c,x,y,rx,ry,inner,outer){
  c.save();c.translate(x,y);c.scale(rx,ry);
  const g=c.createRadialGradient(0,0,0,0,0,1);g.addColorStop(0,inner);g.addColorStop(1,outer);
  oval(c,0,0,1,1,g);c.restore();
}
function leaf(c,x,y,length,angle,color){
  c.save();c.translate(x,y);c.rotate(angle);c.beginPath();c.moveTo(0,0);
  c.bezierCurveTo(-length*.34,-length*.38,-length*.25,-length*.85,0,-length);
  c.bezierCurveTo(length*.34,-length*.6,length*.32,-length*.22,0,0);
  c.fillStyle=color;c.fill();c.restore();
}
function grass(c,x,y,size,tint='#7b9760'){
  c.save();c.translate(x,y);c.scale(size,size);
  for(const [dx,h,bend] of [[-5,11,-4],[0,16,1],[4,10,5]]){
    c.beginPath();c.moveTo(dx-1,2);c.quadraticCurveTo(dx-2,-h*.45,dx+bend,-h);
    c.quadraticCurveTo(dx+2,-h*.35,dx+2,2);c.fillStyle=tint;c.fill();
  }
  c.restore();
}
function blossom(c,x,y,s,color='#fff4d7'){
  oval(c,x+1,y+2,s*1.25,s*.62,'#546c4425');
  for(let i=0;i<5;i++){const a=i*TAU/5;oval(c,x+Math.cos(a)*s*.63,y+Math.sin(a)*s*.44,s*.53,s*.38,color,a);}
  oval(c,x,y,s*.3,s*.23,'#c39a43');oval(c,x-.25,y-.4,s*.17,s*.12,'#f5d776');
}
function stone(c,x,y,s){
  oval(c,x+4*s,y+4*s,14*s,6*s,'#3c563a25');
  const g=c.createLinearGradient(x-10*s,y-10*s,x+7*s,y+6*s);
  g.addColorStop(0,'#eeecd5');g.addColorStop(.45,'#cbcdb6');g.addColorStop(1,'#8a9b89');
  c.beginPath();c.moveTo(x-13*s,y);c.lineTo(x-8*s,y-8*s);c.lineTo(x+3*s,y-10*s);
  c.lineTo(x+12*s,y-3*s);c.quadraticCurveTo(x+17*s,y+5*s,x+3*s,y+6*s);
  c.quadraticCurveTo(x-12*s,y+8*s,x-13*s,y);c.fillStyle=g;c.fill();
  stroke(c,[[x-9*s,y-4*s],[x-5*s,y-7*s],[x+3*s,y-8*s]],'#fff5df9c',1.2*s);
  oval(c,x+6*s,y+4*s,4*s,1.5*s,'#869767');
}
function shrub(c,x,y,s,random,foreground=false){
  const dark=foreground?'#345e4a':'#67845b',mid=foreground?'#527c50':'#85a365',light=foreground?'#8eac63':'#b2c480';
  glow(c,x+s*.22,y+s*.25,s*1.15,s*.53,'#27493638','#27493600');
  for(const [dx,dy,k] of [[-.6,.04,.52],[.49,0,.63],[0,-.24,.72]]){
    const cx=x+dx*s,cy=y+dy*s;
    const g=c.createRadialGradient(cx-s*.25,cy-s*.32,s*.03,cx,cy,s*k);
    g.addColorStop(0,light);g.addColorStop(.5,mid);g.addColorStop(1,dark);
    oval(c,cx,cy,s*k,s*k*.72,g);
  }
  for(let i=0;i<32;i++){
    const a=random()*TAU,r=Math.sqrt(random()),px=x+Math.cos(a)*s*r,py=y+Math.sin(a)*s*r*.49-s*.1;
    leaf(c,px,py,s*(.10+random()*.10),-.8+random()*1.6,i%3?light:mid);
  }
}
export function rabbitRenderScale(worldY){return .74+.30*clamp(worldY/600,0,1);}

export function paintLandscape(c,W,H){
  c.save();const X=x=>x*W/1000,Y=y=>y*H/600;
  const s=clamp(Math.sqrt(W*H/600000),.72,1.3),random=createSeededRandom(4817);
  const g=c.createLinearGradient(0,0,W*.3,H);
  g.addColorStop(0,'#bdcfa3');g.addColorStop(.27,'#d5dfad');g.addColorStop(.62,'#baca8d');g.addColorStop(1,'#8daa76');
  c.fillStyle=g;c.fillRect(0,0,W,H);
  // Low, distant banks: pale and quiet, so the play area reads as a clearing.
  c.beginPath();c.moveTo(0,Y(85));c.bezierCurveTo(X(150),Y(22),X(270),Y(100),X(490),Y(42));
  c.bezierCurveTo(X(680),Y(4),X(835),Y(63),W,Y(16));c.lineTo(W,0);c.lineTo(0,0);c.closePath();c.fillStyle='#9fb887';c.fill();
  c.beginPath();c.moveTo(0,Y(34));c.bezierCurveTo(X(170),Y(3),X(210),Y(66),X(410),Y(17));
  c.bezierCurveTo(X(660),Y(-38),X(750),Y(40),W,Y(-2));c.lineTo(W,0);c.lineTo(0,0);c.closePath();c.fillStyle='#789c7c4d';c.fill();
  glow(c,X(438),Y(275),W*.61,H*.52,'#f7efbb7a','#f3efc000');
  // Broad slopes rather than repeated spots, with a lit top and cool lower edge.
  for(const [x,y,rx,ry] of [[110,217,205,80],[495,368,215,100],[730,491,245,110],[18,474,140,130]]){
    glow(c,X(x),Y(y+7),X(rx),Y(ry),'#6c986032','#6c986000');
    glow(c,X(x-25),Y(y-20),X(rx*.8),Y(ry*.66),'#e9e9b936','#e9e9b900');
  }
  // Warm, worn footpath. A soft border lets it settle into the grass.
  const path=()=>{c.beginPath();c.moveTo(X(120),Y(620));c.bezierCurveTo(X(280),Y(463),X(394),Y(482),X(575),Y(508));c.bezierCurveTo(X(759),Y(535),X(874),Y(506),X(1030),Y(567));};
  for(const [width,color] of [[47,'#7c916038'],[39,'#a9ab7866'],[31,'#c5bb8b'],[24,'#d5c99b']]){path();c.strokeStyle=color;c.lineWidth=width*s;c.lineCap='round';c.stroke();}
  // Fine grain is cached; it costs nothing extra as the rabbits move.
  const dots=Math.round(clamp(W*H/430,650,3000));
  for(let i=0;i<dots;i++){
    const x=random()*W,y=random()*H;
    oval(c,x,y,(.4+random()*.8)*s,(.3+random()*.5)*s,i%3?'#466a3c12':'#fff7d32d');
  }
  for(let i=0;i<180;i++){
    const x=25+random()*950,y=90+random()*475;
    if(((x-825)/122)**2+((y-135)/82)**2<1)continue;
    grass(c,X(x),Y(y),s*(.24+y/1900+random()*.18),i%4?'#7d9a5e65':'#f1edb572');
  }
  // Garden boundary with shadows that all fall down and right.
  const fenceY=Y(67);
  for(let x=X(90);x<X(650);x+=40*s){
    stroke(c,[[x+3*s,fenceY+12*s],[x+15*s,fenceY+28*s]],'#56734f29',5*s);
    stroke(c,[[x+2*s,fenceY-18*s],[x+2*s,fenceY+13*s]],'#a19970',7*s);
    stroke(c,[[x,fenceY-19*s],[x,fenceY+10*s]],'#e9ddba',6*s);
    stroke(c,[[x-1.5*s,fenceY-16*s],[x-1.5*s,fenceY+8*s]],'#fff0cf',1.5*s);
  }
  for(const offset of [-8,5]){
    stroke(c,[[X(74),fenceY+(offset+2)*s],[X(659),fenceY+(offset+2)*s]],'#a39d7366',6*s);
    stroke(c,[[X(74),fenceY+offset*s],[X(659),fenceY+offset*s]],'#ece1c0',4*s);
  }
  // The pond stays inside the original server collision boundary.
  const px=X(825),py=Y(135),rx=X(100),ry=Y(58);
  glow(c,px+5*s,py+7*s,rx+19*s,ry+18*s,'#345d494a','#345d4900');
  oval(c,px,py+3*s,rx+9*s,ry+9*s,'#8da477');
  oval(c,px-1*s,py-2*s,rx+6*s,ry+6*s,'#c1c391');
  oval(c,px,py,rx+2*s,ry+2*s,'#5e8970');
  const water=c.createLinearGradient(px-rx,py-ry,px+rx*.6,py+ry);
  water.addColorStop(0,'#3e827c');water.addColorStop(.48,'#69a596');water.addColorStop(1,'#a3c6aa');
  oval(c,px,py,rx,ry,water);
  c.save();c.beginPath();c.ellipse(px,py,rx,ry,0,0,TAU);c.clip();
  glow(c,px-rx*.23,py-ry*.35,rx*.93,ry*.9,'#285d5b47','#285d5b00');
  // Reflected bank, translucent cloud and shallow-water pebbles.
  for(let i=0;i<10;i++)oval(c,px-rx+random()*rx*2,py-ry*.92,rx*.17,ry*(.15+random()*.16),'#315e5530');
  oval(c,px+rx*.31,py+ry*.16,rx*.39,ry*.18,'#e9ecd22b');
  for(let i=0;i<8;i++)oval(c,px+rx*(.1+random()*.7),py+ry*(.58+random()*.3),s*(2+random()*3),s*(1+random()*2),'#d6d2a826');
  c.restore();
  c.beginPath();c.ellipse(px,py+1*s,rx-1*s,ry-1*s,0,.2,Math.PI*.88);c.strokeStyle='#e0e5bd80';c.lineWidth=1.7*s;c.stroke();
  for(const [x,y,k] of [[738,172,.95],[752,186,.7],[915,112,1.1],[904,91,.7],[932,147,.55]])stone(c,X(x),Y(y),s*k);
  for(const [x,y,k] of [[785,154,.9],[864,116,.7],[842,175,.42]]){
    oval(c,X(x)+2*s,Y(y)+3*s,13*s*k,6*s*k,'#275c4f36');
    c.beginPath();c.ellipse(X(x),Y(y),13*s*k,6.5*s*k,-.1,.18,TAU-.2);c.lineTo(X(x),Y(y));c.closePath();c.fillStyle='#608b61';c.fill();
    stroke(c,[[X(x)-8*s*k,Y(y)-2*s*k],[X(x)+4*s*k,Y(y)-2*s*k]],'#a9bc7990',s);
  }
  blossom(c,X(784),Y(150),6*s,'#f6dcd0');
  for(let i=0;i<10;i++){
    const x=X(895+random()*32),y=Y(164+random()*18),h=(18+random()*20)*s;
    stroke(c,[[x,y],[x-4*s,y-h]],i%2?'#587b53':'#88a064',1.8*s);
    leaf(c,x,y,h*.72,.5,'#729256');if(i%3===0)stroke(c,[[x-4*s,y-h],[x-5*s,y-h-5*s]],'#8b7650',3*s);
  }
  // Botanical edges stay behind the rabbits and away from the seat labels.
  for(const [x,y,k] of [[-25,68,86],[29,-12,81],[990,8,80],[1025,215,48],[-30,382,46],[1024,479,49],[13,617,91],[998,625,98]])
    shrub(c,X(x),Y(y),k*s,random,y>450);
  for(const [x,y] of [[168,192],[290,361],[655,325],[786,455],[171,491],[488,116]]){
    for(let i=0;i<9;i++){
      const xx=X(x)+(random()-.5)*67*s,yy=Y(y)+(random()-.5)*30*s,k=.65+random()*.55;
      grass(c,xx,yy+5*s,s*.43,'#829856');
      stroke(c,[[xx,yy+6*s],[xx+1*s,yy-2*s]],'#7d9358',.8*s);
      blossom(c,xx,yy-2*s,(2.2+random()*1.8)*s*k,i%4?'#f8edd0':'#dcaeac');
    }
  }
  // Dappled canopy shadow, kept at the border instead of across the game.
  for(let i=0;i<26;i++){
    const right=i%2===0,x=right?W-random()*W*.11:random()*W*.07;
    const y=random()*H;
    glow(c,x,y,24*s+random()*29*s,12*s+random()*22*s,'#355c4317','#355c4300');
  }
  glow(c,X(295),Y(80),W*.6,H*.49,'#fff5cb35','#fff5cb00');
  if(W>700){
    const x=X(493),y=Y(117);
    stroke(c,[[x+3*s,y+8*s],[x+17*s,y+47*s]],'#365c3426',7*s);
    stroke(c,[[x,y+8*s],[x,y+42*s]],'#9f865c',5*s);
    c.save();c.translate(x,y);c.rotate(-.035);
    c.fillStyle='#887b4f';c.beginPath();c.roundRect(-71*s,-16*s,145*s,34*s,4*s);c.fill();
    const wood=c.createLinearGradient(0,-18*s,0,16*s);wood.addColorStop(0,'#f3e8bd');wood.addColorStop(1,'#d7c597');
    c.fillStyle=wood;c.beginPath();c.roundRect(-72*s,-18*s,145*s,33*s,4*s);c.fill();
    stroke(c,[[-66*s,-15*s],[66*s,-15*s]],'#fff4d8',s);
    oval(c,-64*s,-2*s,1.3*s,1.3*s,'#aa9566');oval(c,63*s,-2*s,1.3*s,1.3*s,'#aa9566');
    c.font=`italic ${13*s}px Georgia, serif`;c.textAlign='center';c.fillStyle='#63704a';c.fillText('a little room to grow',0,4*s);c.restore();
  }
  c.restore();
}

export function paintForeground(c,W,H){
  c.clearRect(0,0,W,H);c.save();
  const s=clamp(Math.sqrt(W*H/600000),.72,1.3),random=createSeededRandom(1981);
  // Grow inwards only as far as the unused map margin. Natural leaf outlines
  // avoid a rectangular clipping edge, while every playable ground point stays clear.
  for(const edge of [0,1]){
    const x=edge?W*1.025:-W*.025,y=H*.97;
    for(let i=0;i<12;i++){
      const length=W*(.025+random()*.021),angle=(edge?-1:1)*(.18+random()*1.9);
      leaf(c,x,y+(random()-.5)*44*s,length,angle,i%3?'#48744f':'#749456');
    }
  }
  for(let i=0;i<15;i++){
    const x=random()*W,y=H+random()*9*s;
    grass(c,x,y,Math.min(s*(1.1+random()),H*.042/16),i%3?'#4c7650':'#789451');
  }
  c.restore();
}

export function drawMeadowAtmosphere(c,W,H,time,{reducedMotion=false}={}){
  const t=reducedMotion?0:time,px=W*.825,py=H*.225,rx=W*.1,ry=H*58/600;
  c.save();c.beginPath();c.ellipse(px,py,rx*.96,ry*.94,0,0,TAU);c.clip();
  for(let i=0;i<7;i++){
    const phase=(t*.12+i*.173)%1;
    const x=px+Math.sin(i*6.7)*rx*.57+Math.sin(t*.35+i)*rx*.025,y=py+(i/6-.5)*ry*1.35;
    const length=rx*(.1+.16*Math.sin(phase*Math.PI));
    c.beginPath();c.moveTo(x-length,y);c.quadraticCurveTo(x,y+1.6,x+length,y);
    c.strokeStyle=`rgba(239,246,216,${.12+Math.sin(phase*Math.PI)*.15})`;c.lineWidth=1.2;c.stroke();
  }
  for(let i=0;i<2;i++){
    const p=(t*.09+i*.5)%1;c.beginPath();c.ellipse(px-rx*.38,py+ry*.32,(8+p*17),(3+p*6),0,0,TAU);
    c.strokeStyle=`rgba(230,241,204,${(1-p)*.22})`;c.lineWidth=.8;c.stroke();
  }
  c.restore();
  if(reducedMotion)return;
  // A handful of slow sunlit seeds, decorative only and never clickable.
  c.save();
  for(let i=0;i<7;i++){
    const phase=(t*.035+i*.147)%1,x=W*(.17+i*.105)+Math.sin(t*.21+i*2.7)*12,y=H*(.18+phase*.53);
    c.globalAlpha=Math.sin(phase*Math.PI)*.34;
    oval(c,x,y,1.6,1.1,'#fff8d5',-.4);
  }
  c.restore();
}
