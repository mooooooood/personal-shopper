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
function frameSprite(coat,frame,blink){
  const key=`${coat}:${frame}:${blink}`;if(atlas.has(key))return atlas.get(key);
  const [base,light,shade,deep]=palettes[coat]||palettes.white;
  const palette={base,light,shade,deep,outline:'#384538',ear:'#cf9690',eye:'#263730',spark:'#fff9df',nose:'#b87675',patch:'#99734e'};
  const sprite=makePixelSprite(38,37,palette,({rect,rows})=>{
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
  const frame=moving?Math.floor((rabbit.hopProgress||0)*4)+1:0;
  const blink=(time+rabbit.id*.73)%5.1<.16;
  const size=(rabbit.adult ? .94 : .56+Math.min((rabbit.age||0)/30,1)*.18)*(options.scale??rabbit.renderScale??1);
  const lift=Math.round(pose.lift/2)*2*size;
  if(options.shadow!==false){
    c.save();c.globalAlpha*=.23;c.fillStyle='#304a37';
    const x=Math.round(rabbit.x),y=Math.round(rabbit.y),w=Math.round(41*size);
    c.fillRect(x-w/2+3,y+2,w,4);c.fillRect(x-w/2+8,y+6,w-10,2);c.restore();
  }
  blitSprite(c,frameSprite(rabbit.coat||'white',frame,blink),rabbit.x,rabbit.y-lift,2.6*size,rabbit.direction||1,18,33);
}
