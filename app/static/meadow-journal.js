import { drawRabbit } from './rabbit-art.js?v=meadow14';

export const JOURNAL_COATS = Object.freeze([
  {coat:'white', name:'Snow white', note:'A little cloud against the green.', tint:'#e5e8d6'},
  {coat:'cream', name:'Warm cream', note:'Soft ivory in the morning light.', tint:'#efe4c9'},
  {coat:'caramel', name:'Caramel', note:'Golden brown, from ears to paws.', tint:'#ead6b9'},
  {coat:'chocolate', name:'Chocolate', note:'Deep brown, like freshly turned earth.', tint:'#e3d2c4'},
  {coat:'silver', name:'Silver', note:'A cool grey coat with a gentle shine.', tint:'#dce4df'},
  {coat:'charcoal', name:'Charcoal', note:'A dark silhouette with bright eyes.', tint:'#d5dcda'},
  {coat:'ginger', name:'Ginger', note:'A warm flash of copper in the grass.', tint:'#eddbc3'},
  {coat:'spotted', name:'Spotted', note:'Brown patches on a pale little coat.', tint:'#e3dfca'},
].map(Object.freeze));

const knownCoats = new Set(JOURNAL_COATS.map(entry=>entry.coat));
const eventPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}:[1-9]\d{0,15}$/i;
const validEvent = value => typeof value==='string' && eventPattern.test(value)
  && Number.isSafeInteger(Number(value.slice(value.lastIndexOf(':')+1)));
const validDate = value => Number.isSafeInteger(value) && value>=0 && value<=8640000000000000;
const earlier = (a,b) => !b || (a.foundAt-b.foundAt || a.eventKey.localeCompare(b.eventKey))<0;

// Eight independent first-catch stamps avoid a growing event log and avoid
// losing one coat when two tabs discover different coats at the same time.
// Only the server-personalized results are accepted; a shared basket, seat
// number or public result is never evidence that this player made a catch.
export function createCaptureJournal({storage=null,playerId,now=()=>Date.now()}={}) {
  if(typeof playerId!=='string' || !/^[\w-]{1,128}$/.test(playerId)) throw new Error('A journal needs a player identity');
  const prefix=`meadow.journal.v1.${playerId}.`;
  const stamps=new Map();
  let persistent=Boolean(storage);
  function read(coat) {
    try {
      const raw=storage?.getItem(prefix+coat);
      if(!raw || raw.length>600)return null;
      const value=JSON.parse(raw);
      return value?.version===1 && value.coat===coat && validEvent(value.eventKey) && validDate(value.foundAt)
        ? {version:1,coat,eventKey:value.eventKey,foundAt:value.foundAt} : null;
    } catch {persistent=false;return null;}
  }
  function save(stamp) {
    try {
      if(!storage)return;
      storage.setItem(prefix+stamp.coat,JSON.stringify(stamp));
      persistent=true;
    } catch {persistent=false;}
  }
  function refresh() {
    for(const {coat} of JOURNAL_COATS){
      const saved=read(coat),current=stamps.get(coat);
      if(saved && earlier(saved,current))stamps.set(coat,saved);
      // Heal a stale concurrent write with the earliest stamp already seen.
      else if(current && (!saved || earlier(current,saved)))save(current);
    }
    return snapshot();
  }
  function snapshot() {
    return {count:stamps.size,total:JOURNAL_COATS.length,persistent,
      coats:JOURNAL_COATS.map(entry=>({...entry,unlocked:stamps.has(entry.coat),foundAt:stamps.get(entry.coat)?.foundAt??null}))};
  }
  function accept(state) {
    refresh();
    const results=state?.myLassoResults;
    if(!Array.isArray(results) || results.length>12)return [];
    const unlocked=[];
    for(const result of results){
      if(result?.outcome!=='caught' || !knownCoats.has(result.coat) || !validEvent(result.eventKey) || stamps.has(result.coat))continue;
      const observedAt=now();
      const stamp={version:1,coat:result.coat,eventKey:result.eventKey,foundAt:validDate(observedAt)?observedAt:Date.now()};
      stamps.set(result.coat,stamp);save(stamp);
      unlocked.push(JOURNAL_COATS.find(entry=>entry.coat===result.coat));
    }
    return unlocked;
  }
  refresh();
  return {accept,refresh,snapshot,ownsStorageKey:key=>typeof key==='string' && key.startsWith(prefix) && knownCoats.has(key.slice(prefix.length))};
}

function browserStorage(){try{return window.localStorage;}catch{return null;}}
function element(tag,className,text){
  const node=document.createElement(tag);if(className)node.className=className;
  if(text!==undefined)node.textContent=text;return node;
}

// Static illustrations are painted once. Opening this book adds no animation
// loop, network requests, image downloads or server-side player records.
export function mountCaptureJournal({playerId,button,storage=browserStorage(),onOverlayChange=()=>{},onUnlock=()=>{}}={}) {
  const journal=createCaptureJournal({storage,playerId});
  const dialog=element('dialog','meadow-dialog journal-dialog');
  dialog.id='journal-dialog';dialog.setAttribute('aria-labelledby','journal-title');
  const header=element('div','dialog-header journal-header');
  header.append(element('span',null,'THE MEADOW FIELD JOURNAL'));
  const close=element('button','close-dialog','×');close.type='button';close.setAttribute('aria-label','Close field journal');header.append(close);
  const content=element('div','journal-content');
  content.append(element('p','journal-eyebrow','SMALL ENCOUNTERS, KEPT ON PAPER'));
  const heading=element('h2',null,'A meadow of many colours.');heading.id='journal-title';content.append(heading);
  content.append(element('p','journal-intro','Bring a rabbit safely home to stamp its coat in your book. Eight colours. Eight little discoveries.'));
  const cover=element('div','journal-cover');
  const number=element('strong','journal-count');
  const coverText=element('div','journal-cover-text');
  coverText.append(element('span',null,'COATS DISCOVERED'));
  const journey=element('p');coverText.append(journey);cover.append(number,coverText);content.append(cover);
  const grid=element('ol','journal-grid');grid.setAttribute('aria-label','Your eight rabbit coat stamps');
  const cards=new Map();
  JOURNAL_COATS.forEach((entry,index)=>{
    const card=element('li','journal-card');card.style.setProperty('--coat-tint',entry.tint);
    card.append(element('span','journal-card-number',`FIELD NOTE ${String(index+1).padStart(2,'0')}`));
    const art=element('canvas','journal-rabbit');art.width=320;art.height=240;art.setAttribute('aria-hidden','true');
    const c=art.getContext('2d');
    if(c){c.scale(2,2);drawRabbit(c,{id:index+1,coat:entry.coat,adult:true,x:82,y:107,direction:1,moving:false},1.5,{scale:1.2});}
    card.append(art,element('h3',null,entry.name),element('p','journal-coat-note',entry.note));
    const stamp=element('div','journal-stamp');const stampLabel=element('strong');const date=element('span');stamp.append(stampLabel,date);card.append(stamp);
    cards.set(entry.coat,{card,stampLabel,date});grid.append(card);
  });
  content.append(grid);
  const footer=element('p','journal-footnote');content.append(footer);dialog.append(header,content);document.body.append(dialog);
  const announcement=element('span','journal-announcement');announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');
  document.body.append(announcement);
  const formatDate=value=>new Date(value).toLocaleDateString('en',{day:'numeric',month:'short',year:'numeric'});
  function render(){
    const state=journal.snapshot();
    number.textContent=`${state.count} / ${state.total}`;
    journey.textContent=state.count===8?'Every coat, a memory. Your first set is complete.':state.count===0?'Your first discovery is waiting in the grass.':`${8-state.count} more ${state.count===7?'colour':'colours'} to meet.`;
    cover.dataset.complete=String(state.count===8);
    for(const entry of state.coats){
      const {card,stampLabel,date}=cards.get(entry.coat);card.dataset.found=String(entry.unlocked);
      stampLabel.textContent=entry.unlocked?'✓ FOUND':'YET TO FIND';
      date.textContent=entry.unlocked?formatDate(entry.foundAt):'Bring this coat home';
    }
    footer.textContent=state.persistent
      ? 'Kept in this browser, for this player. Clearing browser data clears the book. Only your successful catches seen by this journal earn a stamp; the shared basket belongs to everyone.'
      : 'Browser storage is unavailable, so this book lasts for this visit. Only your successful catches seen by this journal earn a stamp; the shared basket belongs to everyone.';
    if(button){
      const count=button.querySelector('[data-journal-count]');if(count)count.textContent=`${state.count}/8`;
      button.setAttribute('aria-label',`Field journal, ${state.count} of 8 coats discovered`);
    }
  }
  function open(){button?.classList.remove('has-new-stamp');journal.refresh();render();if(!dialog.open){dialog.showModal();dialog.scrollTop=0;onOverlayChange();}}
  function dismiss(){dialog.close();}
  const overlay=()=>onOverlayChange();
  const outside=event=>{
    if(event.target!==dialog)return;
    const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom)dialog.close();
  };
  const storageChanged=event=>{if(event.key===null || journal.ownsStorageKey(event.key)){journal.refresh();render();}};
  button?.addEventListener('click',open);close.addEventListener('click',dismiss);
  dialog.addEventListener('close',overlay);dialog.addEventListener('click',outside);window.addEventListener('storage',storageChanged);
  render();
  return {dialog,open,
    accept(state){
      const unlocked=journal.accept(state);render();
      if(unlocked.length){announcement.textContent=`New field journal ${unlocked.length===1?'stamp':'stamps'}: ${unlocked.map(entry=>entry.name).join(', ')}.`;onUnlock(unlocked,journal.snapshot());}
      return unlocked;
    },
    refresh(){journal.refresh();render();},
    destroy(){button?.removeEventListener('click',open);window.removeEventListener('storage',storageChanged);if(dialog.open)dialog.close();dialog.remove();announcement.remove();},
  };
}
