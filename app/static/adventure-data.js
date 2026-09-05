// Local editorial prompts, not inventory, pricing or professional training advice.
export const worlds = [
 {name:'力量训练',word:'TRAIN',title:'把日常，练成自己的主场。',place:'城市里的训练角',color:'#caff73',prompts:['给训练角整理出一个固定位置，记录你想坚持的习惯。','列出当前装备最想改善的一点，带着具体需求选下一件。','写下理想训练空间的样子，从最常用的装备开始规划。'],gear:'健身器械',questions:'可用空间、训练目标、意向重量和器械尺寸'},
 {name:'户外垂钓',word:'CAST',title:'把时间，交还给水面。',place:'周末的水边',color:'#8edce3',prompts:['找一处允许垂钓的水域，先了解当地规则和适合的钓法。','记录上次出钓最不顺手的环节，把需求说得更具体。','整理目标鱼种、常去水域与携带方式，再确定装备方向。'],gear:'钓鱼竿',questions:'钓法、水域、目标鱼种、长度和调性'},
 {name:'音乐乐器',word:'PLAY',title:'把心情，调成自己的音色。',place:'属于你的排练室',color:'#c4a4ff',prompts:['选一段最想弹的旋律，让它成为你的第一张音乐名片。','记录喜欢的三种音色，找到下一件装备要解决的问题。','写下演奏风格、现有设备和理想音色，准备自己的配置清单。'],gear:'电吉他与乐器',questions:'演奏风格、意向型号、现有设备和附件需求'}
];
export const levels = ['刚刚心动','已经入坑','认真进阶'];
export function makeAdventure(world, level, budget='待沟通') {
 if(!Number.isInteger(world)||!worlds[world]||!Number.isInteger(level)||!levels[level]) throw new RangeError('Invalid selection');
 const w=worlds[world];
 return {world,level,worldName:w.name,word:w.word,title:w.title,place:w.place,color:w.color,mission:w.prompts[level],gear:w.gear,questions:w.questions,levelName:levels[level],budget};
}
export function inquiry(a) {
 return `你好，我想咨询${a.gear}。\n使用场景：${a.place}\n经验阶段：${a.levelName}\n预算范围：${a.budget}\n希望进一步确认：${a.questions}。\n意向品牌 / 型号：待补充\n收货地区 / 期望时间：待补充\n请帮我确认可采购型号、报价和交付安排。`;
}
export function parseSaved(raw) {
 try { const value=JSON.parse(raw); if(value.version!==1)return null; makeAdventure(value.world,value.level); return {world:value.world,level:value.level}; } catch {return null;}
}
