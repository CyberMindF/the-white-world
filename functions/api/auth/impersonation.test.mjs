import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8').replace(/^import[\s\S]*?;\s*/gm,'').replace(/export /g,'');
const auth=new Function('getConnectionIp',source('./_shared.js')+';return {getAuthenticatedSession,hashToken,json,readJson};')(()=>null);
const endpoints=new Function(...Object.keys(auth),source('./impersonation.js')+';return {get:onRequestGet,post:onRequestPost,stop:onRequestDelete};')(...Object.values(auth));
const middleware=new Function('getAuthenticatedSession','json',source('../_middleware.js')+';return onRequest;')(auth.getAuthenticatedSession,auth.json);
async function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 sql.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,nickname TEXT,identity TEXT,role TEXT,is_test INTEGER,safe_mode INTEGER,is_activated INTEGER);
 INSERT INTO users VALUES(1,'admin@example.test','Master','lui','admin',0,0,1),(2,'player@example.test','Desy','lei','member',0,0,1),(3,'test@example.test','Test Desy','lei','member',1,0,1),(4,'off@example.test','Spento','lei','member',0,0,0);
 CREATE TABLE sessions(id INTEGER PRIMARY KEY,user_id INTEGER,token_hash TEXT,expires_at TEXT,deleted_at TEXT,admin_mode_enabled INTEGER,last_seen_at TEXT);
 `);
 sql.exec(readFileSync(new URL('../../../migrations/0146_add_admin_impersonation.sql',import.meta.url),'utf8'));
 for(const [id,token] of [[1,'admin-token'],[2,'member-token']])sql.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at,admin_mode_enabled) VALUES(?,?,?,?,?)').run(id,id,await auth.hashToken(token),'2035-01-01T00:00:00.000Z',id===1?1:0);
 const db={prepare(query){const make=(args=[])=>({bind(...args){return make(args);},async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const result=sql.prepare(query).run(...args);return{meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}});return make();}};
 const env={DB:db};
 const request=(path='/api/auth/impersonation',method='GET',token='admin-token',body)=>new Request('https://test'+path,{method,headers:{Cookie:'noi_session='+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const call=(method='GET',token='admin-token',body)=>endpoints[method==='POST'?'post':method==='DELETE'?'stop':'get']({env,request:request(undefined,method,token,body)});
 const session=(token='admin-token')=>auth.getAuthenticatedSession(request(undefined,'GET',token),env);
 return {sql,env,request,call,session};
}
test('solo un admin in modalità admin può selezionare una giocatrice reale attiva',async()=>{
 const h=await fixture();assert.equal((await h.call('POST','member-token',{userId:2})).status,403);
 const users=(await (await h.call()).json()).users;assert.deepEqual(users,[{id:2,nickname:'Desy'}]);
 for(const id of [1,3,4,999])assert.equal((await h.call('POST','admin-token',{userId:id})).status,404);
 h.sql.prepare('UPDATE sessions SET admin_mode_enabled=0 WHERE id=1').run();assert.equal((await h.call('POST','admin-token',{userId:2})).status,403);h.sql.close();
});
test('identità e permessi effettivi sono quelli di Desy; il login e la sessione vera di lei restano intatti',async()=>{
 const h=await fixture();assert.equal((await h.call('POST','admin-token',{userId:2})).status,200);
 const session=await h.session();assert.equal(session.user.id,2);assert.equal(session.user.role,'member');assert.equal(session.adminModeEnabled,false);assert.equal(session.impersonation.actorId,1);assert.equal(session.impersonation.readOnly,false);
 assert.equal(h.sql.prepare('SELECT user_id FROM sessions WHERE id=1').get().user_id,1);
 assert.equal((await h.session('member-token')).impersonation,null);
 assert.equal((await h.call('DELETE')).status,200);assert.equal((await h.session()).user.id,1);assert.equal((await h.session()).adminModeEnabled,true);h.sql.close();
});
test('in impersonazione le scritture raggiungono le API con identità e permessi di Desy',async()=>{
 const h=await fixture();await h.call('POST','admin-token',{userId:2});let count=0;
 for(const [method,path] of [['POST','/api/gdr/turns'],['POST','/api/gdr-workspace/mutate'],['POST','/api/auth/admin-mode'],['POST','/api/auth/profile/password'],['DELETE','/api/letters/1'],['PUT','/api/letters/draft']]){
  const request=h.request(path,method);
  const response=await middleware({env:h.env,request,async next(){count++;const session=await auth.getAuthenticatedSession(request,h.env);assert.equal(session.user.id,2);assert.equal(session.user.role,'member');assert.equal(session.adminModeEnabled,false);return new Response('ok');}});assert.equal(response.status,200,path);
 }
 assert.equal(count,6);
 for(const [method,path] of [['GET','/api/gdr-workspace'],['DELETE','/api/auth/impersonation']]){
 const response=await middleware({env:h.env,request:h.request(path,method),next(){count++;return new Response('ok');}});assert.equal(response.status,200);
 }
 assert.equal(count,8);
 const adminMode=new Function('getAuthenticatedSession','json','readJson','recordEvent',source('./admin-mode.js')+';return onRequestPost;')(auth.getAuthenticatedSession,auth.json,auth.readJson,async()=>{});
 assert.equal((await adminMode({env:h.env,request:h.request('/api/auth/admin-mode','POST','admin-token',{enabled:true}),waitUntil(){}})).status,403);
 h.sql.close();
});
test('non continua a impersonare un account disattivato e non riacquista privilegi in silenzio',async()=>{
 const h=await fixture();await h.call('POST','admin-token',{userId:2});h.sql.prepare('UPDATE users SET is_activated=0 WHERE id=2').run();
 assert.equal(await h.session(),null);assert.equal((await h.call('DELETE')).status,200);assert.equal((await h.session()).user.id,1);h.sql.close();
});

test('turni e appunti salvati impersonando Desy appartengono a lei e restano visibili dopo l’uscita',async()=>{
 const h=await fixture();await h.call('POST','admin-token',{userId:2});
 h.sql.exec(`CREATE TABLE gdr_turns(id INTEGER PRIMARY KEY,author_id INTEGER,adventure TEXT,body TEXT,created_at TEXT);
 CREATE TABLE gdr_notes(user_id INTEGER,adventure TEXT,body TEXT,updated_at TEXT,PRIMARY KEY(user_id,adventure));
 INSERT INTO gdr_turns VALUES(1,2,'il-prezzo-della-verita','Risposta originale','2026-11-01'),(2,1,'il-prezzo-della-verita','Racconto master','2026-11-02');`);
 const turns=new Function('getAuthenticatedSession','json','readJson','recordEvent','notifyRealtime',source('../gdr/turns.js')+';return {post:onRequestPost,put:onRequestPut};')(auth.getAuthenticatedSession,auth.json,auth.readJson,async()=>{},async()=>{});
 const notes=new Function('getAuthenticatedSession','json',source('../gdr/notes.js')+';return onRequestPost;')(auth.getAuthenticatedSession,auth.json);
 const run=async(request,handler)=>middleware({env:h.env,request,next:()=>handler({env:h.env,request,waitUntil(){}})});
 const payload={id:1,expectedBody:'Risposta originale',body:'Risposta modificata impersonando Desy'};
 assert.equal((await run(h.request('/api/gdr/turns','PUT','admin-token',payload),turns.put)).status,200);
 assert.equal((await run(h.request('/api/gdr/turns','PUT','admin-token',{...payload,id:2,expectedBody:'Racconto master'}),turns.put)).status,403);
 const form=new FormData();form.set('body','Nuovo turno di Desy');
 const created=await run(new Request('https://test/api/gdr/turns',{method:'POST',headers:{Cookie:'noi_session=admin-token'},body:form}),turns.post);
 assert.equal(created.status,201);assert.equal((await created.json()).isMaster,false);
 const note=new FormData();note.set('body','Appunto personale di Desy');
 assert.equal((await run(new Request('https://test/api/gdr/notes',{method:'POST',headers:{Cookie:'noi_session=admin-token'},body:note}),notes)).status,200);
 await h.call('DELETE');assert.equal((await h.session()).user.id,1);
 assert.deepEqual(h.sql.prepare('SELECT author_id,body FROM gdr_turns ORDER BY id').all().map(r=>({...r})),[{author_id:2,body:payload.body},{author_id:1,body:'Racconto master'},{author_id:2,body:'Nuovo turno di Desy'}]);
 assert.equal(h.sql.prepare('SELECT user_id FROM gdr_notes').get().user_id,2);
 h.sql.close();
});

test('il realtime impersonato riceve gli aggiornamenti come osservatore senza presenza',async()=>{
 const h=await fixture();await h.call('POST','admin-token',{userId:2});let forwarded;
 const realtime=new Function('getAuthenticatedSession','json',source('../realtime.js')+';return onRequestGet;')(auth.getAuthenticatedSession,auth.json);
 const response=await realtime({request:new Request('https://test/api/realtime',{headers:{Cookie:'noi_session=admin-token',Upgrade:'websocket'}}),env:{...h.env,REALTIME:{getByName(){return{fetch(request){forwarded=request;return new Response('ok');}};}}}});
 assert.equal(response.status,200);assert.equal(forwarded.headers.get('X-Realtime-User-Id'),'2');assert.equal(forwarded.headers.get('X-Realtime-Identity'),'lei');assert.equal(forwarded.headers.get('X-Realtime-Observer'),'true');
 await h.call('DELETE');
 await realtime({request:new Request('https://test/api/realtime',{headers:{Cookie:'noi_session=admin-token',Upgrade:'websocket','X-Realtime-Observer':'true'}}),env:{...h.env,REALTIME:{getByName(){return{fetch(request){forwarded=request;return new Response('ok');}};}}}});
 assert.equal(forwarded.headers.get('X-Realtime-Observer'),'false');h.sql.close();
});

test('visite, telemetria e conferme di lettura sono inerti solo durante impersonazione; le modifiche restano abilitate',async()=>{
 const h=await fixture();await h.call('POST','admin-token',{userId:2});
 const paths=['/api/visits','/api/telemetry/events','/api/telemetry/word-attempts','/api/world-updates/seen','/api/world-promos/view','/api/ponti-chat/read','/api/letters/12'];
 let writes=0;
 for (const path of paths) {
  const response=await middleware({env:h.env,request:h.request(path,'POST'),next(){writes++;return new Response('ok');}});
  assert.equal(response.status,200,path);assert.equal(writes,0,path);
 }
 for (const [path,method] of [['/api/letters/12','PUT'],['/api/gdr/turns','PUT'],['/api/gdr/notes','POST'],['/api/gdr-workspace','POST']]) {
  assert.equal((await middleware({env:h.env,request:h.request(path,method),next(){writes++;return new Response('ok');}})).status,200);
 }
 assert.equal(writes,4);
 for (const path of paths) await middleware({env:h.env,request:h.request(path,'POST','member-token'),next(){writes++;return new Response('ok');}});
 assert.equal(writes,4+paths.length);h.sql.close();
});

test('nessun falso accesso o email; i salvataggi restano attribuiti all’admin anche dopo l’uscita',async()=>{
 const h=await fixture();await h.call('POST','admin-token',{userId:2});let emails=0;
 h.sql.exec(`ALTER TABLE users ADD COLUMN activity_logging_enabled INTEGER DEFAULT 1;
 CREATE TABLE events(id INTEGER PRIMARY KEY,user_id INTEGER,session_id INTEGER,section TEXT,event_type TEXT,event_version INTEGER,metadata TEXT);`);
 const record=new Function('notifyLoggedEvent',source('../_shared/events.js')+';return recordEvent;')(async()=>{emails++;});
 for (const eventType of ['world_page_opened','world_unlocked','letter_read','gdr_adventure_opened']) {
  assert.equal((await record(h.env,{userId:2,sessionId:1},{section:'gdr',eventType})).recorded,false);
 }
 assert.equal((await record(h.env,{userId:2,sessionId:1},{section:'gdr',eventType:'gdr_turn_submitted'})).recorded,true);
 await h.call('DELETE');
 assert.equal((await record(h.env,{userId:2,sessionId:1},{section:'gdr',eventType:'content_updated'})).recorded,true);
 const rows=h.sql.prepare('SELECT user_id,metadata FROM events').all();assert.equal(rows.length,2);
 for (const row of rows) {assert.equal(row.user_id,1);assert.deepEqual(JSON.parse(row.metadata).impersonation,{actorId:1,targetId:2});}
 assert.equal(emails,0);
 assert.equal((await record(h.env,{userId:2,sessionId:2},{section:'gdr',eventType:'world_page_opened'})).recorded,true);
 assert.equal(emails,1);h.sql.close();
});

test('confermare la chiave in una sessione impersonata non registra un accesso della giocatrice',async()=>{
 const h=await fixture();await h.call('POST','admin-token',{userId:2});
 const unlock=new Function('recordEvent','linkVisitToSession','getAuthEventMetadata','getAuthenticatedSession','isWorldKeyValid','json','readJson','revokeCurrentSession',source('./session.js')+';return onRequestPost;')(
  ()=>assert.fail('evento di accesso'),()=>assert.fail('visita attribuita al target'),()=>({}),auth.getAuthenticatedSession,()=>true,auth.json,auth.readJson,()=>{},
 );
 const response=await unlock({request:h.request('/api/auth/session','POST','admin-token',{worldKey:'test'}),env:h.env,waitUntil(){assert.fail('attività pianificata');}});
 assert.equal(response.status,200);assert.equal((await response.json()).user.id,2);h.sql.close();
});

test('saldo, streak e tick bustine sono consultabili senza maturare premi; il prossimo accesso reale li assegna ancora',async()=>{
 const h=await fixture();await h.call('POST','admin-token',{userId:2});
 h.sql.exec(`CREATE TABLE carte_bustine(user_id INTEGER PRIMARY KEY,quantita_disponibile INTEGER DEFAULT 0,minuti_residui INTEGER DEFAULT 0,evocazioni_disponibili INTEGER DEFAULT 0,bustine_senza_evocazione INTEGER DEFAULT 0,updated_at TEXT,ultimo_minuto_attivo TEXT);
 CREATE TABLE carte_streak(user_id INTEGER PRIMARY KEY,streak_corrente INTEGER,streak_migliore INTEGER,ultimo_giorno TEXT,updated_at TEXT);
 INSERT INTO carte_bustine VALUES(2,7,9,0,0,'originale',NULL);
 INSERT INTO carte_streak VALUES(2,3,5,'2020-01-01','originale');`);
 const helpers=new Function(source('../carte-bustine/_shared.js')+';return {readBustineState,ensureBustineState,checkStreak,recordActiveMinute};')();
 h.env.DB.batch=async statements=>Promise.all(statements.map(s=>s.run()));
 const read=new Function('getAuthenticatedSession','json','findTradePartner',...Object.keys(helpers),source('../carte-bustine/index.js')+';return onRequestGet;')(auth.getAuthenticatedSession,auth.json,async()=>null,...Object.values(helpers));
 const tick=new Function('getAuthenticatedSession','json',...Object.keys(helpers),source('../carte-bustine/presenza.js')+';return onRequestPost;')(auth.getAuthenticatedSession,auth.json,...Object.values(helpers));
 const before=h.sql.prepare('SELECT * FROM carte_bustine').get(),streakBefore=h.sql.prepare('SELECT * FROM carte_streak').get();
 const state=await (await read({env:h.env,request:h.request('/api/carte-bustine')})).json();
 assert.equal(state.quantitaDisponibile,7);assert.equal(state.streakCorrente,3);assert.equal(state.streakBustineBonus,0);assert.equal(state.streakPrimaVisitaOggi,false);
 assert.equal((await (await tick({env:h.env,request:h.request('/api/carte-bustine/presenza','POST')})).json()).minutoRegistrato,false);
 assert.deepEqual(h.sql.prepare('SELECT * FROM carte_bustine').get(),before);assert.deepEqual(h.sql.prepare('SELECT * FROM carte_streak').get(),streakBefore);
 const real=await (await read({env:h.env,request:h.request('/api/carte-bustine','GET','member-token')})).json();
 assert.equal(real.streakPrimaVisitaOggi,true);assert.equal(real.quantitaDisponibile,8);
 h.sql.close();
});

test('eliminare il target non restituisce privilegi admin a una pagina ancora impersonata',async()=>{
 const h=await fixture();await h.call('POST','admin-token',{userId:2});h.sql.prepare('DELETE FROM users WHERE id=2').run();
 assert.equal(await h.session(),null);assert.equal((await h.call('DELETE')).status,200);assert.equal((await h.session()).user.id,1);h.sql.close();
});

test('l’anteprima esplicita di un’offerta vuota non provoca rimborsi o eliminazioni',async()=>{
 const read=new Function(source('../carte-evocazioni/_shared.js')+';return readOpenOffer;')();let writes=0;
 const db={prepare(){return{bind(){return{async first(){return{id:1};},async all(){return{results:[]};}};}};},async batch(){writes++;}};
 assert.equal(await read({DB:db},2,{readOnly:true}),null);assert.equal(writes,0);
 assert.equal(await read({DB:db},2),null);assert.equal(writes,1);
});

test('i nuovi eventi rispettano la preferenza di logging e registrano solo utenti abilitati',async()=>{
 const h=await fixture();let emails=0;
 try {
  h.sql.exec(`ALTER TABLE users ADD COLUMN activity_logging_enabled INTEGER DEFAULT 0;
   CREATE TABLE events(id INTEGER PRIMARY KEY,user_id INTEGER,session_id INTEGER,section TEXT,event_type TEXT,event_version INTEGER,metadata TEXT);`);
  const record=new Function('notifyLoggedEvent',source('../_shared/events.js')+';return recordEvent;')(async()=>{emails++;});
  const actor={userId:2,sessionId:2};
  const types=['safe_mode_changed','gdr_adventure_opened','gdr_workspace_changed','account_setting_changed','quiz_completed','quiz_progressed'];
  for(const eventType of types) assert.equal((await record(h.env,actor,{section:'gdr',eventType})).recorded,false);
  assert.equal(emails,0);
  h.sql.exec('UPDATE users SET activity_logging_enabled=1 WHERE id=2');
  for(const eventType of types) assert.equal((await record(h.env,actor,{section:'gdr',eventType})).recorded,true);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM events').get().n,types.length);
 } finally {h.sql.close();}
});
