// Seats describe real server visitors. No local players or captures are invented.
const palettes = [
  ['#a87039','#f1d4a2'], ['#4e8991','#c3e4e4'],
  ['#9371a3','#e3d3ef'], ['#b56572','#f2cdd4'],
  ['#527f62','#cfdfba'], ['#b77446','#f2d0ab'],
  ['#5778a4','#d0dff4'], ['#a58b34','#eee2a8'],
];
export const seatName = id => `Seat ${String(id).padStart(2,'0')}`;
export const seatPalette = id => palettes[id-1] || palettes[0];
export function recentSeatResult(state,id) {
  return (state.lassoResults||[]).filter(result=>result.seatId===id
    &&state.time-result.time>=0&&state.time-result.time<5).at(-1);
}
export function seatActivity(seat,state) {
  if(!seat.occupied)return 'Open seat';
  if(!seat.online)return 'Away · rope reserved';
  const rope=(state.lassos||[]).find(item=>item.id===seat.lassoId);
  if(rope)return `${rope.pulling?'Pulling':'Rope paused'} · ${Math.round(rope.progress*100)}%`;
  const result=recentSeatResult(state,seat.id);
  return result?{caught:'Rabbit home safe',stolen:'Rabbit snatched away',escaped:'Rabbit slipped free',cancelled:'Rabbit let go'}[result.outcome]
    :'Ready to cast';
}
export function seatResultMessage(result) {
  if(result?.seatId==null)return '';
  const verb={caught:'brought a rabbit home.',stolen:'lost a rabbit to wildlife.',
    escaped:'had a rabbit slip free.',cancelled:'let a rabbit go.'}[result.outcome];
  return verb?`${seatName(result.seatId)} ${verb}`:'';
}
export function validSeats(state) {
  if(state.seats===undefined)return state.mySeatId==null&&state.onlineCount===undefined;
  if(!Array.isArray(state.seats)||state.seats.length!==8)return false;
  const ropes=state.lassos||[];
  const ids=new Set(), ropeIds=new Set();
  for(const seat of state.seats){
    if(!seat||!Number.isInteger(seat.id)||seat.id<1||seat.id>8||ids.has(seat.id))return false;
    ids.add(seat.id);
    if(seat.x!==(seat.id<=4?90:910)||seat.y!==230+((seat.id-1)%4)*65
      ||typeof seat.occupied!=='boolean'||typeof seat.online!=='boolean')return false;
    const rope=ropes.find(item=>item.id===seat.lassoId);
    if(seat.lassoId!=null&&(!rope||ropeIds.has(seat.lassoId)
      ||(rope.seatId!=null&&rope.seatId!==seat.id)))return false;
    if(rope)ropeIds.add(rope.id);
    const expected=!seat.occupied?'empty':!seat.online?'away':rope?(rope.pulling?'pulling':'roped'):'ready';
    if(seat.status!==expected||(!seat.occupied&&(seat.online||rope)))return false;
  }
  if(!Number.isInteger(state.onlineCount)||state.onlineCount!==state.seats.filter(seat=>seat.online).length)return false;
  if(state.mySeatId!=null&&!state.seats.some(seat=>seat.id===state.mySeatId&&seat.occupied))return false;
  const own=ropes.find(rope=>rope.id===state.myLassoId);
  if(own&&!state.seats.some(seat=>seat.id===state.mySeatId&&seat.lassoId===own.id))return false;
  for(const item of [...ropes,...(state.lassoResults||[])]){
    if(item.seatId==null)continue; // Ropes saved before seats keep their old anchor.
    const seat=state.seats.find(seat=>seat.id===item.seatId);
    if(!seat||item.anchorX!==seat.x||item.anchorY!==seat.y)return false;
  }
  return ropes.every(rope=>rope.seatId==null||ropeIds.has(rope.id));
}
