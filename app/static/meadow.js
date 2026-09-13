import { drawRabbit } from './rabbit-art.js?v=meadow10';
import { createAutoLassoPuller } from './lasso-pull.js?v=meadow10';
import { createSeededRandom, createSnapshotBuffer, toWorldPoint } from './meadow-model.js?v=meadow10';
import { seatName, seatPalette, seatActivity, recentSeatResult, seatResultMessage } from './meadow-seats.js?v=meadow10';

import { drawCast, drawRetractingCast, drawLandingDust } from './meadow-cast.js?v=meadow10';
import { drawWildlifeCues } from './meadow-cues.js?v=meadow10';
import { mountCaptureJournal } from './meadow-journal.js?v=meadow10';

const byId = id => document.getElementById(id);

// Business information lives in a small letter opened over the full-screen game.
const aboutDialog = byId('about-dialog');
const helpDialog = byId('help-dialog');
const overlayOpen = () => Boolean(aboutDialog?.open || helpDialog?.open || byId('journal-dialog')?.open);
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
  let W = 1000, H = 600, tool = 'watch';
  const buffer = createSnapshotBuffer();
  let frame = 0, lastTime = 0, particles = [], frozen = null;
  let cursor = {x:500, y:300, visible:false}, keyboardRing = false;
  let connected = false, pending = false, polling = false, pollTimer = 0, failures = 0;
  let previousNumbers = '', rendered = null, seatFeed = null;
  const seatRows = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reducedMotion.matches;
  const background = document.createElement('canvas');
  const b = background.getContext('2d');
  const status = message => { byId('meadow-status').textContent = message; };
  const projected = item => ({...item, x:item.x / 1000 * W, y:item.y / 600 * H});
  const playerId = (()=>{
    try {
      const saved=localStorage.getItem('meadow.player.v1');
      if(saved&&/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(saved))return saved;
      const value=requestId();localStorage.setItem('meadow.player.v1',value);return value;
    }catch{return requestId();}
  })();
  const journal=mountCaptureJournal({playerId,button:byId('open-journal'),onOverlayChange:overlayChanged,
    onUnlock:()=>{byId('open-journal').classList.add('has-new-stamp');}});
  const ownLasso = state => (state?.lassos || []).find(lasso=>lasso.id===state.myLassoId);
  const puller=createAutoLassoPuller({send:sendLasso,accept,change:controls,error:cause=>{
    if(['lasso_gone','not_yours'].includes(cause.message))return;
    connection(false);status('The rope is resting while we reconnect. Pulling stops when the connection is lost.');queuePoll(1000);
  }});

  function controls() {
    const blocked = !connected || paused || pending;
    byId('tool-carrot').disabled = blocked;
    byId('tool-net').disabled = blocked || (buffer.latest?.seats && buffer.latest.mySeatId==null);
    byId('release-rabbit').disabled = blocked || !buffer.latest?.basket.length;
    byId('reset-meadow').disabled = polling || pending;
    byId('pause-meadow').disabled = !buffer.latest;
    const own=ownLasso(buffer.latest);
    byId('lasso-controls').hidden=!own;
    byId('cancel-lasso').disabled=blocked||!own;
  }
  function followRope(){
    puller.update(buffer.latest?.myLassoId??null,
      connected&&!paused&&!pending&&!document.hidden&&!overlayOpen());
  }
  function connection(ok) {
    connected = ok;
    followRope();
    const indicator = byId('connection-status');
    const label = ok ? 'Shared meadow · connected' : 'Reconnecting…';
    if (indicator.textContent !== label) indicator.textContent = label;
    indicator.dataset.state = ok ? 'connected' : 'offline';
    if(!ok&&buffer.latest?.seats){
      byId('online-status').textContent='Players · reconnecting';
      byId('seat-status').textContent='Checking your seat…';
    }
    controls();
    schedule();
  }
  function counters(state) {
    if (!state) return;
    presence(state);
    const own=ownLasso(state);
    if(own){
      const percent=Math.round(own.progress*100);
      byId('lasso-progress').value=own.phase==='casting'?own.castElapsed/own.castDuration:own.progress;
      const label=own.phase==='casting'?'Casting · watch the landing':`${own.pulling?'Reeling in':'Rope ready'} · ${percent}% · ${Math.ceil(own.remaining)}s`;
      if(byId('lasso-label').textContent!==label)byId('lasso-label').textContent=label;
    }
    const numbers = `${state.rabbits.length}/${state.bornCount}/${state.basket.length}`;
    if (numbers !== previousNumbers) {
      byId('rabbit-count').textContent = state.rabbits.length;
      byId('born-count').textContent = state.bornCount;
      byId('basket-count').textContent = state.basket.length;
      previousNumbers = numbers;
    }
    const encounter = state.encounter;
    const indicator = byId('wildlife-status');
    if (indicator) {
      const animal = encounter?.kind === 'eagle' ? 'Eagle' : 'Wolf';
      const label = encounter ? (encounter.phase === 'warning' ? `${animal} nearby · basket is safe`
        : encounter.phase === 'chasing' ? `${animal} approaching · shelter a rabbit`
        : encounter.carrying ? `${animal} carried one rabbit away` : `${animal} is leaving empty-handed`)
        : state.raidedCount ? `${state.raidedCount} carried away · basket is safe` : 'A quiet moment in the meadow';
      if (indicator.textContent !== label) indicator.textContent = label;
      indicator.dataset.kind = encounter?.kind || 'calm';
    }
  }
  function presence(state) {
    if(!state.seats)return;
    const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
    if(connected){
      text(byId('online-status'),`${state.onlineCount} / 8 seats online`);
      text(byId('seat-status'),state.mySeatId==null?'Watching · joining when a seat opens':`You are at ${seatName(state.mySeatId).toLowerCase()}`);
    }
    for(const seat of state.seats){
      let row=seatRows.get(seat.id);
      if(!row){
        const node=document.createElement('li'),name=document.createElement('strong'),activity=document.createElement('span');
        node.append(name,activity);node.style.setProperty('--seat-color',seatPalette(seat.id)[0]);
        byId('seat-list').append(node);row={node,name,activity};seatRows.set(seat.id,row);
      }
      const mine=seat.id===state.mySeatId;
      row.node.dataset.own=String(mine);row.node.dataset.state=seat.status;
      text(row.name,`${seatName(seat.id)}${mine?' · You':''}`);
      text(row.activity,seatActivity(seat,state));
    }
    const show=seatFeed&&state.time-seatFeed.time<8&&state.time>=seatFeed.time;
    byId('seat-feed').hidden=!show;
    if(show)text(byId('seat-feed'),seatResultMessage(seatFeed));
  }
  function emit(item, kind = 'heart', count = 3) {
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
    journal.accept(state);
    const previousLasso=ownLasso(old);
    const outcome=previousLasso && (state.lassoResults||[]).find(result=>result.id===previousLasso.id);
    if(old?.epoch!==state.epoch)seatFeed=null;
    else {
      const priorResults=new Set((old.lassoResults||[]).map(result=>result.id));
      const sharedResults=(state.lassoResults||[]).filter(result=>result.seatId!=null
        &&result.seatId!==state.mySeatId&&!priorResults.has(result.id));
      if(sharedResults.length)seatFeed=sharedResults.at(-1);
    }
    if (changed && old?.epoch === state.epoch && !paused && !overlayOpen()) {
      const oldIds = new Set([...old.rabbits, ...old.basket].map(rabbit => rabbit.id));
      const babies = state.rabbits.filter(rabbit => !oldIds.has(rabbit.id) && !rabbit.adult);
      for (const rabbit of babies) emit(rabbit, 'heart', 5);
      if (babies.length && !state.encounter && !ownLasso(state) && !outcome) status('A new baby, a surprise coat. Meet the meadow’s newest neighbour!');
    }
    if (changed && state.encounter && !paused && !overlayOpen()
      && (old?.encounter?.id !== state.encounter.id || old?.encounter?.phase !== state.encounter.phase)) {
      const event = state.encounter, animal = event.kind === 'eagle' ? 'An eagle' : 'A grey wolf';
      status(event.phase === 'warning' ? `${animal} is nearby. Rabbits on a rope are still out in the open.`
        : event.phase === 'chasing' ? `${animal} is approaching! Your rope is still out in the open.`
        : event.carrying ? `${animal} carried a rabbit away. The rest of the meadow keeps growing.`
        : `${animal} is leaving empty-handed. A lucky moment for the meadow.`);
    }
    if(previousLasso?.phase==='casting'&&ownLasso(state)?.phase==='reeling'&&!paused&&!overlayOpen())
      status('The loop landed! Reeling home now — keep an eye on the grass.');
    if(outcome && !paused){
      status({caught:'Home safe! Your rabbit reached the shared basket.',
        stolen:'Snatched from the rope! The visitor got there before the basket.',
        escaped:'The rope went slack. Your rabbit is free again.',
        cancelled:'You let go. The rabbit is back on the grass.',
        missed:'Just missed! Try leading a hopping rabbit, or tempt it with a carrot.'}[outcome.outcome]);
    }
    if(state.mySeatId!=null&&old&&old.mySeatId!==state.mySeatId&&!paused)
      status(`${seatName(state.mySeatId)} is yours. Your rope will bring rabbits back here.`);
    if (!old) {
      byId('meadow-loading').hidden = true;
      if (paused || !state.encounter) status(paused ? 'Your view is paused for reduced motion. Play joins the live meadow.'
        : 'One meadow for everyone. Leave a carrot, meet the rabbits, and make yourself at home.');
    }
    if (paused && !frozen) frozen = buffer.sample(performance.now());
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
      queuePoll(failures ? Math.min(15000, 1000 * 2 ** Math.min(failures,4)) : paused || overlayOpen() ? 3000 : 1000);
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
    if (!connected || paused || pending) return;
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
        seat_busy:'This seat already has a rope. Sync the meadow before casting again.',
        lasso_cancelled:'You let go. The rabbit is free again.',
        rabbit_roped:'Another visitor already has this rabbit on a rope.',
        player_busy:'Bring your current rabbit home or let go before casting again.',
        lasso_limit:'The meadow has enough ropes for now. Try again in a moment.',
        lasso_gone:'That rope has already gone. Check the meadow before casting again.',
        not_yours:'This rope belongs to another visitor.',
        released:'Back on the grass, for everyone to enjoy.',
        carrot_added:'A carrot for our shared meadow. Watch who comes over.',
        rabbit_gone:'That rabbit has already left this spot. Check the meadow and shared basket.',
        basket_empty:'The shared basket is empty. Everyone is out on the grass.',
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
    if (next !== 'watch' && (!connected || paused || pending)) return;
    if(next==='net'&&buffer.latest?.seats&&buffer.latest.mySeatId==null){
      status('All eight seats are taken. You can watch and leave carrots while a seat opens.');return;
    }
    tool = next;
    for (const name of ['watch','carrot','net']) byId(`tool-${name}`).setAttribute('aria-pressed', String(name === tool));
    canvas.setAttribute('aria-label', `Shared rabbit meadow. ${tool === 'net' ? 'Lasso' : tool === 'carrot' ? 'Carrot' : 'Watch'} selected. Arrow keys move the ring; Enter or Space uses the tool. A roped rabbit reels in automatically.`);
    status({watch:'One meadow, shared by everyone. Take a little time to watch it grow.',
      carrot:'Tap the grass to leave a carrot. Other visitors will see it too.',
      net:'Aim near a rabbit and tap once. Lead its hop; a landed loop reels in automatically.'}[tool]);
    draw();
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {x:Math.max(0,Math.min(W,(event.clientX-rect.left)/rect.width*W)), y:Math.max(0,Math.min(H,(event.clientY-rect.top)/rect.height*H))};
  }
  function useTool(position) {
    if (!connected || paused || pending || !rendered) return;
    if(tool==='net'&&buffer.latest?.seats&&buffer.latest.mySeatId==null){
      status('You are watching for now. A free seat will be assigned automatically.');return;
    }
    if (tool === 'carrot') { action({action:'carrot', ...toWorldPoint(position.x,position.y,W,H)}); return; }
    if(tool==='net'&&ownLasso(buffer.latest)){status('Your rope is already out. It reels in automatically when it lands.');return;}
    const radius = Math.max(tool==='net'?75*W/1000:40,28*W/canvas.getBoundingClientRect().width);
    // Hit the visible torso, rather than the ground point below the new sprite.
    const hitDistance = rabbit => Math.hypot(rabbit.x-position.x,
      rabbit.y-(rabbit.adult?24:16)-position.y);
    const nearest = rendered.rabbits.map(projected).sort((a,z) => hitDistance(a)-hitDistance(z))[0];
    if (!nearest || hitDistance(nearest)>radius) {
      status(tool==='net'?'A little closer to a rabbit. Carrots can bring them over.':'A peaceful little world. Choose Carrot or Lasso, or simply watch.');
      return;
    }
    if (tool === 'net') {
      const aim=toWorldPoint(position.x,position.y+(nearest.adult?24:16),W,H);
      action({action:'lasso',rabbitId:nearest.id,...aim});
    }
    else {
      emit(rendered.rabbits.find(rabbit => rabbit.id===nearest.id));
      status('Hello, little friend. A small hello goes a long way.');
      draw();
    }
  }
  for (const name of ['watch','carrot','net']) byId(`tool-${name}`).addEventListener('click',()=>chooseTool(name));
  canvas.addEventListener('pointermove',event=>{cursor={...point(event),visible:event.pointerType!=='touch'};keyboardRing=false;if(!canRun())draw();});
  canvas.addEventListener('pointerleave',()=>{cursor.visible=false;if(!canRun())draw();});
  canvas.addEventListener('click',event=>{cursor={...point(event),visible:false};keyboardRing=false;useTool(cursor);});
  canvas.addEventListener('focus',()=>{keyboardRing=true;draw();});
  canvas.addEventListener('blur',()=>{keyboardRing=false;draw();});
  canvas.addEventListener('keydown',event=>{
    const moves={ArrowLeft:[-35,0],ArrowRight:[35,0],ArrowUp:[0,-35],ArrowDown:[0,35]};
    if(moves[event.key]){event.preventDefault();cursor.x=Math.max(0,Math.min(W,cursor.x+moves[event.key][0]));cursor.y=Math.max(0,Math.min(H,cursor.y+moves[event.key][1]));keyboardRing=true;draw();}
    else if(event.key==='Enter'||event.key===' '){event.preventDefault();if(!event.repeat)useTool(cursor);}
    else if(['w','c','n'].includes(event.key.toLowerCase()))chooseTool({w:'watch',c:'carrot',n:'net'}[event.key.toLowerCase()]);
  });
  byId('cancel-lasso').addEventListener('click',()=>{const own=ownLasso(buffer.latest);if(own)action({action:'cancel_lasso',lassoId:own.id});});
  function pauseLabel() {
    byId('pause-meadow').textContent=paused?'▶ Live view':'Ⅱ Pause view';
    byId('pause-meadow').setAttribute('aria-pressed',String(paused));
  }
  function pauseView(next) {
    if (next && !paused) frozen=buffer.sample(performance.now());
    paused=next;
    followRope();
    if (!paused) {frozen=null;poll();}
    pauseLabel(); controls(); schedule(); draw();
    status(paused?'Only your view is paused. The shared meadow continues for everyone else.':'Back to the live shared meadow.');
  }
  byId('pause-meadow').addEventListener('click',()=>pauseView(!paused));
  byId('release-rabbit').addEventListener('click',()=>action({action:'release'}));
  byId('reset-meadow').addEventListener('click',()=>{if(paused)pauseView(false);else poll();status('Syncing with the shared meadow. The rabbits stay right where they belong.');});
  reducedMotion.addEventListener('change',event=>{if(event.matches)pauseView(true);});

  function draw() {
    ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
    ctx.drawImage(background,0,0);
    const state=paused?frozen:buffer.sample(performance.now());
    if (!state) return;
    rendered=state;
    counters(state);
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
    for(const rabbit of [...state.rabbits].sort((a,z)=>a.y-z.y))drawRabbit(ctx,projected(rabbit),state.time);
    for(const rope of state.lassos||[]){
      const rabbit=state.rabbits.find(rabbit=>rabbit.id===rope.rabbitId);
      if(rabbit&&rope.phase!=='casting'){const p=projected(rabbit);drawRopeLoop(ctx,p.x,p.y,rope.id===state.myLassoId,rope.pulling,rope.seatId,25-rope.remaining-(rope.castDuration||0));}
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
    drawButterfly(ctx,W*(.32+Math.sin(state.time*.22)*.105),H*(.157+Math.sin(state.time*.39)*.037),state.time,'#e9b891');
    drawButterfly(ctx,W*(.88+Math.sin(state.time*.27+3)*.038),H*(.688+Math.sin(state.time*.48)*.05),state.time+2,'#fbf4c8');
    if((cursor.visible||keyboardRing)&&connected&&!paused){ctx.strokeStyle='#426947';ctx.lineWidth=2;ctx.setLineDash([5,5]);ctx.beginPath();ctx.ellipse(cursor.x,cursor.y,tool==='net'?31:24,tool==='net'?22:16,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);if(tool==='carrot')drawCarrot(ctx,cursor.x+20,cursor.y-22,.8);if(tool==='net')drawLasso(ctx,cursor.x+15,cursor.y-24);if(tool==='watch')heart(ctx,cursor.x+16,cursor.y-25,6,'#d4828f');}
    if(paused){rounded(ctx,W/2-124,H/2-17,248,34,17,'#f7f6e9');ctx.font='12px Arial, sans-serif';ctx.textAlign='center';ctx.fillStyle='#496246';ctx.fillText('YOUR VIEW IS PAUSED',W/2,H/2+5);}
  }
  function resize() {
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const unit=rect.width<600?1.25:.95;
    const nextW=Math.max(240,Math.round(rect.width*unit)),nextH=Math.max(160,Math.round(rect.height*unit));
    cursor.x=cursor.x/W*nextW;cursor.y=cursor.y/H*nextH;
    W=nextW;H=nextH;
    background.width=W;background.height=H;paintLandscape(b,W,H);particles=[];
    const dpr=Math.min(window.devicePixelRatio||1,1.5);
    canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
    draw();
  }
  function canRun(){return connected&&!paused&&!document.hidden&&!overlayOpen();}
  function tick(now){frame=0;if(!canRun()){lastTime=0;return;}if(!lastTime)lastTime=now;const elapsed=now-lastTime;if(elapsed>=1000/30){lastTime=now;for(const p of particles)p.age+=Math.min(elapsed/1000,.1);particles=particles.filter(p=>p.age<1.6);draw();}frame=requestAnimationFrame(tick);}
  function schedule(){if(frame)cancelAnimationFrame(frame);frame=0;lastTime=0;if(canRun())frame=requestAnimationFrame(tick);}
  document.addEventListener('visibilitychange',()=>{followRope();clearTimeout(pollTimer);schedule();if(!document.hidden)poll();});
  window.addEventListener('meadow-overlay-change',()=>{followRope();schedule();if(!overlayOpen())poll();});
  window.addEventListener('pagehide',()=>puller.update(buffer.latest?.myLassoId??null,false));
  window.addEventListener('online',()=>poll());
  window.addEventListener('offline',()=>{connection(false);status('Offline for a moment. The shared meadow will reconnect when you are back.');});
  new ResizeObserver(resize).observe(canvas);
  pauseLabel();controls();resize();poll();
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
function polygon(c, points, color) {
  c.beginPath(); c.moveTo(...points[0]);
  for (const point of points.slice(1)) c.lineTo(...point);
  c.closePath(); c.fillStyle=color; c.fill();
}
function drawWildlife(c, event, time) {
  const warning = event.phase === 'warning';
  const d = event.direction;
  // All travel comes from server snapshots; wingbeats and footfalls are cosmetic.
  ellipse(c,event.x,event.y+5,event.kind==='eagle'?37:42,9,'#54644f30');
  if(warning){
    c.save(); c.setLineDash([5,5]); c.strokeStyle='#aa8152'; c.lineWidth=1.5;
    c.beginPath(); c.ellipse(event.x,event.y,48,20,0,0,Math.PI*2); c.stroke(); c.restore();
  }
  if(event.kind==='eagle'){
    const lift = warning ? 52 : event.phase==='leaving' ? 44 : 29;
    if(event.carrying) drawRabbit(c,{...event.carrying,x:event.x,y:event.y-lift+39,direction:d,moving:false},time,{scale:.65,shadow:false});
    c.save(); c.translate(event.x,event.y-lift); c.scale(d,1);
    const flap = Math.sin(time*8)*16;
    polygon(c,[[-10,-4],[-34,-29-flap],[-52,-40-flap],[-46,-15],[-53,-13],[-42,-6],[-47,-3],[-29,5],[-7,9]],'#6c5540');
    polygon(c,[[0,-5],[19,-34+flap],[33,-49+flap],[36,-27],[44,-24],[35,-12],[41,-10],[24,3],[5,11]],'#8e7050');
    line(c,[[-35,-22-flap],[-23,-4],[-8,4]],'#a38a63',2);
    line(c,[[29,-30+flap],[21,-11],[5,4]],'#b29a72',2);
    polygon(c,[[-8,5],[-22,25],[-13,25],[-8,30],[2,19],[7,7]],'#624c38');
    ellipse(c,0,4,12,18,'#8a6a46',-.3);
    ellipse(c,9,-6,11,10,'#f5ecd7');
    polygon(c,[[16,-7],[27,-2],[19,2],[17,6],[14,0]],'#d6a34f');
    ellipse(c,12,-8,1.9,2,'#3f4940');
    line(c,[[1,18],[0,27],[-4,29]],'#c29a4f',2);
    line(c,[[8,17],[9,26],[13,29]],'#c29a4f',2);
    c.restore();
  } else {
    const stride = warning ? 0 : Math.sin(time*12)*10;
    c.save(); c.translate(event.x,event.y); c.scale(d,1);
    polygon(c,[[-25,-24],[-49,-39],[-61,-37],[-48,-29],[-56,-25],[-34,-11],[-20,-10]],'#68777a');
    line(c,[[-20,-16],[-24+stride,0],[-15+stride,1]],'#607074',7);
    line(c,[[19,-18],[23-stride,0],[31-stride,1]],'#607074',7);
    ellipse(c,-2,-21,32,16,'#829193');
    polygon(c,[[6,-33],[20,-44],[28,-41],[37,-30],[48,-25],[43,-17],[29,-14],[20,-7],[12,-16]],'#8f9b9c');
    polygon(c,[[18,-37],[17,-60],[30,-43]],'#68787c');
    polygon(c,[[29,-36],[35,-57],[39,-35]],'#738387');
    polygon(c,[[20,-42],[20,-52],[26,-43]],'#c2a59c');
    polygon(c,[[33,-40],[35,-49],[37,-38]],'#c2a59c');
    polygon(c,[[13,-26],[27,-20],[43,-23],[41,-16],[26,-12],[18,-6]],'#cdd1c5');
    ellipse(c,44,-25,5,3.2,'#3d5053');
    ellipse(c,31,-33,2.1,2.1,'#293e42');
    line(c,[[29,-38],[34,-36]],'#5b7074',1.7);
    line(c,[[-13,-14],[-12-stride,1],[-3-stride,2]],'#94a09c',7);
    line(c,[[13,-13],[13+stride,1],[22+stride,2]],'#a4afa7',7);
    c.restore();
    if(event.carrying) drawRabbit(c,{...event.carrying,x:event.x+43*d,y:event.y+9,direction:-d,moving:false},time,{scale:.53,shadow:false});
  }
  if(warning){
    rounded(c,event.x-12,event.y-(event.kind==='eagle'?92:84),24,24,12,'#fff3d7');
    c.font='bold 16px Georgia, serif';c.textAlign='center';c.fillStyle='#9b774b';
    c.fillText('!',event.x,event.y-(event.kind==='eagle'?75:67));
  }
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
  const end={x:start.x+(rabbit.x-start.x)*cast,y:start.y+(rabbit.y-19-start.y)*cast};
  const slack=rope.pulling?5:24;
  c.save();c.beginPath();c.moveTo(start.x,start.y-13);
  c.quadraticCurveTo((start.x+end.x)/2+Math.sin(time*7)*(rope.pulling?1.4:.3),
    (start.y+end.y)/2+slack,end.x,end.y);
  c.lineCap='round';c.strokeStyle=colors[0];c.lineWidth=own?4.2:3.4;c.stroke();
  c.strokeStyle=colors[1];c.lineWidth=1.5;c.stroke();c.restore();
}
function drawRopeLoop(c,x,y,own,pulling,seatId,landAge=1) {
  const colors=seatId!=null?seatPalette(seatId):own?['#a17740','#e6cfa6']:['#6c8c77','#c4d9c0'];
  const settling=1-Math.max(0,Math.min(1,landAge/.45));
  c.save();c.beginPath();c.ellipse(x-3,y-18,25+settling*8,(pulling?12:17)+settling*5,-.08,0,Math.PI);
  c.strokeStyle=colors[0];c.lineWidth=3;c.stroke();
  c.strokeStyle=colors[1];c.lineWidth=1.2;c.stroke();
  ellipse(c,x+20,y-15,3,2,colors[0]);
  if(seatId!=null){
    ellipse(c,x+30,y-28,9,9,colors[0]);c.fillStyle='#fffef4';c.font='bold 10px Arial, sans-serif';c.textAlign='center';c.fillText(String(seatId),x+30,y-24.5);
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
  c.save();c.font='bold 10px Arial, sans-serif';c.textAlign='center';
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
  rounded(c,-15,-7,30,17,4,'#f4e8c9');c.fillStyle='#725735';c.font='11px Georgia, serif';c.textAlign='center';c.fillText(String(count),0,5);
  if(label){c.font='8px Arial, sans-serif';c.fillStyle='#657747';c.fillText(label,0,26);}
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
  // Keep decoration away from the eight catching seats and small-screen HUD.
  if(W>700){
  const signX = X(500), signY = Y(115);
  line(c, [[signX, signY + 10 * size], [signX, signY + 44 * size]], '#b29a6d', 5 * size);
  rounded(c, signX - 69 * size, signY - 13 * size, 140 * size, 32 * size, 4 * size, '#c0af7e');
  rounded(c, signX - 70 * size, signY - 16 * size, 140 * size, 32 * size, 4 * size, '#f0e7c4');
  c.font = `italic ${13 * size}px Georgia, serif`; c.textAlign = 'center'; c.fillStyle = '#66774e';
  c.fillText('a little room to grow', signX, signY + 5 * size);
  }
  c.restore();
}
