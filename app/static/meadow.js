import { drawRabbit } from './rabbit-art.js?v=meadow19';
import { createAutoLassoPuller } from './lasso-pull.js?v=meadow16';
import { createSnapshotBuffer, toWorldPoint } from './meadow-model.js?v=meadow16';
import { seatName, seatPalette, recentSeatResult, seatResultMessage } from './meadow-seats.js?v=meadow16';

import { drawCast, drawRetractingCast, drawLandingDust } from './meadow-cast.js?v=meadow16';
import { drawWildlifeCues } from './meadow-cues.js?v=meadow16';
import { drawBurrows, drawBurrowRabbit } from './meadow-burrows.js?v=meadow19';

import { paintLandscape, paintForeground, drawMeadowAtmosphere, rabbitRenderScale } from './meadow-scene.js?v=meadow19';

import { drawPixelWildlife, drawPixelCarrot } from './meadow-sprites.js?v=meadow16';
import { drawDog } from './meadow-dog.js?v=meadow16';

const byId = id => document.getElementById(id);

// Business information lives in a small letter opened over the full-screen game.
const aboutDialog = byId('about-dialog');
const overlayOpen = () => Boolean(aboutDialog?.open);
function restContactButton() { byId('open-about')?.classList.toggle('is-resting', overlayOpen() || document.hidden); }
function overlayChanged() {
  byId('open-about')?.setAttribute('aria-expanded', String(overlayOpen()));
  restContactButton();
  window.dispatchEvent(new Event('meadow-overlay-change'));
}
document.addEventListener('visibilitychange', restContactButton);
function showDialog(dialog) {
  if (!dialog || dialog.open) return;
  dialog.showModal();
  dialog.scrollTop = 0;
  overlayChanged();
}
byId('open-about')?.addEventListener('click', () => showDialog(aboutDialog));
byId('close-about')?.addEventListener('click', () => aboutDialog.close());
for (const dialog of [aboutDialog].filter(Boolean)) {
  dialog.addEventListener('close', overlayChanged);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
}
function openLinkedSection() {
  // Older category links still lead to a direct conversation.
  const target = document.getElementById(location.hash === '#request' ? 'contact' : location.hash.slice(1));
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
  let W = 1000, H = 600, tool = null;
  const buffer = createSnapshotBuffer();
  let frame = 0, lastTime = 0, particles = [];
  let cursor = {x:500, y:300, visible:false}, keyboardRing = false;
  let connected = false, pending = false, polling = false, pollTimer = 0, failures = 0;
  let rendered = null, seatFeed = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const background = document.createElement('canvas');
  const b = background.getContext('2d');
  const foreground=document.createElement('canvas'),front=foreground.getContext('2d');
  const status = message => { byId('meadow-status').textContent = message; };
  const projected = item => ({...item, x:item.x / 1000 * W, y:item.y / 600 * H, renderScale:rabbitRenderScale(item.y)});
  const playerId = (()=>{
    try {
      const saved=localStorage.getItem('meadow.player.v1');
      if(saved&&/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(saved))return saved;
      const value=requestId();localStorage.setItem('meadow.player.v1',value);return value;
    }catch{return requestId();}
  })();
  const ownLasso = state => (state?.lassos || []).find(lasso=>lasso.id===state.myLassoId);
  const puller=createAutoLassoPuller({send:sendLasso,accept,change:controls,error:cause=>{
    if(['lasso_gone','not_yours'].includes(cause.message))return;
    connection(false);status('The rope is resting while we reconnect. Pulling stops when the connection is lost.');queuePoll(1000);
  }});

  function controls() {
    const blocked = !connected || pending;
    byId('tool-carrot').disabled = blocked;
    byId('tool-net').disabled = blocked || (buffer.latest?.seats && buffer.latest.mySeatId==null);
    byId('release-dog').disabled = blocked || Boolean(buffer.latest?.dog) || buffer.latest?.mySeatId == null;
    const own=ownLasso(buffer.latest);
    byId('lasso-controls').hidden=!own;
    byId('cancel-lasso').disabled=blocked||!own;
  }
  function followRope(){
    puller.update(buffer.latest?.myLassoId??null,
      connected&&!pending&&!document.hidden&&!overlayOpen());
  }
  function connection(ok) {
    if(ok && !connected && rendered)status('Back in the shared meadow.');
    connected = ok;
    followRope();
    if(!ok)byId('seat-status').textContent='Connection lost. Rejoining the meadow…';
    controls();
    schedule();
  }
  function updateIndicators(state) {
    if (!state) return;
    presence(state);
    const dogButton=byId('release-dog'),dogLabel=byId('dog-label');
    const label=state.dog?`Dog · ${Math.max(1,Math.ceil(state.dog.remaining))}s`:'Let dog out';
    if(dogLabel.textContent!==label)dogLabel.textContent=label;
    dogButton.dataset.active=String(Boolean(state.dog));
    const own=ownLasso(state);
    if(own){
      const percent=Math.round(own.progress*100);
      byId('lasso-progress').value=own.phase==='casting'?own.castElapsed/own.castDuration:own.progress;
      const label=own.phase==='casting'?'Casting · watch the landing':`${own.pulling?'Reeling in':'Rope ready'} · ${percent}% · ${Math.ceil(own.remaining)}s`;
      if(byId('lasso-label').textContent!==label)byId('lasso-label').textContent=label;
    }
  }
  function presence(state) {
    if(!state.seats)return;
    const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
    if(connected)text(byId('seat-status'),state.mySeatId==null
      ? 'Watching. You will join when a seat opens.' : `You are at ${seatName(state.mySeatId).toLowerCase()}.`);
    const show=seatFeed&&state.time-seatFeed.time<8&&state.time>=seatFeed.time;
    byId('seat-feed').hidden=!show;
    if(show)text(byId('seat-feed'),seatResultMessage(seatFeed));
  }
  function emit(item, kind = 'heart', count = 3) {
    if(reducedMotion.matches)return;
    const p = projected(item);
    for (let i = 0; i < count; i++) particles.push({x:p.x + (i-(count-1)/2)*14, y:p.y-25, age:-i*0.1, kind});
    particles = particles.slice(-60);
  }
  function accept(state) {
    const old = buffer.latest;
    const changed = buffer.accept(state, performance.now());
    if(!changed){
      if(old?.epoch===state.epoch&&old.revision===state.revision)connection(true);
      return;
    }
    const previousLasso=ownLasso(old);
    const outcome=previousLasso && (state.lassoResults||[]).find(result=>result.id===previousLasso.id);
    if(old?.epoch!==state.epoch)seatFeed=null;
    else {
      const priorResults=new Set((old.lassoResults||[]).map(result=>result.id));
      const sharedResults=(state.lassoResults||[]).filter(result=>result.seatId!=null
        &&result.seatId!==state.mySeatId&&!priorResults.has(result.id));
      if(sharedResults.length)seatFeed=sharedResults.at(-1);
    }
    if (changed && old?.epoch === state.epoch && !overlayOpen()) {
      const oldIds = new Set([...old.rabbits, ...old.basket].map(rabbit => rabbit.id));
      const babies = state.rabbits.filter(rabbit => !oldIds.has(rabbit.id) && !rabbit.adult);
      for (const rabbit of babies) emit(rabbit, 'heart', 5);
      if (babies.length && !state.encounter && !ownLasso(state) && !outcome) status('A new baby, a surprise coat. Meet the meadow’s newest neighbour!');
    }
    if (changed && state.encounter && !overlayOpen()
      && (old?.encounter?.id !== state.encounter.id || old?.encounter?.phase !== state.encounter.phase)) {
      const event = state.encounter, animal = event.kind === 'eagle' ? 'An eagle' : 'A grey wolf';
      status(event.phase === 'warning' ? `${animal} is nearby. Rabbits on a rope are still out in the open.`
        : event.phase === 'chasing' ? `${animal} is approaching! Your rope is still out in the open.`
        : event.carrying ? `${animal} carried a rabbit away. The rest of the meadow keeps growing.`
        : `${animal} is leaving empty-handed. A lucky moment for the meadow.`);
    }
    if(previousLasso?.phase==='casting'&&ownLasso(state)?.phase==='reeling'&&!overlayOpen())
      status('The loop landed! Reeling home now — keep an eye on the grass.');
    if(outcome){
      status({caught:'Home safe! Your rabbit reached the shared basket.',
        stolen:'Snatched from the rope! The visitor got there before the basket.',
        escaped:'The rope went slack. Your rabbit is free again.',
        cancelled:'You let go. The rabbit is back on the grass.',
        missed:'Just missed! Try leading a hopping rabbit, or tempt it with a carrot.'}[outcome.outcome]);
    }
    if(state.mySeatId!=null&&old&&old.mySeatId!==state.mySeatId)
      status(`${seatName(state.mySeatId)} is yours. Your rope will bring rabbits back here.`);
    if (!old) {
      byId('meadow-loading').hidden = true;
      if (!state.encounter && !state.dog) status('A little meadow to share. Choose a tool, or let the dog out for a run.');
    }
    if(state.dog && old?.dog?.id!==state.dog.id && !overlayOpen())
      status('The dog is out! Nearby rabbits will hop away for 20 seconds.');
    else if(old?.dog && !state.dog && !overlayOpen())
      status('The dog has gone home. A quiet meadow again.');
    connection(true);
    draw();
  }
  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {...options,headers:{...options.headers,'X-Meadow-Player':playerId}, cache:'no-store', signal:controller.signal});
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.code || 'request_failed');
        error.status = response.status;
        throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }
  function queuePoll(delay) {
    clearTimeout(pollTimer);
    if (!document.hidden) pollTimer = setTimeout(poll, delay);
  }
  async function poll() {
    if (polling || document.hidden) return;
    polling = true;
    controls();
    try {
      accept(await request('/api/meadow'));
      failures = 0;
    } catch {
      failures++;
      connection(false);
      status('The connection is resting. Reconnecting to the shared meadow; tools will return when it does.');
      if (!buffer.latest) byId('meadow-loading').textContent = 'Connecting to the shared meadow…';
    } finally {
      polling = false;
      controls();
      queuePoll(failures ? Math.min(15000, 1000 * 2 ** Math.min(failures,4)) : overlayOpen() ? 3000 : 1000);
    }
  }
  function requestId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  async function sendLasso(action,lassoId) {
    return request('/api/meadow/actions',{method:'POST',headers:{'Content-Type':'application/json','X-Meadow-Client':'1'},
      body:JSON.stringify({action,lassoId,requestId:requestId()})});
  }
  async function action(details) {
    if (!connected || pending) return;
    pending = true;
    followRope();
    controls();
    const body = JSON.stringify({...details, requestId:requestId()});
    try {
      const result = await request('/api/meadow/actions', {method:'POST', headers:{'Content-Type':'application/json','X-Meadow-Client':'1'}, body});
      accept(result.state);
      const messages = {
        lassoed:'Rope away! A moving rabbit can dodge the landing.',
        meadow_full:'All eight seats are taken. Watch the others; you will join when a seat opens.',
        seat_busy:'This seat already has a rope. Wait for it to return before casting again.',
        lasso_cancelled:'You let go. The rabbit is free again.',
        rabbit_roped:'Another visitor already has this rabbit on a rope.',
        player_busy:'Bring your current rabbit home or let go before casting again.',
        lasso_limit:'The meadow has enough ropes for now. Try again in a moment.',
        lasso_gone:'That rope has already gone. Check the meadow before casting again.',
        not_yours:'This rope belongs to another visitor.',
        dog_released:'The dog is out! Watch the rabbits scatter for 20 seconds.',
        dog_busy:'The dog is already playing. Let it finish this run.',
        carrot_added:'A carrot for our shared meadow. Watch who comes over.',
        rabbit_hidden:'That rabbit slipped into a burrow. Watch another entrance for its ears!',
        rabbit_gone:'That rabbit has already left this spot. Check the meadow and shared basket.',
        carrot_limit:'There are already six carrots in the meadow. Let the rabbits finish a few.',
        invalid_position:'Choose a patch of grass away from the pond and the edge of the meadow.',
      };
      status(messages[result.code] || 'The shared meadow is up to date.');
    } catch(error) {
      if (error.status === 429) status('A little slower, please. Give the meadow a moment before trying again.');
      else {
        connection(false);
        status('That action could not be confirmed. Reconnecting to check the shared meadow before trying again.');
        queuePoll(1000);
      }
    } finally { pending = false; followRope(); controls(); }
  }
  function chooseTool(next) {
    const selected = next === tool ? null : next;
    if (selected !== null && (!connected || pending)) return;
    if(selected==='net'&&buffer.latest?.seats&&buffer.latest.mySeatId==null){
      status('All eight seats are taken. You can watch and leave carrots while a seat opens.');return;
    }
    tool = selected;
    for (const name of ['carrot','net']) byId(`tool-${name}`).setAttribute('aria-pressed', String(name === tool));
    const selection = tool ? `${tool==='net'?'Lasso':'Carrot'} selected.` : 'No tool selected. Tap a rabbit to say hello.';
    canvas.setAttribute('aria-label', `Shared rabbit meadow. ${selection} Arrow keys move the ring; Enter or Space uses the tool. C / N toggle tools; Escape puts the tool away.`);
    status(tool ? {carrot:'Tap the grass to leave a carrot. Select Carrot again to put it away.',
      net:'Aim near a rabbit and tap once. A landed loop reels in automatically. Select Lasso again to put it away.'}[tool]
      : 'No tool selected. Tap a rabbit to say hello.');
    draw();
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {x:Math.max(0,Math.min(W,(event.clientX-rect.left)/rect.width*W)), y:Math.max(0,Math.min(H,(event.clientY-rect.top)/rect.height*H))};
  }
  function useTool(position) {
    if (!connected || pending || !rendered) return;
    if(tool==='net'&&buffer.latest?.seats&&buffer.latest.mySeatId==null){
      status('You are watching for now. A free seat will be assigned automatically.');return;
    }
    if (tool === 'carrot') { action({action:'carrot', ...toWorldPoint(position.x,position.y,W,H)}); return; }
    if(tool==='net'&&ownLasso(buffer.latest)){status('Your rope is already out. It reels in automatically when it lands.');return;}
    const radius = Math.max(tool==='net'?75*W/1000:40,28*W/canvas.getBoundingClientRect().width);
    // Hit the visible torso, rather than the ground point below the new sprite.
    const hitDistance = rabbit => Math.hypot(rabbit.x-position.x,
      rabbit.y-(rabbit.adult?24:16)*rabbit.renderScale-position.y);
    const nearest = rendered.rabbits.filter(rabbit=>!rabbit.burrow).map(projected).sort((a,z) => hitDistance(a)-hitDistance(z))[0];
    if (!nearest || hitDistance(nearest)>radius) {
      status(tool==='net'?'A little closer to a rabbit. Carrots can bring them over.':'A peaceful little world. Choose Carrot or Lasso, or simply watch.');
      return;
    }
    if (tool === 'net') {
      const aim=toWorldPoint(position.x,position.y+(nearest.adult?24:16)*nearest.renderScale,W,H);
      action({action:'lasso',rabbitId:nearest.id,...aim});
    }
    else {
      emit(rendered.rabbits.find(rabbit => rabbit.id===nearest.id));
      status('Hello, little friend. A small hello goes a long way.');
      draw();
    }
  }
  for (const name of ['carrot','net']) byId(`tool-${name}`).addEventListener('click',()=>chooseTool(name));
  canvas.addEventListener('pointermove',event=>{cursor={...point(event),visible:event.pointerType!=='touch'};keyboardRing=false;if(!canRun())draw();});
  canvas.addEventListener('pointerleave',()=>{cursor.visible=false;if(!canRun())draw();});
  canvas.addEventListener('click',event=>{cursor={...point(event),visible:false};keyboardRing=false;useTool(cursor);});
  canvas.addEventListener('focus',()=>{keyboardRing=true;draw();});
  canvas.addEventListener('blur',()=>{keyboardRing=false;draw();});
  canvas.addEventListener('keydown',event=>{
    const moves={ArrowLeft:[-35,0],ArrowRight:[35,0],ArrowUp:[0,-35],ArrowDown:[0,35]};
    if(moves[event.key]){event.preventDefault();cursor.x=Math.max(0,Math.min(W,cursor.x+moves[event.key][0]));cursor.y=Math.max(0,Math.min(H,cursor.y+moves[event.key][1]));keyboardRing=true;draw();}
    else if(event.key==='Enter'||event.key===' '){event.preventDefault();if(!event.repeat)useTool(cursor);}
    else if(event.key==='Escape'){event.preventDefault();chooseTool(null);}
    else if(!event.repeat&&['c','n'].includes(event.key.toLowerCase()))chooseTool({c:'carrot',n:'net'}[event.key.toLowerCase()]);
  });
  byId('cancel-lasso').addEventListener('click',()=>{const own=ownLasso(buffer.latest);if(own)action({action:'cancel_lasso',lassoId:own.id});});
  byId('release-dog').addEventListener('click',()=>action({action:'dog'}));
  reducedMotion.addEventListener('change',()=>{particles=[];schedule();draw();});

  function draw() {
    ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(background,0,0);
    const state=buffer.sample(performance.now());
    if (!state) return;
    rendered=state;
    updateIndicators(state);
    drawMeadowAtmosphere(ctx,W,H,state.time,{reducedMotion:reducedMotion.matches});
    drawBurrows(ctx,state,{width:W,height:H,reducedMotion:reducedMotion.matches});
    drawWildlifeCues(ctx,state,{width:W,height:H,reducedMotion:reducedMotion.matches});
    for(const carrot of state.carrots){const p=projected(carrot);drawCarrot(ctx,p.x,p.y,1);}
    const legacyHome=projected({x:500,y:380});
    const seatSize=Math.max(.52,Math.min(.9,W/580,H/560));
    for(const rope of state.lassos||[]){
      const rabbit=state.rabbits.find(rabbit=>rabbit.id===rope.rabbitId);
      const home=projected({x:rope.anchorX,y:rope.anchorY});
      if(rope.phase==='casting')drawCast(ctx,rope,W,H,rope.id===state.myLassoId);
      else if(rabbit){
        drawRope(ctx,home,projected(rabbit),rope,state.time,rope.id===state.myLassoId);
        if(rope.castDuration&&!reducedMotion.matches){const p=projected(rabbit);drawLandingDust(ctx,p.x,p.y,25-rope.remaining-rope.castDuration);}
      }
    }
    const animals=state.rabbits.map(rabbit=>({kind:'rabbit',animal:rabbit}));
    if(state.dog)animals.push({kind:'dog',animal:state.dog});
    animals.sort((a,z)=>a.animal.y-z.animal.y);
    for(const {kind,animal} of animals){
      const pose=projected(animal);
      pose.cosmeticIdle=!state.dog&&!state.encounter;
      if(reducedMotion.matches){pose.moving=false;pose.motionAmount=0;pose.hopProgress=0;}
      const time=reducedMotion.matches?0:state.time;
      if(kind==='dog')drawDog(ctx,pose,time);
      else drawBurrowRabbit(ctx,pose,time,drawRabbit,{reducedMotion:reducedMotion.matches});
    }
    for(const rope of state.lassos||[]){
      const rabbit=state.rabbits.find(rabbit=>rabbit.id===rope.rabbitId);
      if(rabbit&&rope.phase!=='casting'){const p=projected(rabbit);drawRopeLoop(ctx,p.x,p.y,rope.id===state.myLassoId,rope.pulling,rope.seatId,25-rope.remaining-(rope.castDuration||0),p.renderScale);}
    }
    for(const seat of state.seats||[]){
      const rope=(state.lassos||[]).find(item=>item.id===seat.lassoId);
      drawSeat(ctx,projected(seat),rope,seat.id===state.mySeatId,state.time,seatSize,recentSeatResult(state,seat.id));
    }
    if(!state.seats||(state.lassos||[]).some(rope=>rope.seatId==null))
      drawBasket(ctx,legacyHome.x,legacyHome.y,state.basket.length,Boolean(state.lassos?.length));
    for(const result of state.lassoResults||[]){
      const age=state.time-result.time;
      drawRetractingCast(ctx,result,age,W,H);
      if(result.outcome==='stolen'&&age>=0&&age<1.5){
        const home=projected({x:result.anchorX??500,y:result.anchorY??380});
        const end=projected(result);ctx.save();ctx.globalAlpha=1-age/1.5;
        drawRope(ctx,home,{...end,y:end.y+age*12},{...result,remaining:0,pulling:false},state.time,result.seatId===state.mySeatId);ctx.restore();
      }
    }
    if(state.encounter&&state.encounter.phase!=='warning')drawWildlife(ctx,projected(state.encounter),state.time);
    for(const pair of state.pairs){if(pair.phase!=='nesting')continue;const p=projected(pair),y=p.y-43+Math.sin(state.time*3)*3;ellipse(ctx,p.x,y,15,14,'#fff8ee');heart(ctx,p.x,y,8,'#db8291');}
    for(const p of particles){if(p.age<0)continue;ctx.globalAlpha=Math.max(0,1-p.age/1.6);if(p.kind==='heart')heart(ctx,p.x,p.y-p.age*26,7,'#df879a');else flower(ctx,p.x,p.y-p.age*26,5,'#fff9da','#d7ad60');}
    ctx.globalAlpha=1;
    if(!reducedMotion.matches)drawButterfly(ctx,W*(.32+Math.sin(state.time*.22)*.105),H*(.157+Math.sin(state.time*.39)*.037),state.time,'#e9b891');
    if(!reducedMotion.matches)drawButterfly(ctx,W*(.88+Math.sin(state.time*.27+3)*.038),H*(.688+Math.sin(state.time*.48)*.05),state.time+2,'#fbf4c8');
    ctx.drawImage(foreground,0,0);
    if((cursor.visible&&tool||keyboardRing)&&connected){ctx.strokeStyle='#426947';ctx.lineWidth=2;ctx.setLineDash([5,5]);ctx.beginPath();ctx.ellipse(cursor.x,cursor.y,tool==='net'?31:24,tool==='net'?22:16,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);if(tool==='carrot')drawCarrot(ctx,cursor.x+20,cursor.y-22,.8);if(tool==='net')drawLasso(ctx,cursor.x+15,cursor.y-24);if(!tool)heart(ctx,cursor.x+16,cursor.y-25,6,'#d4828f');}

  }
  function resize() {
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const unit=rect.width<600?1.25:.95;
    const nextW=Math.max(240,Math.round(rect.width*unit)),nextH=Math.max(160,Math.round(rect.height*unit));
    cursor.x=cursor.x/W*nextW;cursor.y=cursor.y/H*nextH;
    W=nextW;H=nextH;
    background.width=W;background.height=H;paintLandscape(b,W,H);
    foreground.width=W;foreground.height=H;paintForeground(front,W,H);particles=[];
    // One backing pixel becomes two screen pixels, including on high-DPI displays.
    // CSS and sprite drawing both use nearest-neighbour scaling. Mouse/world coordinates stay unchanged.
    canvas.width=Math.max(1,Math.round(rect.width/2));canvas.height=Math.max(1,Math.round(rect.height/2));
    draw();
  }
  function canRun(){return connected&&!reducedMotion.matches&&!document.hidden&&!overlayOpen();}
  function tick(now){frame=0;if(!canRun()){lastTime=0;return;}if(!lastTime)lastTime=now;const elapsed=now-lastTime;if(elapsed>=1000/30){lastTime=now;for(const p of particles)p.age+=Math.min(elapsed/1000,.1);particles=particles.filter(p=>p.age<1.6);draw();}frame=requestAnimationFrame(tick);}
  function schedule(){if(frame)cancelAnimationFrame(frame);frame=0;lastTime=0;if(canRun())frame=requestAnimationFrame(tick);}
  document.addEventListener('visibilitychange',()=>{followRope();clearTimeout(pollTimer);schedule();if(!document.hidden)poll();});
  window.addEventListener('meadow-overlay-change',()=>{followRope();schedule();if(!overlayOpen())poll();});
  window.addEventListener('pagehide',()=>puller.update(buffer.latest?.myLassoId??null,false));
  window.addEventListener('online',()=>poll());
  window.addEventListener('offline',()=>{connection(false);status('Offline for a moment. The shared meadow will reconnect when you are back.');});
  new ResizeObserver(resize).observe(canvas);
  controls();resize();poll();
}

function ellipse(c, x, y, rx, ry, color, angle = 0) {
  c.beginPath(); c.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); c.fillStyle = color; c.fill();
}
function rounded(c, x, y, w, h, r, color) {
  c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));
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
function polygon(c, points, color) {
  c.beginPath(); c.moveTo(...points[0]);
  for (const point of points.slice(1)) c.lineTo(...point);
  c.closePath(); c.fillStyle=color; c.fill();
}
function drawWildlife(c,event,time){drawPixelWildlife(c,event,time);}
function drawCarrot(c,x,y,size){drawPixelCarrot(c,x,y,size);}
function drawLasso(c,x,y) {
  c.save();c.translate(x,y);c.rotate(-.3);
  c.beginPath();c.ellipse(0,-7,16,21,0,0,Math.PI*2);c.strokeStyle='#9d753e';c.lineWidth=3;c.stroke();
  c.strokeStyle='#e5c995';c.lineWidth=1.1;c.stroke();
  c.beginPath();c.moveTo(6,11);c.bezierCurveTo(22,19,-10,19,2,34);c.strokeStyle='#ab814d';c.lineWidth=2.5;c.stroke();
  ellipse(c,5,12,3,2,'#98723e');c.restore();
}
function drawRope(c,start,rabbit,rope,time,own) {
  const colors=rope.seatId!=null?seatPalette(rope.seatId):own?['#805f37','#e4c694']:['#62786c','#c1d4b9'];
  const cast=1;
  const end={x:start.x+(rabbit.x-start.x)*cast,y:start.y+(rabbit.y-19*(rabbit.renderScale||1)-start.y)*cast};
  const slack=rope.pulling?5:24;
  c.save();c.beginPath();c.moveTo(start.x,start.y-13);
  c.quadraticCurveTo((start.x+end.x)/2+Math.sin(time*7)*(rope.pulling?1.4:.3),
    (start.y+end.y)/2+slack,end.x,end.y);
  c.lineCap='round';c.strokeStyle=colors[0];c.lineWidth=own?4.2:3.4;c.stroke();
  c.strokeStyle=colors[1];c.lineWidth=1.5;c.stroke();c.restore();
}
function drawRopeLoop(c,x,y,own,pulling,seatId,landAge=1,scale=1) {
  const colors=seatId!=null?seatPalette(seatId):own?['#a17740','#e6cfa6']:['#6c8c77','#c4d9c0'];
  const settling=1-Math.max(0,Math.min(1,landAge/.45));
  c.save();c.translate(x,y);c.scale(scale,scale);x=0;y=0;
  c.beginPath();c.ellipse(x-3,y-18,25+settling*8,(pulling?12:17)+settling*5,-.08,0,Math.PI);
  c.strokeStyle=colors[0];c.lineWidth=3;c.stroke();
  c.strokeStyle=colors[1];c.lineWidth=1.2;c.stroke();
  ellipse(c,x+20,y-15,3,2,colors[0]);
  if(seatId!=null){
    ellipse(c,x+30,y-28,9,9,colors[0]);c.fillStyle='#fffef4';c.font='bold 12px monospace';c.textAlign='center';c.fillText(String(seatId),x+30,y-24.5);
  }
  c.restore();
}
function drawSeat(c,seat,rope,own,time,size,result) {
  const colors=seatPalette(seat.id),pulling=rope?.pulling&&seat.online,casting=rope?.phase==='casting';
  const tug=pulling?Math.sin(time*9+seat.id)*2:0;
  c.save();c.translate(seat.x,seat.y);c.scale(size,size);
  ellipse(c,0,9,43,16,seat.occupied?'#718b5633':'#9aad7926');
  if(own){
    c.beginPath();c.ellipse(0,7,49,20,0,0,Math.PI*2);c.strokeStyle=colors[0];c.lineWidth=2;c.stroke();
    c.beginPath();c.ellipse(0,7,53,23,0,0,Math.PI*2);c.strokeStyle='#fffbe6';c.lineWidth=1;c.stroke();
  }
  if(seat.occupied){
    c.save();if(!seat.online)c.globalAlpha=.55;
    c.translate(seat.id<=4? -tug:tug,0);
    // A little cowboy behind the basket leans and draws back both hands.
    rounded(c,-12,-28,24,22,7,colors[0]);
    ellipse(c,0,-34,8,9,'#e4bc8e');
    c.fillStyle='#394735';c.fillRect(-4,-36,2,2);c.fillRect(2,-36,2,2);
    rounded(c,-9,-47,18,10,4,colors[0]);
    ellipse(c,0,-39,17,3,colors[0]);
    line(c,[[-10,-22],[-21,-15-tug],[-8,-10-tug]],colors[0],5);
    const castArm=casting?Math.sin(Math.min(1,rope.castElapsed/rope.castDuration)*Math.PI)*25:0;
    line(c,[[10,-22],[21,-15-tug-castArm],[8,-10-tug-castArm]],colors[0],5);
    ellipse(c,-8,-10-tug,3,3,'#e4bc8e');ellipse(c,8,-10-tug-castArm,3,3,'#e4bc8e');
    c.restore();
  }
  c.save();c.scale(.7,.7);
  if(!seat.occupied)c.globalAlpha=.45;
  drawBasket(c,0,7,String(seat.id).padStart(2,'0'),Boolean(rope),'');c.restore();
  ellipse(c,30,-22,5,5,'#fcfff1');ellipse(c,30,-22,3,3,seat.online?'#6d9756':seat.occupied?'#b89c67':'#b4bea5');
  if(rope){
    c.beginPath();c.ellipse(0,8,46,18,0,-Math.PI/2,-Math.PI/2+Math.PI*2*rope.progress);
    c.strokeStyle=colors[0];c.lineWidth=3;c.stroke();
  }
  c.restore();
  const activity=result&&!rope?{caught:'HOME!',stolen:'SNATCHED',escaped:'FREE',cancelled:'LET GO',missed:'MISSED'}[result.outcome]
    :!seat.occupied?'OPEN':!seat.online?'AWAY':rope?(casting?'CAST':`${Math.round(rope.progress*100)}%`):'READY';
  const label=`${own?'YOU':String(seat.id).padStart(2,'0')} · ${activity}`;
  c.save();c.font='bold 12px monospace';c.textAlign='center';
  const width=c.measureText(label).width+14,y=seat.y+size*24;
  rounded(c,seat.x-width/2,y,width,17,8,own?'#fffbeb':'#f7fbe4df');
  c.fillStyle=seat.occupied?colors[0]:'#849370';c.fillText(label,seat.x,y+11.5);
  c.restore();
}
function drawBasket(c,x,y,count,active,label='SHARED BASKET') {
  c.save();c.translate(x,y);
  ellipse(c,0,8,43,12,'#8fa36d44');
  if(active){c.beginPath();c.ellipse(0,4,51,21,0,0,Math.PI*2);c.setLineDash([4,5]);c.strokeStyle='#f5f1ce';c.lineWidth=2;c.stroke();c.setLineDash([]);}
  c.beginPath();c.ellipse(0,-20,27,26,0,Math.PI,Math.PI*2);c.strokeStyle='#997345';c.lineWidth=5;c.stroke();
  ellipse(c,0,-15,34,13,'#775b3b');
  polygon(c,[[-34,-15],[-27,10],[27,10],[34,-15]],'#b38c58');
  for(let row=0;row<4;row++)line(c,[[-31+row*2,-10+row*5],[31-row*2,-10+row*5]],row%2?'#cea771':'#987243',2.5);
  for(let col=-24;col<=24;col+=8)line(c,[[col,-13],[col*.83,9]],'#d7b781',1.1);
  c.beginPath();c.ellipse(0,-15,34,13,0,0,Math.PI);c.strokeStyle='#ddba7d';c.lineWidth=4;c.stroke();
  rounded(c,-15,-7,30,17,4,'#f4e8c9');c.fillStyle='#725735';c.font='bold 12px monospace';c.textAlign='center';c.fillText(String(count),0,5);
  if(label){c.font='8px Arial, sans-serif';c.fillStyle='#657747';c.fillText(label,0,26);}
  c.restore();
}
function drawButterfly(c, x, y, time, color) {
  const flap = 2.5 + Math.abs(Math.sin(time * 4)) * 3;
  ellipse(c, x - flap * 0.6, y - 2, flap, 4, color, -0.4);
  ellipse(c, x + flap * 0.6, y - 2, flap, 4, color, 0.4);
  line(c, [[x, y - 3], [x, y + 3]], '#687b4c', 1);
}
