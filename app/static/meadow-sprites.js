import { makePixelSprite, blitSprite } from './pixel-sprite.js?v=meadow14';
import { drawRabbit } from './rabbit-art.js?v=meadow14';
const atlas=new Map();
function sprite(kind,frame){
  const key=kind+frame;if(atlas.has(key))return atlas.get(key);
  let art;
  if(kind==='eagle')art=makePixelSprite(48,39,
    {outline:'#3e4030',dark:'#685039',base:'#96744b',light:'#c3a16b',white:'#f4e7bc',gold:'#d1a04e'},({rect,rows})=>{
      const up=frame%2===0;
      // Broad, stepped wings alternate between two silhouettes.
      for(let i=0;i<6;i++){
        const y=up?19-i*2:18+i*2;
        rect(18-i*3,y,6,4,'dark');rect(28+i*2,y-2,5,4,'base');
        rect(18-i*3,y,3,1,'light');rect(29+i*2,y-2,2,1,'light');
      }
      rect(19,29,6,5,'dark');rect(17,33,3,2,'dark');rect(21,33,3,3,'base');
      rows(0,15,[[22,5],[20,9],[20,9],[19,11],[19,11],[20,10],[20,10],[21,8],[21,8],[22,6],[22,6],[23,4],[23,4]],'base');
      rect(23,17,3,9,'light');rect(27,12,7,6,'white');rect(28,11,4,2,'white');
      rect(33,15,5,2,'gold');rect(36,17,2,2,'gold');rect(31,13,1,2,'outline');
      rect(23,29,1,5,'gold');rect(27,29,1,5,'gold');rect(21,33,3,1,'gold');rect(27,33,3,1,'gold');
    });
  else if(kind==='wolf')art=makePixelSprite(51,34,
    {outline:'#354b42',dark:'#61716d',base:'#89988c',light:'#b6bf9e',ear:'#b28b78',eye:'#2b3e35'},({rect,rows})=>{
      const stride=frame%2===0?2:-1;
      rect(4,14,6,3,'dark');rect(7,16,7,4,'dark');rect(11,18,7,4,'base');
      rect(17+stride,26,3,6,'dark');rect(18+stride,31,5,1,'dark');
      rect(33-stride,24,3,7,'dark');rect(34-stride,30,5,2,'dark');
      rows(0,16,[[18,14],[16,20],[14,23],[14,24],[14,24],[14,24],[15,23],[16,22],[17,19],[18,17]],'base');
      rect(19,17,14,2,'light');rect(17,23,19,3,'dark');rect(28,20,9,5,'light');
      rect(33,6,3,10,'dark');rect(34,8,2,5,'ear');rect(40,7,3,9,'dark');rect(41,9,1,4,'ear');
      rows(0,13,[[34,8],[32,12],[31,13],[31,14],[32,15],[33,15],[34,14],[35,11],[36,8],[36,6]],'base');
      rect(37,19,8,3,'light');rect(42,18,6,2,'light');rect(46,17,2,2,'eye');rect(40,16,2,2,'eye');
      rect(20-stride,25,3,6,'base');rect(21-stride,30,6,2,'light');
      rect(33+stride,25,3,6,'base');rect(34+stride,30,6,2,'light');
    });
  else art=makePixelSprite(15,21,
    {outline:'#485136',green:'#577d45',leaf:'#91aa56',orange:'#d99245',light:'#efb965',shade:'#ad7137'},({rect,rows})=>{
      rect(3,3,2,4,'green');rect(6,2,2,5,'leaf');rect(9,3,2,4,'green');rect(5,6,5,2,'green');
      rows(0,8,[[4,6],[3,8],[3,8],[4,6],[4,6],[5,4],[5,4],[6,3],[6,2],[7,1]],'orange');
      rect(4,9,2,3,'light');rect(5,12,2,2,'light');rect(8,11,2,1,'shade');rect(6,15,2,1,'shade');
    });
  atlas.set(key,art);return art;
}
export function drawPixelWildlife(c,event,time){
  const frame=Math.floor(time*(event.kind==='eagle'?5:7))%2,d=event.direction;
  c.save();c.globalAlpha*=.22;c.fillStyle='#354e36';c.fillRect(Math.round(event.x-30),Math.round(event.y+3),60,6);c.restore();
  if(event.kind==='eagle'){
    const lift=event.phase==='leaving'?44:29;
    if(event.carrying)drawRabbit(c,{...event.carrying,x:event.x,y:event.y-lift+36,direction:d,moving:false},time,{scale:.62,shadow:false});
    blitSprite(c,sprite('eagle',frame),event.x,event.y-lift,2,d,25,21);
  }else{
    blitSprite(c,sprite('wolf',frame),event.x,event.y,2.1,d,27,32);
    if(event.carrying)drawRabbit(c,{...event.carrying,x:event.x+40*d,y:event.y+8,direction:-d,moving:false},time,{scale:.50,shadow:false});
  }
}
export function drawPixelCarrot(c,x,y,size=1){blitSprite(c,sprite('carrot',0),x,y,1.7*size,1,7,18);}
