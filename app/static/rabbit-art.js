import { getRabbitPose } from './rabbit-pose.js?v=meadow10';

// Painted once per coat, then articulated at runtime. No image downloads or
// per-frame fur gradients: the small sprite atlas is shared by all rabbits.
const palettes = {
  white: ['#eeeae0','#ffffff','#b5b5a8','#fcf9ef'],
  cream: ['#dcc39a','#f6e7c9','#a7906d','#f3e4c8'],
  caramel: ['#b37c48','#d9ac76','#795537','#eed3aa'],
  chocolate: ['#694939','#97735a','#413329','#c4a58b'],
  silver: ['#a3acae','#d4d9d6','#737e80','#e0e2d9'],
  charcoal: ['#454d51','#737d7e','#293237','#afb7b3'],
  ginger: ['#c08651','#e6b47c','#875732','#f2d8b3'],
  spotted: ['#eae1cf','#fff9e9','#ac9e86','#fff2da'],
};
const atlas = new Map();
const oval = (c,x,y,rx,ry,fill,rotation=0) => {
  c.beginPath(); c.ellipse(x,y,rx,ry,rotation,0,Math.PI*2); c.fillStyle=fill; c.fill();
};
function stroke(c,points,color,width=1){
  c.beginPath();c.moveTo(...points[0]);for(const p of points.slice(1))c.lineTo(...p);
  c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.stroke();
}
function paintPart(paint) {
  const canvas=document.createElement('canvas');canvas.width=192;canvas.height=192;
  const c=canvas.getContext('2d');c.scale(2,2);c.translate(48,64);paint(c);
  return canvas;
}
function coatAtlas(name) {
  if(atlas.has(name))return atlas.get(name);
  const [base,light,dark,belly]=palettes[name] || palettes.white;
  const shade=(c,x,y,r)=>{const g=c.createRadialGradient(x,y,1,x+3,y+6,r);g.addColorStop(0,light);g.addColorStop(.55,base);g.addColorStop(1,dark);return g;};
  const body=paintPart(c=>{
    c.beginPath();c.moveTo(-29,-2);c.bezierCurveTo(-38,-14,-31,-33,-17,-33);
    c.bezierCurveTo(-2,-34,4,-23,10,-17);c.bezierCurveTo(18,-6,9,2,-1,3);
    c.bezierCurveTo(-11,4,-23,4,-29,-2);c.fillStyle=shade(c,-17,-25,38);c.fill();
    oval(c,-3,-3,13,4,belly,-.12);
    if(name==='spotted'){
      oval(c,-17,-24,10,8,'#927255',-.3);oval(c,3,-12,6,8,'#b18a65',-.5);
    }
    // Short strokes follow the flank instead of outlining a flat white oval.
    c.globalAlpha=.23;
    for(let i=0;i<18;i++){
      const x=-26+(i%6)*5,y=-24+Math.floor(i/6)*7;
      stroke(c,[[x,y],[x+2,y-2],[x+4,y-2.5]],i%3?light:dark,.65);
    }
    c.globalAlpha=1;
  });
  const haunch=paintPart(c=>{
    oval(c,0,0,11,13,shade(c,-5,-6,22),-.3);
    c.beginPath();c.ellipse(0,1,9,11,-.3,-1.4,1.1);c.strokeStyle=dark;c.globalAlpha=.28;c.lineWidth=.65;c.stroke();
  });
  const head=paintPart(c=>{
    c.beginPath();c.moveTo(-7,8);c.bezierCurveTo(-14,0,-10,-12,-3,-13);
    c.bezierCurveTo(5,-15,10,-8,11,-4);c.bezierCurveTo(13,-1,20,-1,20,4);
    c.bezierCurveTo(20,9,9,12,1,11);c.closePath();c.fillStyle=shade(c,-2,-8,28);c.fill();
    oval(c,12,6,8,4.6,belly,-.12);oval(c,5,6,7,5,base,.2);
    if(name==='spotted')oval(c,-5,-6,5,6,'#9e7855',-.4);
    c.globalAlpha=.35;
    for(let i=0;i<5;i++)stroke(c,[[-5+i*2,4],[-3+i*2,6]],light,.7);
    c.globalAlpha=1;
  });
  const ear=paintPart(c=>{
    c.beginPath();c.moveTo(-3,2);c.bezierCurveTo(-8,-10,-7,-32,-2,-38);
    c.bezierCurveTo(4,-39,7,-22,4,-8);c.quadraticCurveTo(4,1,1,3);c.closePath();
    c.fillStyle=name==='spotted'?'#967659':shade(c,-2,-24,32);c.fill();
    c.beginPath();c.moveTo(-1,-3);c.bezierCurveTo(-5,-13,-4,-29,-2,-33);
    c.bezierCurveTo(1,-33,3,-19,1,-7);c.closePath();c.fillStyle='#bd9c96';c.fill();
    stroke(c,[[-1,-29],[0,-20],[-.5,-9]],'#e2bdb1',.9);
    stroke(c,[[-4,-32],[-5,-22],[-4,-14]],light,.7);
  });
  const tail=paintPart(c=>{
    oval(c,0,0,7,8,shade(c,-2,-3,14),-.3);
    c.globalAlpha=.7;for(let i=0;i<8;i++){const a=i*Math.PI/4;stroke(c,[[Math.cos(a)*3,Math.sin(a)*4],[Math.cos(a)*6,Math.sin(a)*7]],light,.8);}
  });
  const result={body,haunch,head,ear,tail,base,light,dark,belly};atlas.set(name,result);return result;
}
function part(c,sprite){c.drawImage(sprite,-48,-64,96,96);}
function leg(c,x,y,reach,colour,foot,far=false){
  const kneeX=x+reach*5,footX=x+reach*12+(far?1:0),footY=2-Math.max(0,-reach)*6;
  stroke(c,[[x,y],[kneeX,y+6],[footX,footY-1]],colour,far?3:4);
  oval(c,footX+3,footY,6,2.4,foot,-reach*.13);
  if(!far){stroke(c,[[footX+6,footY-1],[footX+7,footY]],colour,.55);}
}

export function drawRabbit(c,rabbit,time,options={}) {
  const coat=coatAtlas(rabbit.coat || 'white');
  const pose=getRabbitPose(rabbit,time);
  const size=(rabbit.adult? .94 : .56+Math.min((rabbit.age||0)/30,1)*.18)*(options.scale||1);
  const d=rabbit.direction||1;
  if(options.shadow!==false){
    c.save();c.globalAlpha=.19-pose.lift*.004;
    oval(c,rabbit.x,rabbit.y+3,25*size*(1+pose.lift*.012),6*size,'#526747');
    c.globalAlpha*=.4;oval(c,rabbit.x,rabbit.y+3,30*size,8*size,'#788763');c.restore();
  }
  c.save();c.translate(rabbit.x,rabbit.y-pose.lift*size);c.scale(d*size,size);c.rotate(pose.pitch);
  leg(c,-20,-10,pose.hindReach,coat.dark,coat.base,true);
  leg(c,9,-13,pose.foreReach,coat.dark,coat.base,true);
  c.save();c.translate(-31,-13);c.rotate(pose.tailTilt);part(c,coat.tail);c.restore();
  c.save();c.scale(pose.stretchX,pose.stretchY*pose.breath);part(c,coat.body);c.restore();
  leg(c,-16,-7,pose.hindReach*.9,coat.base,coat.belly);
  c.save();c.translate(-18,-11);c.rotate(pose.hindReach*.17);part(c,coat.haunch);c.restore();
  leg(c,11,-13,pose.foreReach*.85,coat.base,coat.belly);
  c.save();c.translate(13, -25+pose.headBob);c.rotate(-pose.pitch*.55);
  c.save();c.translate(-2,-9);c.rotate(-.30+pose.earTilt);c.globalAlpha=.88;part(c,coat.ear);c.restore();
  c.save();c.translate(4,-10);c.rotate(.03+pose.earTilt*.72);part(c,coat.ear);c.restore();
  part(c,coat.head);
  const blink=(time+rabbit.id*.73)%5.1<.13;
  if(blink)stroke(c,[[4,-3],[8,-3]],'#293332',1.4);
  else{
    oval(c,6,-3,2.9,3.3,coat.dark,-.15);
    oval(c,6.4,-3.2,2.1,2.6,'#202b29',-.15);
    oval(c,7.1,-4.4,.8,.95,'#fbfcf4');
  }
  const noseY=2+pose.noseTwitch;
  oval(c,19,noseY,1.9,1.45,'#bc9187',.18);
  stroke(c,[[18.5,noseY+1],[18,5],[15.5,6]],'#8d8174',.65);
  c.globalAlpha=.55;
  stroke(c,[[13,5],[28,1]],coat.belly,.55);stroke(c,[[13,6],[29,6]],coat.belly,.55);
  stroke(c,[[13,7],[26,10]],coat.dark,.45);c.globalAlpha=1;
  c.restore();c.restore();
}
