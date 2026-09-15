import { createSeededRandom } from './meadow-model.js?v=meadow14';

// Scenery uses a small opaque palette and snapped rectangles. It is cached on
// resize; the only per-frame scenery work is four little stepped water ripples.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const C={
  grass:'#a9b67a',grassLight:'#b4bf83',grassDeep:'#9aab6e',grassShade:'#909d66',
  grassInk:'#81935b',grassSpark:'#c5cc91',castShadow:'#899360',shadowEdge:'#9da66e',
  canopyDark:'#405d40',canopy:'#577648',
  canopyMid:'#6c8c50',canopyLight:'#839e59',leafLight:'#9eb567',wood:'#8d704b',
  woodDark:'#68563b',cream:'#e8d8a5',creamLight:'#f5e6ba',dirt:'#c5b383',
  dirtLight:'#d5c493',dirtEdge:'#a49768',water:'#6caa91',waterDark:'#478476',
  waterMid:'#579984',waterLight:'#89bba0',foam:'#bfd2a5',stone:'#bbbfa0',
  stoneLight:'#ddd9b2',stoneDark:'#879278',pink:'#e8b5a0',flower:'#f5e4b3',
};

function pixelPainter(c,W,H){
  const unit=3,X=x=>Math.round(x*W/1000/unit)*unit,Y=y=>Math.round(y*H/600/unit)*unit;
  return {
    rect(x,y,w,h,color){
      const x0=X(x),y0=Y(y),x1=X(x+w),y1=Y(y+h);
      c.fillStyle=color;c.fillRect(x0,y0,Math.max(unit,x1-x0),Math.max(unit,y1-y0));
    },
    clip(rows){c.beginPath();for(const [x,y,w,h] of rows)c.rect(X(x),Y(y),Math.max(unit,X(x+w)-X(x)),Math.max(unit,Y(y+h)-Y(y)));c.clip();},
  };
}

function tuft(p,x,y,k=1,color=C.grassInk){
  p.rect(x,y-6*k,3*k,6*k,color);p.rect(x+3*k,y-3*k,6*k,3*k,color);
  p.rect(x+9*k,y-9*k,3*k,9*k,color);
}
function flower(p,x,y,color=C.flower){
  p.rect(x,y+3,3,6,C.grassInk);p.rect(x-3,y+6,3,3,C.grassInk);
  p.rect(x-3,y-3,9,3,color);p.rect(x,y-6,3,9,color);p.rect(x,y-3,3,3,'#c6994e');
}
function rock(p,x,y,k=1){
  p.rect(x-3*k,y+6*k,27*k,6*k,C.shadowEdge);
  p.rect(x-6*k,y+3*k,27*k,6*k,C.castShadow);
  p.rect(x-12*k,y-3*k,27*k,9*k,C.stoneDark);
  p.rect(x-6*k,y-9*k,15*k,3*k,C.stoneDark);
  p.rect(x-9*k,y-6*k,21*k,9*k,C.stone);
  p.rect(x-6*k,y-6*k,12*k,3*k,C.stoneLight);
  p.rect(x-9*k,y-3*k,6*k,3*k,C.stoneLight);
  p.rect(x+6*k,y,6*k,3*k,'#a2ad89');
}
function crown(p,x,y,s=1){
  // A stepped silhouette with solid shadow, midtone and lit leaf clusters.
  p.rect(x-21*s,y+24*s,84*s,12*s,C.shadowEdge);
  p.rect(x-30*s,y+18*s,81*s,12*s,C.grassShade);
  p.rect(x-33*s,y+15*s,72*s,9*s,C.castShadow);
  p.rect(x-45*s,y-21*s,87*s,42*s,C.canopyDark);
  p.rect(x-33*s,y-36*s,63*s,66*s,C.canopyDark);
  p.rect(x-15*s,y-45*s,30*s,9*s,C.canopyDark);
  p.rect(x-51*s,y-9*s,99*s,21*s,C.canopyDark);
  p.rect(x-42*s,y-21*s,75*s,33*s,C.canopy);
  p.rect(x-30*s,y-33*s,57*s,51*s,C.canopy);
  p.rect(x-12*s,y-42*s,24*s,24*s,C.canopy);
  p.rect(x-45*s,y-6*s,87*s,15*s,C.canopy);
  p.rect(x-30*s,y-24*s,48*s,30*s,C.canopyMid);
  p.rect(x-36*s,y-15*s,63*s,15*s,C.canopyMid);
  p.rect(x-12*s,y-33*s,24*s,33*s,C.canopyMid);
  for(const [dx,dy,w] of [[-24,-24,15],[-30,-15,12],[-9,-33,15],[9,-21,12],[-3,-9,18],[24,0,9],[-24,6,9]]){
    p.rect(x+dx*s,y+dy*s,w*s,6*s,C.canopyLight);
    p.rect(x+(dx+3)*s,y+dy*s,6*s,3*s,C.leafLight);
  }
  p.rect(x-39*s,y+6*s,12*s,3*s,C.canopyMid);
  p.rect(x+3*s,y+15*s,12*s,6*s,C.canopyMid);
}

function pondRows(cx,cy,rx,ry){
  const spans=[.40,.65,.82,.94,1,1,.94,.82,.65,.40];
  return spans.map((span,i)=>[cx-rx*span,cy-ry+i*ry/5,rx*span*2,ry/5]);
}
function pond(p,c){
  const cx=825,cy=135;
  for(const row of pondRows(cx+3,cy+9,113,69))p.rect(...row,C.grassShade);
  for(const row of pondRows(cx,cy+3,110,66))p.rect(...row,C.dirtEdge);
  for(const row of pondRows(cx,cy,107,63))p.rect(...row,C.dirtLight);
  for(const row of pondRows(cx,cy,100,57))p.rect(...row,C.waterDark);
  c.save();p.clip(pondRows(cx,cy+3,97,54));
  p.rect(717,98,220,94,C.water);
  p.rect(719,92,206,30,C.waterMid);
  p.rect(728,95,39,24,C.waterDark);p.rect(746,104,39,18,C.waterDark);
  p.rect(770,98,45,12,C.waterDark);p.rect(815,89,63,15,C.waterDark);
  p.rect(773,122,60,6,C.waterMid);p.rect(725,137,39,9,C.waterMid);
  p.rect(833,152,90,33,C.waterLight);p.rect(860,146,57,9,C.waterLight);
  p.rect(800,171,63,15,C.waterLight);p.rect(875,159,33,3,C.foam);
  p.rect(848,174,24,3,C.foam);p.rect(786,153,18,3,C.waterLight);
  c.restore();
  for(const [x,y,k] of [[738,172,1],[754,184,.7],[916,112,1.1],[903,88,.7],[930,148,.6]])rock(p,x,y,k);
  // Lily pads have the characteristic square bite in their right side.
  for(const [x,y] of [[783,151],[864,119],[842,176]]){
    p.rect(x-9,y,21,9,C.waterDark);p.rect(x-9,y-3,18,9,C.canopy);
    p.rect(x-6,y-6,12,12,C.canopyMid);p.rect(x-6,y-6,9,3,C.leafLight);
    p.rect(x+3,y,6,3,C.water);
  }
  flower(p,780,145,C.pink);
  for(const [x,y,h] of [[901,174,27],[910,179,36],[917,176,24],[927,169,33]]){
    p.rect(x,y-h,3,h,C.canopy);p.rect(x-3,y-12,3,9,C.canopyMid);
    p.rect(x+3,y-18,3,12,C.canopyMid);p.rect(x,y-h-6,3,9,C.wood);
  }
}

export function rabbitRenderScale(worldY){return .74+.30*clamp(worldY/600,0,1);}

// Uneven terraces make one patch read as low grass, not a rectangular tile.
function grassPatch(p,x,y,rx,ry,color){
  for(const [i,left,right] of [[0,.38,.51],[1,.70,.82],[2,.92,1],[3,1,.94],[4,.80,.73],[5,.44,.46]]){
    p.rect(x-rx*left,y-ry+i*ry/3,rx*(left+right),ry/3+3,color);
  }
}

// Decorations stay around the edges of the clearing and away from active holes.
function plantedGround(x,y){
  if(x<18||x>982||y<90||y>508)return false;
  if(((x-825)/125)**2+((y-135)/86)**2<1)return false;
  if(((x-485)/145)**2+((y-328)/112)**2<1)return false;
  if((x<125||x>875)&&y>203&&y<447)return false;
  return ![[260,270],[540,205],[760,350],[340,440],[660,460]].some(([bx,by])=>((x-bx)/62)**2+((y-by)/42)**2<1);
}

function planting(p,random,{compact=false}={}){
  // Each patch shares a center, so stems, stones and flowers belong together.
  const patches=[
    [175,174,49,25,3],[386,114,67,20,2],[659,286,46,26,3],
    [197,460,55,26,3],[791,454,53,29,3],[951,478,26,20,2],
    [47,141,24,27,0],
  ];
  for(const [cx,cy,rx,ry,blooms] of patches){
    grassPatch(p,cx,cy+3,rx*.80,ry*.58,C.grassDeep);
    const points=[];
    for(let i=0;i<13;i++){
      const angle=random()*Math.PI*2,radius=Math.sqrt(random());
      const x=cx+Math.cos(angle)*rx*radius,y=cy+Math.sin(angle)*ry*radius;
      if(!plantedGround(x,y))continue;
      if(compact&&i%2)continue;
      points.push({x,y,i});
    }
    for(const {x,y,i} of points){
      p.rect(x+3,y+3,6,3,i%3?C.grassDeep:C.grassShade);
      if(i%3===0)tuft(p,x,y,.52+(i%2)*.16,i%2?C.grassInk:C.grassSpark);
      else p.rect(x,y,3+(i%2)*3,3,i%3?C.grassDeep:C.grassSpark);
    }
    let flowers=0;
    for(const {x,y} of points){
      if(flowers>=Math.ceil(blooms*(compact?.65:1)))break;
      tuft(p,x-6,y+9,.5,C.grassInk);
      flower(p,x,y,flowers%3===0?C.pink:C.flower);flowers++;
    }
  }
  // Small stones form two planted groups rather than littering the play area.
  rock(p,155,184,.55);rock(p,169,190,.32);
  rock(p,815,466,.60);if(!compact)rock(p,830,470,.34);
  // A little worn texture at patch boundaries; the center remains mostly quiet.
  for(let i=0;i<42;i++){
    const x=145+random()*710,y=112+random()*387;
    if(!plantedGround(x,y)||(compact&&i%2))continue;
    p.rect(x,y,3+(i%5===0?3:0),3,i%4?C.grassDeep:C.grassSpark);
  }
}

export function paintLandscape(c,W,H){
  c.save();c.imageSmoothingEnabled=false;
  const p=pixelPainter(c,W,H),random=createSeededRandom(4817),compact=W<700;
  p.rect(0,0,1000,600,C.grass);
  // A connected sunlit clearing is surrounded by broad, quieter shaded banks.
  grassPatch(p,466,292,315,176,C.grassLight);
  grassPatch(p,192,135,237,49,C.grassLight);
  grassPatch(p,757,348,191,83,C.grassLight);
  for(const [x,y,rx,ry] of [[10,165,131,79],[12,363,119,94],[988,361,125,115],[797,224,142,28],[493,584,590,69]]){
    grassPatch(p,x,y,rx,ry,C.grassDeep);
  }
  // Light falls from the upper left. Cast shadows extend a few pixels rightward.
  grassPatch(p,17,86,139,30,C.shadowEdge);
  grassPatch(p,958,65,108,37,C.shadowEdge);
  // A narrow, stair-stepped dirt path bends through the lower margin.
  const path=[[111,597,27,36],[129,579,30,39],[150,561,33,36],[174,546,39,33],[204,534,42,30],[237,525,51,27],[279,519,72,27],[342,516,81,27],[414,519,87,27],[492,525,87,27],[570,531,99,27],[660,534,105,27],[756,540,81,27],[828,549,81,27],[900,561,108,27]];
  for(const [x,y,w,h] of path)p.rect(x-3,y-3,w+6,h+6,C.dirtEdge);
  for(const row of path)p.rect(...row,C.dirt);
  for(const [x,y,w,h] of path)p.rect(x+3,y+3,w-3,Math.max(6,h-15),C.dirtLight);
  for(let i=0;i<42;i++){
    const [x,y,w,h]=path[Math.floor(random()*path.length)];
    p.rect(x+random()*w,y+6+random()*(h-12),3+(i%3)*3,3,i%3?C.dirt:C.dirtEdge);
  }
  planting(p,random,{compact});
  // Cream fence, dark joinery, and square post caps.
  p.rect(78,81,594,6,C.shadowEdge);
  p.rect(75,75,594,6,C.grassShade);
  for(let x=84;x<=654;x+=39){
    p.rect(x+6,78,9,9,C.grassShade);p.rect(x+12,87,9,6,C.shadowEdge);
  }
  for(const y of [51,66]){
    p.rect(72,y+3,594,6,C.wood);p.rect(72,y,594,6,C.cream);
    p.rect(75,y,588,3,C.creamLight);
  }
  for(let x=84;x<=654;x+=39){
    p.rect(x+3,75,15,6,C.grassShade);p.rect(x,39,9,42,C.wood);
    p.rect(x-3,39,9,39,C.cream);p.rect(x,36,3,3,C.creamLight);
    p.rect(x-3,42,3,33,C.creamLight);p.rect(x+3,54,3,3,C.woodDark);p.rect(x+3,69,3,3,C.woodDark);
  }
  pond(p,c);
  // Trees frame the clearing. Their solid leaf tiles never cover seat rows.
  for(const [x,y,s] of [[-12,0,1.65],[64,-27,1.55],[153,-45,1.50],[245,-48,1.50],[338,-51,1.45],[426,-48,1.50],[518,-45,1.40],[615,-39,1.45],[704,-35,1.55],[797,-33,1.5],[892,-27,1.55],[987,-12,1.7],[-35,82,1.2],[1031,63,1.25],[-42,377,.9],[1042,405,1.05],[-21,592,1.1],[1016,592,1.25]])crown(p,x,y,s);
  // Low edge plants read as a planted border, not an opaque overlay.
  for(const [x,y] of [[32,112],[956,195],[18,463],[971,481],[56,565],[935,582]]){
    tuft(p,x,y,1.5,C.canopyMid);tuft(p,x+12,y+3,1,C.canopy);
  }
  c.restore();
}

export function paintForeground(c,W,H){
  c.clearRect(0,0,W,H);c.save();c.imageSmoothingEnabled=false;
  const p=pixelPainter(c,W,H),random=createSeededRandom(1981);
  // Only the unused outer twelve world units get an overlapping foreground.
  for(let x=6;x<1000;x+=18+Math.floor(random()*24)){
    const h=3+Math.floor(random()*3)*3;
    p.rect(x,600-h,3,h,C.canopy);p.rect(x+3,597,6,3,C.canopy);
    p.rect(x+9,600-h+3,3,h-3,C.canopyMid);
  }
  for(const x of [0,991])for(const y of [554,575,591]){
    p.rect(x,y,6,12,C.canopy);p.rect(x+3,y+6,6,9,C.canopyMid);
  }
  c.restore();
}

export function drawMeadowAtmosphere(c,W,H,time,{reducedMotion=false}={}){
  c.save();const p=pixelPainter(c,W,H),frame=reducedMotion?0:Math.floor(time*2);
  p.clip(pondRows(825,138,94,49));
  for(const [i,x,y] of [[0,812,133],[1,867,144],[2,843,105],[3,761,139]]){
    const phase=(frame+i*2)%6,shift=(phase<3?phase:6-phase)*3;
    p.rect(x-shift,y,15+shift*2,3,phase===0||phase===5?C.waterLight:C.foam);
    if(phase>1&&phase<5){p.rect(x-shift-3,y+3,3,3,C.waterLight);p.rect(x+15+shift,y+3,3,3,C.waterLight);}
  }
  c.restore();
}
