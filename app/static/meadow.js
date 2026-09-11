import { createMeadow, createSeededRandom } from './meadow-model.js?v=meadow2';

const byId = id => document.getElementById(id);

// Business information lives in a small letter opened over the full-screen game.
const aboutDialog = byId('about-dialog');
const helpDialog = byId('help-dialog');
function overlayChanged() { window.dispatchEvent(new Event('meadow-overlay-change')); }
function showDialog(dialog) {
  if (!dialog || dialog.open) return;
  dialog.showModal();
  dialog.scrollTop = 0;
  overlayChanged();
}
byId('open-about')?.addEventListener('click', () => showDialog(aboutDialog));
byId('open-help')?.addEventListener('click', () => showDialog(helpDialog));
byId('close-about')?.addEventListener('click', () => aboutDialog.close());
byId('close-help')?.addEventListener('click', () => helpDialog.close());
for (const dialog of [aboutDialog, helpDialog].filter(Boolean)) {
  dialog.addEventListener('close', overlayChanged);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
}
function openLinkedSection() {
  const target = document.getElementById(location.hash.slice(1));
  if (!target) return;
  const dialog = target.closest('dialog');
  if (dialog) showDialog(dialog);
  const disclosure = target.closest('details');
  if (disclosure) disclosure.open = true;
  if (dialog) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
}
window.addEventListener('hashchange', openLinkedSection);
document.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (link && link.origin === location.origin && link.pathname === location.pathname && link.hash === location.hash) openLinkedSection();
});
openLinkedSection();

const canvas = byId('meadow-canvas');
const ctx = canvas?.getContext('2d', { alpha: false });
if (ctx) startMeadow();
else if (byId('meadow-loading')) {
  byId('meadow-loading').textContent = 'The meadow cannot open in this browser. Choose About & contact to read my note and get in touch.';
}

function startMeadow() {
  let W = 1000, H = 600;
  let model = createMeadow({ seed: Date.now() });
  let tool = 'watch';
  let frame = 0, lastTime = 0, sceneVisible = true;
  let particles = [];
  let keyboardRing = false;
  let cursor = { x: W / 2, y: H / 2, visible: false };
  let viewWidth = 1000;
  let previousNumbers = '';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reducedMotion.matches;
  const background = document.createElement('canvas');
  background.width = W;
  background.height = H;
  const b = background.getContext('2d');
  paintLandscape(b, W, H);

  function status(message) {
    byId('meadow-status').textContent = message;
  }

  function counters() {
    const numbers = `${model.rabbits.length}/${model.bornCount}/${model.basket.length}`;
    if (numbers !== previousNumbers) {
      byId('rabbit-count').textContent = model.rabbits.length;
      byId('born-count').textContent = model.bornCount;
      byId('basket-count').textContent = model.basket.length;
      byId('release-rabbit').disabled = model.basket.length === 0;
      previousNumbers = numbers;
    }
  }

  function emit(x, y, kind = 'heart', count = 3) {
    for (let i = 0; i < count; i++) {
      particles.push({ x: x + (i - (count - 1) / 2) * 14, y: y - 25, age: -i * 0.1, kind });
    }
    particles = particles.slice(-60);
  }

  function consumeEvents() {
    const events = model.consumeEvents();
    const births = events.filter(event => event.type === 'birth');
    for (const birth of births) emit(birth.x, birth.y, 'heart', 5);
    if (births.length) status(births.length === 1
      ? 'A baby bunny! Give it a little time to grow. The meadow has a new neighbour.'
      : `${births.length} baby bunnies just arrived. A little more life in the meadow.`);
    if (births.length && model.totalCount === model.maxRabbits) {
      status('A full little family: 60 rabbits, including your basket. Enjoy the meadow or start a new one.');
    }
    counters();
  }

  function chooseTool(next) {
    tool = next;
    for (const name of ['watch', 'carrot', 'net']) {
      byId(`tool-${name}`).setAttribute('aria-pressed', String(name === tool));
    }
    canvas.setAttribute('aria-label', `Rabbit meadow. ${tool === 'net' ? 'Catch tool' : tool === 'carrot' ? 'Carrot tool' : 'Watch tool'} selected. Arrow keys move the ring; Enter uses the tool.`);
    status({ watch: 'Stay a while. Grown-up rabbits find a partner, share a heart, and welcome a baby.',
      carrot: 'Tap a patch of grass to leave a carrot. Curious rabbits will hop over.',
      net: 'Tap a rabbit to gently catch it. Your basket keeps it safe until you release it.' }[tool]);
    draw();
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(24, Math.min(W - 24, (event.clientX - rect.left) / rect.width * W)),
      y: Math.max(35, Math.min(H - 24, (event.clientY - rect.top) / rect.height * H)) };
  }

  function useTool(position) {
    const radius = Math.max(36, 26 * W / viewWidth);
    if (tool === 'net') {
      const rabbit = model.catchAt(position.x, position.y, radius);
      if (rabbit) {
        emit(rabbit.x, rabbit.y, 'spark', 4);
        status(model.rabbits.length
          ? 'One fluffy passenger in your basket. Use Release to send a rabbit back.'
          : 'Everyone is in your basket! Release a pair to bring the meadow back to life.');
      } else status('Almost! Tap a little closer to a rabbit, or leave a carrot to bring one over.');
    } else if (tool === 'carrot') {
      const carrot = model.addCarrot(position.x, position.y);
      status(carrot ? 'A carrot, just for them. Watch who comes over for a nibble.'
        : 'Try a free patch of grass. The meadow can hold six carrots at a time.');
      if (carrot) emit(carrot.x, carrot.y, 'spark', 2);
    } else {
      const rabbit = [...model.rabbits].sort((a, z) => Math.hypot(a.x - position.x, a.y - position.y) - Math.hypot(z.x - position.x, z.y - position.y))[0];
      if (rabbit && Math.hypot(rabbit.x - position.x, rabbit.y - position.y) <= radius) {
        emit(rabbit.x, rabbit.y, 'heart', 3);
        status(rabbit.adult ? 'Hello, little friend. A small hello goes a long way.' : 'The smallest new neighbour. Baby rabbits grow up as you watch.');
      } else status('There’s no hurry here. Try Carrot or Catch, or just watch the little lives unfold.');
    }
    consumeEvents();
    draw();
  }

  for (const name of ['watch', 'carrot', 'net']) byId(`tool-${name}`).addEventListener('click', () => chooseTool(name));
  canvas.addEventListener('pointermove', event => {
    cursor = { ...point(event), visible: event.pointerType !== 'touch' };
    keyboardRing = false;
    if (paused) draw();
  });
  canvas.addEventListener('pointerleave', () => {
    cursor.visible = false;
    if (paused) draw();
  });
  // A click, rather than pointerdown, lets visitors scroll past the meadow on a phone.
  canvas.addEventListener('click', event => {
    cursor = { ...point(event), visible: false };
    keyboardRing = false;
    useTool(cursor);
  });
  canvas.addEventListener('focus', () => { keyboardRing = true; draw(); });
  canvas.addEventListener('blur', () => { keyboardRing = false; draw(); });
  canvas.addEventListener('keydown', event => {
    const moves = { ArrowLeft: [-35, 0], ArrowRight: [35, 0], ArrowUp: [0, -35], ArrowDown: [0, 35] };
    if (moves[event.key]) {
      event.preventDefault();
      cursor.x = Math.max(24, Math.min(W - 24, cursor.x + moves[event.key][0]));
      cursor.y = Math.max(35, Math.min(H - 24, cursor.y + moves[event.key][1]));
      keyboardRing = true;
      draw();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      useTool(cursor);
    } else if (['w', 'c', 'n'].includes(event.key.toLowerCase())) {
      chooseTool({ w: 'watch', c: 'carrot', n: 'net' }[event.key.toLowerCase()]);
    }
  });

  function pauseLabel() {
    byId('pause-meadow').textContent = paused ? '▶ Play' : 'Ⅱ Pause';
    byId('pause-meadow').setAttribute('aria-pressed', String(paused));
    byId('meadow-stage').classList.toggle('is-paused', paused);
  }
  byId('pause-meadow').addEventListener('click', () => {
    paused = !paused;
    pauseLabel();
    status(paused ? 'A quiet moment. The meadow is paused; your tools still work.' : 'Life goes on. The rabbits are hopping again.');
    schedule();
    draw();
  });
  byId('release-rabbit').addEventListener('click', () => {
    const rabbit = model.releaseOne();
    if (rabbit) {
      emit(rabbit.x, rabbit.y, 'spark', 5);
      consumeEvents();
      status('Back on the grass. Welcome home, little rabbit.');
      draw();
    }
  });
  byId('reset-meadow').addEventListener('click', () => {
    model = createMeadow({ width: W, height: H, seed: Date.now() });
    particles = [];
    previousNumbers = '';
    chooseTool('watch');
    status('A fresh little meadow, with 12 rabbits to meet.');
    counters();
    draw();
  });
  reducedMotion.addEventListener('change', event => {
    if (event.matches) {
      paused = true;
      pauseLabel();
      schedule();
      draw();
      status('The meadow is paused for reduced motion. Press Play whenever you want.');
    }
  });

  function draw() {
    const sx = canvas.width / W, sy = canvas.height / H;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.drawImage(background, 0, 0);
    for (const carrot of model.carrots) drawCarrot(ctx, carrot.x, carrot.y, 1);
    for (const rabbit of [...model.rabbits].sort((a, z) => a.y - z.y)) {
      drawRabbit(ctx, rabbit, model.time);
    }
    for (const pair of model.pairs) {
      if (pair.phase !== 'nesting') continue;
      const x = pair.x, y = pair.y - 43;
      const bob = Math.sin(model.time * 3) * 3;
      ellipse(ctx, x, y + bob, 15, 14, '#fff8ee');
      heart(ctx, x, y + bob, 8, '#db8291');
    }
    for (const p of particles) {
      if (p.age < 0) continue;
      ctx.globalAlpha = Math.max(0, 1 - p.age / 1.6);
      const y = p.y - p.age * 26;
      if (p.kind === 'heart') heart(ctx, p.x, y, 7, '#df879a');
      else flower(ctx, p.x, y, 5, '#fff9da', '#d7ad60');
    }
    ctx.globalAlpha = 1;
    drawButterfly(ctx, W * (0.32 + Math.sin(model.time * 0.22) * 0.105), H * (0.157 + Math.sin(model.time * 0.39) * 0.037), model.time, '#e9b891');
    drawButterfly(ctx, W * (0.88 + Math.sin(model.time * 0.27 + 3) * 0.038), H * (0.688 + Math.sin(model.time * 0.48) * 0.05), model.time + 2, '#fbf4c8');
    if (cursor.visible || keyboardRing) {
      ctx.strokeStyle = '#426947';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.ellipse(cursor.x, cursor.y, tool === 'net' ? 31 : 24, tool === 'net' ? 22 : 16, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (tool === 'carrot') drawCarrot(ctx, cursor.x + 20, cursor.y - 22, 0.8);
      if (tool === 'net') drawNet(ctx, cursor.x + 15, cursor.y - 24);
      if (tool === 'watch') heart(ctx, cursor.x + 16, cursor.y - 25, 6, '#d4828f');
    }
    if (paused) {
      rounded(ctx, W / 2 - 114, H / 2 - 17, 228, 34, 17, '#f7f6e9');
      ctx.font = '12px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#496246';
      ctx.fillText('A QUIET MOMENT · PAUSED', W / 2, H / 2 + 5);
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Match the map to the viewport, without stretching rabbits or clipping play space.
    const unitsPerPixel = rect.width < 600 ? 1.25 : 0.95;
    const nextW = Math.max(240, Math.round(rect.width * unitsPerPixel));
    const nextH = Math.max(160, Math.round(rect.height * unitsPerPixel));
    if (nextW !== W || nextH !== H) {
      cursor.x = cursor.x / W * nextW;
      cursor.y = cursor.y / H * nextH;
      W = nextW; H = nextH;
      model.resize(W, H);
      particles = [];
      background.width = W;
      background.height = H;
      paintLandscape(b, W, H);
    }
    viewWidth = rect.width;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    draw();
  }
  function canRun() { return !paused && !document.hidden && sceneVisible && !aboutDialog?.open && !helpDialog?.open; }
  function tick(now) {
    frame = 0;
    if (!canRun()) { lastTime = 0; return; }
    if (!lastTime) lastTime = now;
    const elapsed = now - lastTime;
    if (elapsed >= 1000 / 30) {
      const dt = Math.min(elapsed / 1000, 0.1);
      lastTime = now;
      model.update(dt);
      for (const p of particles) p.age += dt;
      particles = particles.filter(p => p.age < 1.6);
      consumeEvents();
      draw();
    }
    frame = requestAnimationFrame(tick);
  }
  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    if (canRun()) frame = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('meadow-overlay-change', schedule);
  new IntersectionObserver(entries => {
    sceneVisible = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.05;
    schedule();
  }, { threshold: 0.05 }).observe(canvas);
  new ResizeObserver(resize).observe(canvas);
  byId('meadow-loading').hidden = true;
  counters();
  pauseLabel();
  chooseTool('watch');
  if (paused) status('A peaceful start for reduced motion. Press Play to bring the meadow to life.');
  resize();
  schedule();
}

function ellipse(c, x, y, rx, ry, color, angle = 0) {
  c.beginPath(); c.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); c.fillStyle = color; c.fill();
}
function rounded(c, x, y, w, h, r, color) {
  c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = color; c.fill();
}
function line(c, points, color, width = 2) {
  c.beginPath(); c.moveTo(...points[0]);
  for (const p of points.slice(1)) c.lineTo(...p);
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
function heart(c, x, y, size, color) {
  c.beginPath(); c.moveTo(x, y + size * 0.7);
  c.bezierCurveTo(x - size * 1.7, y - size * 0.4, x - size * 0.7, y - size * 1.3, x, y - size * 0.45);
  c.bezierCurveTo(x + size * 0.7, y - size * 1.3, x + size * 1.7, y - size * 0.4, x, y + size * 0.7);
  c.fillStyle = color; c.fill();
}
function flower(c, x, y, size, petal, center) {
  for (let i = 0; i < 5; i++) ellipse(c, x + Math.cos(i * 1.256) * size * 0.6, y + Math.sin(i * 1.256) * size * 0.6, size * 0.5, size * 0.5, petal);
  ellipse(c, x, y, size * 0.3, size * 0.3, center);
}
function drawRabbit(c, rabbit, time) {
  const size = rabbit.adult ? 1 : 0.58 + Math.min(rabbit.age / 30, 1) * 0.2;
  const hop = rabbit.moving ? Math.sin(rabbit.hopProgress * Math.PI) * 9 : 0;
  const d = rabbit.direction || 1;
  const breathe = 1 + Math.sin(time * 2 + rabbit.id) * 0.018;
  ellipse(c, rabbit.x, rabbit.y + 3, 22 * size, 7 * size, '#9eb77555');
  c.save(); c.translate(rabbit.x, rabbit.y - hop); c.scale(d * size, size);
  // Back ear, cloud-like body, and a small cotton tail.
  ellipse(c, 8, -31, 5, 14, '#e8ebdc', 0.17);
  ellipse(c, 8, -32, 2.4, 9, '#edbcc0', 0.17);
  ellipse(c, -4, -10, 21, 15 * breathe, '#b9c5a1');
  ellipse(c, -4, -12, 21, 15 * breathe, '#fffef4');
  ellipse(c, -23, -11, 7, 7, '#ffffff');
  ellipse(c, -11, -1, 10, 4, '#f3f4e7');
  ellipse(c, 11, 0, 7, 3.5, '#e7ecd8');
  ellipse(c, 12, -17, 12, 11, '#fffef4');
  ellipse(c, 16, -34, 4.8, 13, '#fffef4', 0.25);
  ellipse(c, 16, -35, 2.1, 8.2, '#efbec0', 0.25);
  if (!rabbit.moving && Math.sin(time * 0.6 + rabbit.id * 2) > 0.994) {
    line(c, [[16, -20], [19, -20]], '#465a47', 1.4);
  } else ellipse(c, 18, -20, 1.8, 2.1, '#435444');
  ellipse(c, 21.5, -13, 3, 1.8, '#f0c5bc');
  ellipse(c, 24.5, -16, 1.6, 1.4, '#c48e83');
  line(c, [[22, -12], [25, -11.5]], '#c4c9b5', 0.8);
  if (!rabbit.adult) flower(c, -10, -26, 3.7, '#fcf0c6', '#dca964');
  c.restore();
}
function drawCarrot(c, x, y, size) {
  c.save(); c.translate(x, y); c.rotate(-0.4); c.scale(size, size);
  ellipse(c, 0, 4, 12, 4, '#819b6333');
  line(c, [[0, -9], [-8, -21]], '#658849', 4);
  line(c, [[0, -9], [1, -24]], '#89a658', 4);
  line(c, [[0, -9], [8, -19]], '#6f954c', 4);
  c.beginPath(); c.moveTo(-6, -12); c.quadraticCurveTo(0, -16, 6, -12); c.quadraticCurveTo(7, -3, 0, 10); c.quadraticCurveTo(-8, -4, -6, -12); c.fillStyle = '#e9a05f'; c.fill();
  line(c, [[-5, -5], [-1, -4]], '#c57e47', 1);
  line(c, [[1, 0], [4, -1]], '#c57e47', 1);
  c.restore();
}
function drawNet(c, x, y) {
  c.save(); c.translate(x, y); c.rotate(0.3);
  line(c, [[0, 4], [0, 29]], '#b68a5b', 4);
  ellipse(c, 0, -8, 15, 20, '#fffbee66');
  c.beginPath(); c.ellipse(0, -8, 15, 20, 0, 0, Math.PI * 2); c.strokeStyle = '#738b66'; c.lineWidth = 2; c.stroke();
  for (let j = -1; j <= 1; j++) line(c, [[-12, j * 7 - 8], [12, j * 7 - 8]], '#879c7277', 1);
  for (let j = -1; j <= 1; j++) line(c, [[j * 7, -23], [j * 7, 6]], '#879c7277', 1);
  c.restore();
}
function drawButterfly(c, x, y, time, color) {
  const flap = 2.5 + Math.abs(Math.sin(time * 4)) * 3;
  ellipse(c, x - flap * 0.6, y - 2, flap, 4, color, -0.4);
  ellipse(c, x + flap * 0.6, y - 2, flap, 4, color, 0.4);
  line(c, [[x, y - 3], [x, y + 3]], '#687b4c', 1);
}

function paintLandscape(c, W, H) {
  c.save();
  const X = x => x * W / 1000;
  const Y = y => y * H / 600;
  // Place scenery relative to the viewport, but keep each object proportional.
  const size = Math.max(0.75, Math.min(1.2, Math.sqrt(W * H / 600000)));
  const density = Math.max(0.65, Math.min(1.6, W * H / 600000));
  const random = createSeededRandom(31415);
  const gradient = c.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, '#dce9bc'); gradient.addColorStop(1, '#c6dba3');
  c.fillStyle = gradient; c.fillRect(0, 0, W, H);
  // Soft patches give the grass depth without a single image request.
  for (let i = 0; i < Math.round(50 * density); i++) ellipse(c, random() * W, random() * H, (30 + random() * 90) * size, (15 + random() * 50) * size, i % 2 ? '#e5eec335' : '#a9c58b20');
  c.beginPath(); c.moveTo(X(165), Y(610)); c.bezierCurveTo(X(310), Y(478), X(320), Y(486), X(490), Y(499)); c.bezierCurveTo(X(683), Y(514), X(840), Y(515), X(1020), Y(564));
  c.strokeStyle = '#d5d5a2'; c.lineWidth = 38 * size; c.lineCap = 'round'; c.stroke();
  c.strokeStyle = '#e0dcb2'; c.lineWidth = 28 * size; c.stroke();
  for (let i = 0; i < Math.round(155 * density); i++) {
    const x = 20 * size + random() * (W - 40 * size), y = 30 * size + random() * (H - 50 * size);
    const height = (3 + random() * 6) * size;
    line(c, [[x - 4 * size, y - height * 0.6], [x, y + size], [x + 2 * size, y - height]], '#93af7170', 1.3 * size);
  }
  // An oval pond, matching the collision boundary in the simulation model.
  const pondX = X(825), pondY = Y(135), pondRX = X(100), pondRY = Y(58);
  ellipse(c, pondX, pondY + 5 * size, pondRX + 16 * size, pondRY + 12 * size, '#b0c38e');
  ellipse(c, pondX, pondY, pondRX + 4 * size, pondRY + 4 * size, '#c1d3a2');
  ellipse(c, pondX, pondY, pondRX, pondRY, '#83b8ad');
  ellipse(c, pondX, pondY + pondRY * 0.07, pondRX * 0.94, pondRY * 0.86, '#9bc9b6');
  for (const p of [[797, 123, 22], [850, 151, 31], [840, 99, 16]]) {
    const halfWidth = Math.min(p[2] * size, pondRX * 0.45);
    line(c, [[X(p[0]) - halfWidth, Y(p[1])], [X(p[0]) + halfWidth, Y(p[1])]], '#d5e8d090', 2 * size);
  }
  ellipse(c, X(785), Y(154), 13 * size, 7 * size, '#739c68'); flower(c, X(784), Y(150), 5 * size, '#f5d4d3', '#e3b470');
  ellipse(c, X(867), Y(114), 10 * size, 6 * size, '#6b9864');
  for (const [baseX, baseY, baseSize] of [[740, 180, 14], [757, 188, 9], [920, 114, 12], [911, 99, 9]]) {
    const x = X(baseX), y = Y(baseY), s = baseSize * size;
    ellipse(c, x, y + 3 * size, s, s * 0.5, '#a7b790');
    ellipse(c, x, y, s, s * 0.6, '#dadcc1');
    ellipse(c, x - 3 * size, y - 2 * size, s * 0.5, s * 0.26, '#e7e6ce');
  }
  for (let i = 0; i < 8; i++) {
    const x = X(889 + random() * 42), y = Y(166 + random() * 20);
    line(c, [[x, y], [x - 3 * size, y - (22 + random() * 12) * size]], '#74965e', 2 * size);
    line(c, [[x, y], [x + 8 * size, y - 17 * size]], '#88a466', 2 * size);
  }
  // A small, sun-bleached garden fence.
  const fenceY = Y(64);
  for (let x = X(85); x < X(645); x += 38 * size) {
    line(c, [[x, fenceY - 15 * size], [x, fenceY + 15 * size]], '#bdbe8d', 8 * size);
    line(c, [[x - size, fenceY - 16 * size], [x - size, fenceY + 10 * size]], '#f3ecd0', 7 * size);
  }
  line(c, [[X(70), fenceY - 7 * size], [X(659), fenceY - 7 * size]], '#e9e3bd', 5 * size);
  line(c, [[X(70), fenceY + 6 * size], [X(659), fenceY + 6 * size]], '#eee8c9', 5 * size);
  function shrub(baseX, baseY, baseSize, tint = '#8aa76a') {
    const x = X(baseX), y = Y(baseY), s = baseSize * size;
    ellipse(c, x + 4 * size, y + 10 * size, s * 1.08, s * 0.5, '#8aa36940');
    ellipse(c, x - s * 0.4, y, s * 0.67, s * 0.62, tint);
    ellipse(c, x + s * 0.4, y + size, s * 0.65, s * 0.61, tint);
    ellipse(c, x, y - s * 0.2, s * 0.8, s * 0.7, tint);
    for (let i = 0; i < 10; i++) ellipse(c, x + (random() - 0.5) * s * 1.6, y + (random() - 0.4) * s * 0.7, 2 * size, 1.2 * size, '#c4d49470');
  }
  shrub(34, 52, 69, '#9eb77b'); shrub(-13, 170, 54); shrub(992, 37, 83, '#a5bb80');
  shrub(975, 270, 46, '#a5bb80'); shrub(42, 564, 61, '#91ab70'); shrub(955, 584, 71, '#89a66b');
  shrub(55, 600, 51, '#789762'); shrub(1010, 531, 51, '#91ad70');
  for (const patch of [[153, 198], [653, 355], [798, 449], [289, 369], [524, 133], [140, 525]]) {
    for (let i = 0; i < Math.round(8 * Math.sqrt(density)); i++) {
      const x = X(patch[0]) + (random() - 0.5) * 65 * size, y = Y(patch[1]) + (random() - 0.5) * 39 * size;
      line(c, [[x, y], [x + size, y + 7 * size]], '#9bb775', size);
      flower(c, x, y, (3 + random() * 2.5) * size, i % 3 ? '#fff9dc' : '#e8c2be', '#d0ac58');
    }
  }
  // Keep the little sign above the bottom controls, with naturally sized type.
  const signX = Math.max(76 * size, Math.min(W - 76 * size, X(140))), signY = Y(410);
  line(c, [[signX, signY + 10 * size], [signX, signY + 44 * size]], '#b29a6d', 5 * size);
  rounded(c, signX - 69 * size, signY - 13 * size, 140 * size, 32 * size, 4 * size, '#c0af7e');
  rounded(c, signX - 70 * size, signY - 16 * size, 140 * size, 32 * size, 4 * size, '#f0e7c4');
  c.font = `italic ${13 * size}px Georgia, serif`; c.textAlign = 'center'; c.fillStyle = '#66774e';
  c.fillText('a little room to grow', signX, signY + 5 * size);
  c.restore();
}
