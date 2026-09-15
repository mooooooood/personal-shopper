import { makePixelSprite, blitSprite } from './pixel-sprite.js?v=meadow16';

const frames = new Map();
const palette = {
  outline: '#61482f', dark: '#a46935', base: '#d79a4d', light: '#f0c477',
  cream: '#fff0bf', ear: '#b67b3f', nose: '#3d392b', tongue: '#df8275',
  collar: '#367e99', collarLight: '#71bac2', tag: '#f6d578',
};

function dogSprite(frame) {
  if (frames.has(frame)) return frames.get(frame);
  const sprite = makePixelSprite(49,35,palette,({rect,rows}) => {
    const running = frame !== 0;
    const stride = running ? [0,3,0,-3][frame-1] : 0;
    const tailUp = frame === 1 || frame === 3;
    const earLift = frame === 2 ? 1 : 0;

    // A high, cream-tipped wag and floppy ears keep this dog distinct from the wolf.
    rect(10,16,5,5,'base');rect(7,13,5,5,'base');
    rect(5,tailUp ? 7 : 10,4,6,'base');
    rect(tailUp ? 6 : 3,tailUp ? 5 : 8,3,4,'cream');

    // Far legs are shaded; each pair reaches opposite the near pair.
    rect(16+stride,23,3,8,'dark');rect(16+stride,30,5,2,'ear');
    rect(31-stride,22,3,8,'dark');rect(31-stride,29,5,2,'ear');

    rows(0,14,[[17,12],[15,18],[13,21],[12,23],[12,24],[12,24],
      [12,24],[13,23],[13,22],[14,21],[15,19],[17,15]],'base');
    rect(17,15,12,2,'light');rect(14,17,3,4,'light');
    rect(18,23,14,3,'dark');rect(27,19,8,6,'cream');

    // An open, blunt muzzle, rounded head, and tiny tongue make a friendly silhouette.
    rows(0,7,[[34,6],[32,10],[31,12],[31,12],[31,13],[31,13],
      [32,13],[32,14],[32,14],[33,12],[33,11],[34,9]],'base');
    rect(35,8,5,2,'light');rect(39,13,6,4,'cream');
    rect(43,12,3,2,'nose');rect(38,11,2,2,'nose');
    rect(39,15,5,1,'nose');rect(41,16,2,3,'tongue');
    rect(31,9-earLift,4,10,'ear');rect(32,17-earLift,4,4,'dark');
    rect(31,10-earLift,2,6,'light');

    // The blue collar and square brass tag remain visible while running left or right.
    rect(32,20,5,3,'collar');rect(33,20,3,1,'collarLight');
    rect(35,23,2,3,'tag');

    rect(17-stride,24,3,7,'base');rect(17-stride,30,6,3,'cream');
    rect(30+stride,24,3,7,'light');rect(30+stride,30,6,3,'cream');
  });
  frames.set(frame,sprite);
  return sprite;
}

export function drawDog(c,dog,time) {
  const scale = dog.renderScale ?? 1;
  const direction = dog.direction < 0 ? -1 : 1;
  const phase = time*8;
  const frame = dog.moving ? 1+Math.floor(phase)%4 : 0;
  const lift = dog.moving && (frame === 2 || frame === 4) ? 2*scale : 0;

  c.save();
  c.globalAlpha *= .23;
  c.fillStyle = '#354e36';
  c.fillRect(Math.round(dog.x-29*scale),Math.round(dog.y+2*scale),
    Math.round(58*scale),Math.max(1,Math.round(6*scale)));
  c.restore();
  blitSprite(c,dogSprite(frame),dog.x,dog.y-lift,2*scale,direction,26,33);

  // A brief pixel bark is only a visual cue; all herding happens in the shared world.
  if (dog.moving && time%3.2 < .3) {
    c.save();
    c.fillStyle = '#fff0bf';
    const x = dog.x+direction*45*scale;
    const y = dog.y-36*scale-lift;
    const unit = Math.max(1,Math.round(2*scale));
    c.fillRect(Math.round(x),Math.round(y),unit*2,unit);
    c.fillRect(Math.round(x-direction*3*scale),Math.round(y-7*scale),unit,unit*2);
    c.fillRect(Math.round(x-direction*3*scale),Math.round(y+5*scale),unit,unit*2);
    c.restore();
  }
}
