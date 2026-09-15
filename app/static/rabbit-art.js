import { getRabbitPose } from './rabbit-pose.js?v=meadow14';
import { makePixelSprite, blitSprite } from './pixel-sprite.js?v=meadow14';

// Each coat has a small set of hand-placed pixel poses. The server still owns
// coat identity, maturity and position; the browser only draws the sprite.
const palettes={
  white:['#eee9d4','#fffbea','#b7bea9','#829386'],
  cream:['#e4ca95','#fff0c4','#b79566','#8a7557'],
  caramel:['#c89457','#edc886','#99633d','#73543c'],
  chocolate:['#876046','#b58a60','#624739','#463b32'],
  silver:['#a9bbb5','#dfdfca','#7d9491','#516b6b'],
  charcoal:['#60716f','#95a19a','#455956','#314842'],
  ginger:['#d69751','#f5c47f','#a66b3c','#754a35'],
  spotted:['#eee4c9','#fff8df','#b8b493','#7d8267'],
};
const atlas=new Map();

// Cosmetic poses share the world's clock. Only free, settled rabbits can use
// them, so a rope, a burrow or a new hop always takes priority immediately.
export function rabbitIdleFrame(rabbit,time,{idle=true,reducedMotion=false}={}){
  if(!idle||reducedMotion||rabbit.cosmeticIdle===false||rabbit.burrow||rabbit.pairId||rabbit.state!=='idle'
    ||rabbit.moving||(rabbit.motionAmount??0)>.04)return 0;
  const offset=(rabbit.id%997)*.731;
  const phase=((time%18+offset)%18+18)%18;
  if(phase<4.2)return 5+Math.floor(phase*3)%2;
  if(phase>=6&&phase<9)return 7+Math.floor((phase-6)*2.5)%2;
  if(phase>=12&&phase<16)return 9;
  return 0;
}

function paintIdle({rect,rows},coat,frame,blink){
  const nibble=frame===5||frame===6,groom=frame===7||frame===8;
  const rest=frame===9,bob=frame===6?1:0;
  // A low relaxed body, or an upright haunch with both paws at the face.
  const bodyY=groom?19:rest?24:21;
  rows(0,bodyY,[[10,7],[8,12],[6,16],[5,19],[5,21],[5,22],[6,21],[7,20]],'base');
  rect(8,bodyY+2,9,2,'light');rect(6,bodyY+4,6,2,'light');
  rect(8,bodyY+7,17,2,'shade');
  if(groom){rect(7,26,15,5,'base');rect(7,27,3,3,'shade');rect(10,27,7,2,'light');}
  rect(3,bodyY+4,4,4,'shade');rect(2,bodyY+4,3,3,'light');
  rect(9,31,8,2,'base');rect(12,32,7,1,'light');
  if(rest){rect(23,31,10,2,'base');rect(28,32,6,1,'light');}
  else if(!groom){rect(23,28,3,4,'base');rect(24,32,5,1,'light');}
  const hx=groom?-1:rest?1:2,hy=groom?-1:rest?7:8+bob;
  if(groom){
    rows(0,3,[[20,2],[19,3],[19,3],[19,3],[19,3],[19,3],[20,3],[20,3],[20,3],[21,3],[21,3]],'shade');
    rect(20,5,1,6,'ear');
    rows(0,2,[[25,2],[24,3],[24,3],[24,3],[24,3],[24,3],[24,3],[24,3],[23,3],[23,3],[22,4],[22,4]],'base');
    rect(25,4,1,6,'ear');rect(24,3,1,3,'light');
  }else{
    // Ears lean back while resting and tilt forward over a nibbling head.
    const ex=rest?-4:0,ey=rest?2:bob;
    rows(ex,12+ey,[[18,2],[18,3],[19,3],[19,3],[20,3],[20,3],[21,3],[21,3],[22,3],[22,3],[23,3]],'shade');
    rect(20+ex,15+ey,1,4,'ear');
    rows(ex,10+ey,[[23,2],[23,3],[24,3],[24,3],[24,3],[25,3],[25,3],[25,3],[25,3],[25,3],[24,3],[24,3],[23,4]],'base');
    rect(25+ex,13+ey,1,6,'ear');rect(24+ex,11+ey,1,3,'light');
  }
  rows(hx,16+hy,[[21,5],[19,9],[18,11],[18,12],[18,13],[19,13],[19,13],[20,11],[21,8]],'base');
  rect(21+hx,17+hy,5,2,'light');rect(28+hx,21+hy,3,2,'light');
  rect(22+hx,24+hy,6,1,'shade');
  if(coat==='spotted'){
    rect(8,bodyY+3,5,3,'patch');rect(10,bodyY+2,3,1,'patch');
    rect(19+hx,18+hy,3,3,'patch');
  }
  if(blink||rest||groom)rect(27+hx,20+hy,2,1,'eye');
  else{rect(27+hx,19+hy,2,2,'eye');rect(27+hx,19+hy,1,1,'spark');}
  rect(31+hx,22+hy,1,1,'nose');
  if(nibble){
    rect(30+hx,24+hy,2,1,'deep');
    rect(33,32-bob,3,1,'#6c8c50');rect(35,30-bob,1,2,'#839e59');
  }
  if(groom){
    const pawY=frame===8?18:23;
    rect(22,pawY+2,3,7,'shade');rect(24,pawY,4,7,'base');
    rect(25,pawY,3,2,'light');rect(28,pawY+2,2,3,'light');
  }
}
function frameSprite(coat,frame,blink){
  const key=`${coat}:${frame}:${blink}`;if(atlas.has(key))return atlas.get(key);
  const [base,light,shade,deep]=palettes[coat]||palettes.white;
  const palette={base,light,shade,deep,outline:'#384538',ear:'#cf9690',eye:'#263730',spark:'#fff9df',nose:'#b87675',patch:'#99734e'};
  const sprite=makePixelSprite(38,37,palette,({rect,rows})=>{
    if(frame>=5){paintIdle({rect,rows},coat,frame,blink);return;}
    const crouch=frame===1||frame===4?1:0,stretch=frame===2?2:0;
    rect(7,31,7,2,'deep');rect(23+stretch,30,5,2,'shade');
    rect(3,25+crouch,4,4,'shade');rect(2,25+crouch,3,3,'light');
    rows(0,20+crouch,[[10,7],[8,12],[6,16],[5,19],[5,20],[5,20],[5,19],[6,18],[7,16],[8,14]],'base');
    rect(9,21+crouch,8,2,'light');rect(7,23+crouch,7,2,'light');
    rect(6,27+crouch,3,2,'shade');rect(8,29+crouch,12,2,'shade');rect(14,27+crouch,8,2,'light');
    rect(9,26+crouch,2,1,'shade');rect(8,27+crouch,1,2,'shade');
    const ear=frame===3?1:0,head=crouch;
    rows(0,4+head+ear,[[19,2],[18,3],[18,3],[18,3],[18,3],[19,2],[19,3],[19,3],[20,2],[20,2],[20,3],[20,3],[21,2]],'shade');
    rect(19,7+head+ear,1,5,'ear');
    rows(0,3+head,[[25,2],[24,3],[24,3],[24,3],[24,3],[24,3],[24,3],[24,3],[24,3],[24,3],[23,3],[23,3],[23,3],[22,4]],'base');
    rect(25,5+head,1,7,'ear');rect(24,12+head,1,3,'ear');rect(24,4+head,1,4,'light');
    rows(stretch,16+head,[[21,5],[19,9],[18,11],[18,12],[18,13],[19,13],[19,13],[20,11],[21,8],[22,6]],'base');
    rect(21+stretch,17+head,5,2,'light');rect(29+stretch,21+head,3,2,'light');
    rect(23+stretch,24+head,5,2,'shade');
    if(coat==='spotted'){
      rect(8,23+crouch,5,4,'patch');rect(10,22+crouch,3,1,'patch');
      rect(19+stretch,18+head,3,4,'patch');rect(24,4+head,2,5,'patch');
    }
    if(blink)rect(27+stretch,20+head,2,1,'eye');
    else{rect(27+stretch,19+head,2,3,'eye');rect(27+stretch,19+head,1,1,'spark');}
    rect(32+stretch,22+head,1,1,'nose');rect(30+stretch,24+head,2,1,'deep');
    const reach=frame===2?3:frame===3?-2:0;
    rect(10-reach,30+crouch,7,2,'base');rect(12-reach,32,6,1,'light');
    rect(23+reach,27+crouch,3,5-crouch,'base');rect(23+reach,32,6,1,'light');
    rect(10-reach,32,2,1,'shade');
  });
  atlas.set(key,sprite);return sprite;
}
export function drawRabbit(c,rabbit,time,options={}){
  const pose=getRabbitPose(rabbit,time),moving=(rabbit.motionAmount??(rabbit.moving?1:0))>.12;
  const frame=moving?Math.floor((rabbit.hopProgress||0)*4)+1:rabbitIdleFrame(rabbit,time,options);
  const blink=(time+rabbit.id*.73)%5.1<.16;
  const size=(rabbit.adult ? .94 : .56+Math.min((rabbit.age||0)/30,1)*.18)*(options.scale??rabbit.renderScale??1);
  const lift=Math.round(pose.lift/2)*2*size;
  if(options.shadow!==false){
    c.save();c.globalAlpha*=.23;c.fillStyle='#596344';
    const x=Math.round(rabbit.x),y=Math.round(rabbit.y),w=Math.round(41*size);
    c.fillRect(x-w/2+3,y+2,w,4);c.fillRect(x-w/2+8,y+6,w-10,2);c.restore();
  }
  blitSprite(c,frameSprite(rabbit.coat||'white',frame,blink),rabbit.x,rabbit.y-lift,2.6*size,rabbit.direction||1,18,33);
}
