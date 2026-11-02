import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`CREATE TABLE gdr_blocks(id INTEGER PRIMARY KEY,document_key TEXT,type TEXT,data TEXT,updated_at TEXT);
 INSERT INTO gdr_blocks VALUES(17,'avventura','paragraph','{"text":"Da eliminare"}','versione-1');`);
 const db={prepare(sql){return{bind(...args){return{
  async first(){return sqlite.prepare(sql).get(...args)??null;},
  async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};},
 };}};}};
 const events=[];
 const source=readFileSync(new URL('./[id].js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\s*/gm,'').replace(/export /g,'');
 const handler=new Function('getAuthenticatedSession','json','readJson','hasPermission','recordEvent','notifyRealtime',source+';return onRequestDelete;')(
  async request=>{const id=Number(request.headers.get('x-user'));return id?{user:{id,role:id===2?'member':'admin',isTest:id===3},sessionId:'test'}:null;},
  (body,status=200)=>Response.json(body,{status}),request=>request.json(),role=>role==='admin',async()=>{},async(_env,event)=>{events.push(event);},
 );
 const snapshot={expectedUpdatedAt:'versione-1',expectedType:'paragraph',expectedData:{text:'Da eliminare'}};
 const call=(user,payload=snapshot)=>handler({env:{DB:db},params:{id:'17'},waitUntil(){},request:new Request('https://test/api/gdr-blocks/17',{method:'DELETE',headers:{'x-user':String(user),'Content-Type':'application/json'},body:JSON.stringify(payload)})});
 return{sqlite,call,snapshot,events};
}
test('solo il master elimina il blocco scelto dalla storia e notifica la partita condivisa',async()=>{
 const h=fixture();assert.equal((await h.call(0)).status,401);assert.equal((await h.call(2)).status,403);assert.equal((await h.call(3)).status,403);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM gdr_blocks').get().n,1);
 assert.equal((await h.call(1)).status,200);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM gdr_blocks').get().n,0);
 assert.equal(h.events[0].type,'gdr-story:changed');assert.equal(h.events[0].adventure,'il-prezzo-della-verita');h.sqlite.close();
});
test('una conferma vecchia non elimina contenuto cambiato, neppure con la stessa data di modifica',async()=>{
 const h=fixture();h.sqlite.prepare('UPDATE gdr_blocks SET data=? WHERE id=17').run(JSON.stringify({text:'Nuovo testo'}));
 assert.equal((await h.call(1)).status,409);assert.equal(h.sqlite.prepare('SELECT data FROM gdr_blocks WHERE id=17').get().data,'{"text":"Nuovo testo"}');
 assert.equal((await h.call(1,{...h.snapshot,expectedData:{text:'Nuovo testo'}})).status,200);h.sqlite.close();
});
test('resta compatibile con l’eliminazione dell’editor amministrativo già esistente',async()=>{
 const h=fixture();assert.equal((await h.call(1,{})).status,200);h.sqlite.close();
});
