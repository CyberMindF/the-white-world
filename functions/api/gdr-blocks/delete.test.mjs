import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`CREATE TABLE gdr_blocks(id INTEGER PRIMARY KEY,document_key TEXT,type TEXT,data TEXT,updated_at TEXT,position INTEGER DEFAULT 0,created_by INTEGER DEFAULT 1,created_at TEXT DEFAULT 'versione-0');
 INSERT INTO gdr_blocks(id,document_key,type,data,updated_at) VALUES(17,'avventura','paragraph','{"text":"Da eliminare"}','versione-1');`);
 const db={prepare(sql){return{bind(...args){return{
  async first(){return sqlite.prepare(sql).get(...args)??null;},
  async all(){return{results:sqlite.prepare(sql).all(...args)};},
  async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};},
 };},async first(){return sqlite.prepare(sql).get()??null;},async all(){return{results:sqlite.prepare(sql).all()};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const events=[];
 const source=readFileSync(new URL('./[id].js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\s*/gm,'').replace(/export /g,'');
 const session=async request=>{const id=Number(request.headers.get('x-user'));return id?{user:{id,role:id===2?'member':'admin',isTest:id===3},sessionId:'test'}:null;};
 const json=(body,status=200)=>Response.json(body,{status});
 const permission=(role,permission)=>permission==='content.read'||role==='admin';
 const indexSource=readFileSync(new URL('./index.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\s*/gm,'').replace(/export /g,'');
 const helpers=new Function(readFileSync(new URL('./_shared.js',import.meta.url),'utf8').replace(/export /g,'')+';return {normalizeData,normalizeType,normalizeDocumentKey};')();
 const index=new Function('getAuthenticatedSession','json','hasPermission','readJson','normalizeData','normalizeType','normalizeDocumentKey','recordEvent','notifyRealtime',indexSource+';return {onRequestGet,onRequestPost,toBlockView};')(session,json,permission,request=>request.json(),helpers.normalizeData,helpers.normalizeType,helpers.normalizeDocumentKey,async()=>{},async(_env,event)=>{events.push(event);});
 const api=new Function('getAuthenticatedSession','json','readJson','hasPermission','recordEvent','notifyRealtime','normalizeData','normalizeType','toBlockView',source+';return {onRequestDelete,onRequestPut};')(
  session,json,request=>request.json(),permission,async()=>{},async(_env,event)=>{events.push(event);},helpers.normalizeData,helpers.normalizeType,index.toBlockView,
 );
 const snapshot={expectedUpdatedAt:'versione-1',expectedType:'paragraph',expectedData:{text:'Da eliminare'}};
 const request=(user,payload,method)=>(method==='DELETE'?api.onRequestDelete:api.onRequestPut)({env:{DB:db},params:{id:'17'},waitUntil(){},request:new Request('https://test/api/gdr-blocks/17',{method,headers:{'x-user':String(user),'Content-Type':'application/json'},body:JSON.stringify(payload)})});
 const call=(user,payload=snapshot)=>request(user,payload,'DELETE');
 const put=(user,payload)=>request(user,payload,'PUT');
 const list=user=>index.onRequestGet({env:{DB:db},request:new Request('https://test/api/gdr-blocks',{headers:{'x-user':String(user)}})});
 const post=(user,payload)=>index.onRequestPost({env:{DB:db},waitUntil(){},request:new Request('https://test/api/gdr-blocks',{method:'POST',headers:{'x-user':String(user),'Content-Type':'application/json'},body:JSON.stringify(payload)})});
 return{sqlite,call,put,list,post,snapshot,events};
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
test('la trasformazione di un paragrafo in dialogo con avatar viene salvata e letta identica dai due account',async()=>{
 const h=fixture();const source='::: dialogo Shivay | /assets/avatar.webp\nNon è una buona notizia.\n:::';
 const payload={...h.snapshot,type:'paragraph',data:{text:source,format:'gdr-narrative'}};
 assert.equal((await h.put(2,payload)).status,403);assert.equal((await h.put(3,payload)).status,403);
 assert.equal((await h.put(1,payload)).status,200);
 const master=await (await h.list(1)).json(),desy=await (await h.list(2)).json();
 assert.deepEqual(master,desy);assert.equal(desy.blocks[0].id,'17');assert.equal(desy.blocks[0].data.text,source);assert.equal(desy.blocks[0].data.format,'gdr-narrative');
 assert.equal(h.events[0].action,'updated');assert.equal((await h.put(1,payload)).status,409);h.sqlite.close();
});
test('aggiunge un blocco nel punto scelto mantenendo gli ID esistenti e l’ordine condiviso',async()=>{
 const h=fixture();h.sqlite.prepare('INSERT INTO gdr_blocks(id,document_key,type,data,updated_at,position) VALUES(?,?,?,?,?,?)').run(18,'avventura','paragraph',JSON.stringify({text:'Secondo.'}),'versione-2',1);
 const payload={documentKey:'avventura',type:'paragraph',data:{text:'Nuovo.'},beforeId:'18',expectedBeforeData:{text:'Secondo.'},expectedBeforeUpdatedAt:'versione-2'};
 assert.equal((await h.post(2,payload)).status,403);assert.equal((await h.post(1,payload)).status,201);
 const shared=await (await h.list(2)).json();assert.deepEqual(shared.blocks.map(b=>b.id),['17','19','18']);assert.deepEqual(shared.blocks.map(b=>b.position),[0,1,2]);
 assert.equal((await h.post(1,{...payload,expectedBeforeUpdatedAt:'obsoleta'})).status,409);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM gdr_blocks').get().n,3);h.sqlite.close();
});
