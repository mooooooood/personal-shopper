// One ordered stream of pull leases. Releasing must never overtake an in-flight
// pull request and accidentally leave the rabbit moving after the player stops.
export function createLassoPuller({send, accept, change=()=>{}, error=()=>{},
  schedule=setTimeout, cancel=clearTimeout}) {
  let held=null, flight=false, stopId=null, timer=null;
  const clear=()=>{if(timer!==null)cancel(timer);timer=null;};
  async function finishStop() {
    if(stopId===null || flight)return;
    const id=stopId;stopId=null;flight=true;change();
    try {const result=await send('stop_pull',id);if(result.state)accept(result.state);}
    catch(cause){error(cause);}
    finally {flight=false;change();}
  }
  async function pulse() {
    if(held===null || flight)return;
    const id=held;flight=true;
    try {
      const result=await send('pull',id);
      if(result.state)accept(result.state);
      if(!result.ok){held=null;clear();error(new Error(result.code));}
    } catch(cause) {
      held=null;stopId=id;clear();error(cause);
    } finally {
      flight=false;
      if(stopId!==null)void finishStop();
      else if(held!==null)timer=schedule(pulse,600);
      change();
    }
  }
  return {
    get heldId(){return held;},
    get stopping(){return held===null&&(flight||stopId!==null);},
    start(id){
      if(!Number.isSafeInteger(id)||id<1||flight||stopId!==null||held!==null)return false;
      held=id;change();void pulse();return true;
    },
    stop(){
      if(held===null)return;
      stopId=held;held=null;clear();change();void finishStop();
    },
    sync(id){
      if(held!==null&&held!==id){held=null;clear();}
      if(stopId!==null&&stopId!==id)stopId=null;
      change();
    },
  };
}

// Follow the current owned rope automatically. View changes supply intent;
// the ordered lease stream still prevents a late pull from overtaking a stop.
export function createAutoLassoPuller(options) {
  let target=null, active=false, queued=false;
  const reconcile=()=>{
    if(queued)return;
    queued=true;
    queueMicrotask(()=>{
      queued=false;
      if(active&&target!==null&&stream.heldId===null&&!stream.stopping)stream.start(target);
    });
  };
  const stream=createLassoPuller({...options,
    change:()=>{options.change?.();reconcile();},
    error:cause=>{active=false;options.error?.(cause);},
  });
  return {
    update(id,enabled){
      target=Number.isSafeInteger(id)&&id>0?id:null;active=Boolean(enabled);
      stream.sync(target);
      if(!active)stream.stop();
      reconcile();
    },
  };
}
