import {makeAdventure,inquiry,parseSaved} from './adventure-data.js';
const root=document.querySelector('#adventure');
if(root){
 const worldInputs=[...root.querySelectorAll('[name="world"]')];
 const levelInputs=[...root.querySelectorAll('[name="level"]')];
 const budget=root.querySelector('[data-budget]');
 const note=root.querySelector('[data-passport-note]');
 const output=root.querySelector('[data-inquiry]');
 let current;
 function render(sync=true){
  const world=Number(worldInputs.find(i=>i.checked).value);
  const level=Number(levelInputs.find(i=>i.checked).value);
  current=makeAdventure(world,level,budget.value);
  root.dataset.world=String(world);
  root.querySelector('[data-passport-word]').textContent=current.word;
  root.querySelector('[data-passport-title]').textContent=current.title;
  root.querySelector('[data-passport-place]').textContent=current.place;
  root.querySelector('[data-passport-level]').textContent=current.levelName;
  root.querySelector('[data-passport-mission]').textContent=current.mission;
  root.querySelector('[data-passport-code]').textContent=`PS / 0${world+1} — 0${level+1}`;
  output.value=inquiry(current);
  note.textContent='选择已更新，你的探索卡准备好了。';
  if(sync)document.dispatchEvent(new CustomEvent('adventure:world',{detail:world}));
 }
 root.querySelectorAll('input,select').forEach(input=>input.addEventListener('change',()=>render()));
 document.addEventListener('showroom:world',e=>{if(!worldInputs[e.detail])return;worldInputs[e.detail].checked=true;render(false);});
 root.querySelector('[data-surprise]').addEventListener('click',()=>{
  const previous=Number(worldInputs.find(i=>i.checked).value);
  worldInputs[(previous+1+Math.floor(Math.random()*2))%3].checked=true;
  levelInputs[Math.floor(Math.random()*3)].checked=true; render();
 });
 root.querySelector('[data-save-passport]').addEventListener('click',()=>{
  try{localStorage.setItem('ps-adventure-v1',JSON.stringify({version:1,world:current.world,level:current.level}));note.textContent='已保存在这台设备，下次回来可以继续。';}
  catch{note.textContent='浏览器未允许本地保存，可以下载探索卡留念。';}
 });
 root.querySelector('[data-reset-passport]').addEventListener('click',()=>{
  let cleared=true;try{localStorage.removeItem('ps-adventure-v1');}catch{cleared=false;}
  worldInputs[0].checked=true;levelInputs[0].checked=true;budget.selectedIndex=0;render();
  note.textContent=cleared?'已清除本机保存的选择，重新出发吧。':'选择已重置，但浏览器未允许清除本地记录。';
 });
 root.querySelector('[data-copy-inquiry]').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(output.value);note.textContent='咨询清单已复制，发给我们即可开始沟通。';}
  catch{output.focus();output.select();note.textContent='请长按或使用 Ctrl/Cmd+C，复制已选中的咨询清单。';}
 });
 root.querySelector('[data-download-passport]').addEventListener('click',()=>{
  const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const line=(x,y,text,size=26,color='#eeeeea')=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-family="Arial, sans-serif">${esc(text)}</text>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="640" viewBox="0 0 1000 640"><rect width="1000" height="640" rx="24" fill="#171b1a"/><rect x="0" y="0" width="15" height="640" fill="${current.color}"/>${line(65,72,'PERSONAL SHOPPER / EXPLORER PASS',20,current.color)}${line(60,220,current.word,140,current.color)}${line(65,305,current.title,38)}<path d="M65 355H935" stroke="#5d655e" stroke-dasharray="8 8"/>${line(65,408,'目的地 / '+current.place)}${line(65,456,'当前阶段 / '+current.levelName)}${line(65,516,'下次出发，从一个小小的行动开始。',22,'#a7b0a2')}${line(65,588,'兴趣探索卡 · 非订单 / 非报价',18,'#a7b0a2')}${line(740,588,`PS / 0${current.world+1} — 0${current.level+1}`,18,current.color)}</svg>`;
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`personal-shopper-${current.word.toLowerCase()}.svg`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  note.textContent='探索卡已生成，查看浏览器下载列表。';
 });
 try{const saved=parseSaved(localStorage.getItem('ps-adventure-v1'));if(saved){worldInputs[saved.world].checked=true;levelInputs[saved.level].checked=true;}}catch{}
 render();
 root.querySelector('[data-enhanced-actions]').hidden=false;
}
