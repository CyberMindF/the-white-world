import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from '../web/node_modules/typescript/lib/typescript.js';

const source=ts.transpileModule(readFileSync(new URL('../realtime-worker/src/index.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}
}).outputText.replace(/^import .*;\s*/m,'').replace(/export default [\s\S]*$/,'').replace('export class','class');

function fixture(){
  const sockets=[], stored=new Map(), writes=[];
  class Socket {
    readyState=1;messages=[];attachment=null;
    send(message){this.messages.push(JSON.parse(message));}
    serializeAttachment(value){this.attachment=structuredClone(value);}
    deserializeAttachment(){return structuredClone(this.attachment);}
    close(){this.readyState=3;}
  }
  class Pair {constructor(){this[0]=new Socket();this[1]=new Socket();}}
  const ctx={acceptWebSocket(socket){sockets.push(socket);},getWebSockets(){return sockets;},storage:{async put(key,value){writes.push([key,value]);stored.set(key,value);},async get(key){return stored.get(key);}}};
  const Room=new Function('DurableObject','WebSocketPair','Response',source+';return RealtimeRoom;')(
    class {constructor(ctx){this.ctx=ctx;}},Pair,class {constructor(_body,options){Object.assign(this,options);}},
  );
  const room=new Room(ctx);
  const connect=async(identity,observer=false)=>{
    await room.fetch(new Request('https://test/realtime?path=/gdr&visible=true',{headers:{Upgrade:'websocket','X-Realtime-User-Id':identity==='lei'?'2':'1','X-Realtime-Identity':identity,'X-Realtime-Is-Test':'false','X-Realtime-Observer':String(observer)}}));
    return sockets.at(-1);
  };
  return{Room,ctx,room,connect,sockets,stored,writes};
}

test('l’osservatore riceve gli aggiornamenti senza diventare online o aggiornare l’ultimo accesso, anche dopo ibernazione',async()=>{
  const h=fixture(),master=await h.connect('lui'),before=[...h.writes];
  master.messages=[];
  const observer=await h.connect('lei',true);
  assert.deepEqual(h.writes,before);assert.equal(master.messages.length,0);
  const restored=new h.Room(h.ctx);
  await restored.webSocketMessage(observer,JSON.stringify({type:'presence:update',path:'/novita',visible:true}));
  assert.deepEqual(h.writes,before);assert.equal(master.messages.length,0);
  assert.equal(await restored.broadcast({type:'gdr-turns:changed',occurredAt:new Date().toISOString()}),2);
  assert.equal(observer.messages.at(-1).type,'gdr-turns:changed');
  await restored.webSocketClose(observer,1000,'done',true);
  assert.deepEqual(h.writes,before);
  assert.equal(master.messages.filter(e=>e.type==='presence:changed').length,0);
});

test('la presenza reale di Desy resta indipendente dall’osservatore',async()=>{
  const h=fixture(),master=await h.connect('lui'),observer=await h.connect('lei',true);
  master.messages=[];
  const player=await h.connect('lei');
  assert.equal(master.messages.at(-1).online,true);
  assert.equal(observer.messages.at(-1).online,true);
  await h.room.webSocketMessage(player,JSON.stringify({type:'presence:update',path:'/carte',visible:true}));
  assert.equal(master.messages.at(-1).path,'/carte');
  await h.room.webSocketClose(player,1000,'done',true);
  assert.equal(master.messages.at(-1).online,false);
  assert.equal(master.messages.at(-1).path,null);
  assert.equal(observer.readyState,1);
});
