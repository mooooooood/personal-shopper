// Environmental clues follow the shared encounter clock. They never start an
// encounter, choose a victim, or run a second wildlife simulation in the browser.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function wildlifeCueFrame(state, {width, height, reducedMotion = false}) {
  const event = state?.encounter;
  if (!event || !['eagle', 'wolf'].includes(event.kind)
    || !['warning', 'chasing'].includes(event.phase)
    || !(width > 0 && height > 0)) return null;
  if (event.phase === 'chasing' && (event.kind !== 'wolf' || reducedMotion)) return null;

  const progress = clamp(1 - event.remaining / 3, 0, 1);
  let x = event.x, y = event.y;
  const target = event.phase === 'chasing'
    ? state.rabbits?.find(rabbit => rabbit.id === event.targetId) : null;
  let dx = target ? target.x - x : 500 - x;
  let dy = target ? target.y - y : 300 - y;
  if (Math.hypot(dx, dy) < .001) { dx = event.direction; dy = 0; }
  const distance = Math.hypot(dx, dy);
  if (event.kind === 'eagle') {
    // A high bird casts a shadow farther into the meadow before it descends.
    // Its entry side and the whole three-second pass come from the server.
    const pass = reducedMotion ? 90 : 18 + progress * 175;
    x += dx / distance * pass;
    y += dy / distance * pass;
  }
  return {
    type: event.phase === 'chasing' ? 'dust' : event.kind,
    x: x / 1000 * width, y: y / 600 * height,
    heading: Math.atan2(dy * height / 600, dx * width / 1000),
    time: reducedMotion ? 0 : state.time,
    progress, reducedMotion,
    size: clamp(Math.sqrt(width * height / 600000), .62, 1.15),
    opacity: event.kind === 'eagle'
      ? reducedMotion ? .19 : .11 + Math.sin(progress * Math.PI) * .11 : .86,
  };
}

function oval(c, x, y, rx, ry) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
}

function eagleShadow(c, frame) {
  c.rotate(frame.heading);
  c.globalAlpha = frame.opacity;
  c.fillStyle = '#415b43';
  // One silhouette avoids darker overlaps at the wings and body. Its long
  // feathers read as a bird even without colour, text, or a flashing marker.
  c.beginPath(); c.moveTo(34, 0);
  c.lineTo(21, 7); c.quadraticCurveTo(9, 10, 2, 6);
  c.bezierCurveTo(-1, 24, 10, 47, -15, 72);
  c.lineTo(-11, 49); c.lineTo(-23, 67); c.lineTo(-18, 45);
  c.lineTo(-31, 60); c.lineTo(-22, 35);
  c.quadraticCurveTo(-22, 18, -15, 8);
  c.lineTo(-38, 12); c.lineTo(-32, 0); c.lineTo(-38, -12);
  c.lineTo(-15, -8); c.quadraticCurveTo(-22, -18, -22, -35);
  c.lineTo(-31, -60); c.lineTo(-18, -45); c.lineTo(-23, -67);
  c.lineTo(-11, -49); c.lineTo(-15, -72);
  c.bezierCurveTo(10, -47, -1, -24, 2, -6);
  c.quadraticCurveTo(9, -10, 21, -7); c.closePath(); c.fill();
}

function rustlingGrass(c, frame) {
  c.globalAlpha = frame.opacity;
  c.fillStyle = '#718c5940'; oval(c, 0, 4, 38, 10);
  const sway = frame.reducedMotion ? 0
    : Math.sin(frame.time * 13) * (1.5 + frame.progress * 2.2);
  c.lineCap = 'round'; c.lineWidth = 2.7;
  for (let i = 0; i < 15; i++) {
    const x = (i - 7) * 4.7, tall = 14 + (i * 7 % 13);
    const tip = x * 1.13 + sway * Math.cos(i * .8);
    c.strokeStyle = i % 3 ? '#789654' : '#a1b977';
    c.beginPath(); c.moveTo(x, 5 + Math.abs(i - 7) * .25);
    c.quadraticCurveTo(x + sway * .5, -tall * .5, tip, -tall);
    c.stroke();
  }
  // Two still, low eyes are a readable hint when motion is reduced or paused.
  c.fillStyle = '#48553a'; oval(c, -6, -7, 7, 3); oval(c, 6, -7, 7, 3);
  c.fillStyle = '#d4be72'; oval(c, -6, -7, 1.5, 1.2); oval(c, 6, -7, 1.5, 1.2);
}

function wolfDust(c, frame) {
  c.rotate(frame.heading);
  for (let i = 0; i < 4; i++) {
    const age = (frame.time * 2.1 + i * .25) % 1;
    const x = -11 - age * 29, y = (i % 2 ? -1 : 1) * (5 + age * 5);
    c.globalAlpha = (1 - age) * .18;
    c.fillStyle = '#a09568'; oval(c, x, y, 5 + age * 8, 3 + age * 4);
    c.globalAlpha = (1 - age) * .2;
    c.fillStyle = '#8b855e'; oval(c, x, y, 2.5, 2);
    oval(c, x + 3, y - 1.8, 1, .8); oval(c, x + 3, y + 1.8, 1, .8);
  }
}

// Draw on top of the landscape, before carrots, ropes, rabbits and seats.
// During warning the caller hides the predator sprite; these are its clues.
export function drawWildlifeCues(ctx, state, options) {
  const frame = wildlifeCueFrame(state, options);
  if (!frame) return;
  ctx.save(); ctx.translate(frame.x, frame.y); ctx.scale(frame.size, frame.size);
  if (frame.type === 'eagle') eagleShadow(ctx, frame);
  else if (frame.type === 'wolf') rustlingGrass(ctx, frame);
  else wolfDust(ctx, frame);
  ctx.restore();
}
