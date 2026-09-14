// Integer-grid sprites are cached by callers, not repainted during the loop.
export function makePixelSprite(width,height,palette,paint){
  const cells=Array.from({length:height},()=>Array(width).fill(null));
  const rect=(x,y,w,h,color)=>{
    for(let row=Math.max(0,y);row<Math.min(height,y+h);row++)
      for(let col=Math.max(0,x);col<Math.min(width,x+w);col++)cells[row][col]=color;
  };
  const rows=(x,y,lines,color)=>lines.forEach(([offset,length],i)=>rect(x+offset,y+i,length,1,color));
  paint({rect,rows});
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;c.fillStyle=palette.outline;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    if(!cells[y][x]&&[cells[y-1][x],cells[y+1][x],cells[y][x-1],cells[y][x+1]].some(Boolean))c.fillRect(x,y,1,1);
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(cells[y][x]){
    c.fillStyle=palette[cells[y][x]]||cells[y][x];c.fillRect(x,y,1,1);
  }
  return canvas;
}
export function blitSprite(c,sprite,x,y,scale=1,direction=1,anchorX=sprite.width/2,anchorY=sprite.height-2){
  c.save();c.imageSmoothingEnabled=false;c.translate(Math.round(x),Math.round(y));c.scale(direction<0?-1:1,1);
  c.drawImage(sprite,0,0,sprite.width,sprite.height,
    Math.round(-anchorX*scale),Math.round(-anchorY*scale),Math.round(sprite.width*scale),Math.round(sprite.height*scale));
  c.restore();
}
