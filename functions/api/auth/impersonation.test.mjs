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
 const session=await h.session();assert.equal(session.user.id,2);assert.equal(session.user.role,'member');assert.equal(session.adminModeEnabled,false);assert.equal(session.impersonation.actorId,1);assert.equal(session.impersonation.readOnly,true);
 assert.equal(h.sql.prepare('SELECT user_id FROM sessions WHERE id=1').get().user_id,1);
 assert.equal((await h.session('member-token')).impersonation,null);
 assert.equal((await h.call('DELETE')).status,200);assert.equal((await h.session()).user.id,1);assert.equal((await h.session()).adminModeEnabled,true);h.sql.close();
});
test('in impersonazione il server blocca tutte le scritture, compresi autenticazione e privilegi admin',async()=>{
 const h=await fixture();await h.call('POST','admin-token',{userId:2});let count=0;
 for(const [method,path] of [['POST','/api/gdr/turns'],['POST','/api/gdr-workspace/mutate'],['POST','/api/auth/admin-mode'],['POST','/api/auth/profile/password'],['DELETE','/api/letters/1'],['PUT','/api/letters/draft']]){
  const response=await middleware({env:h.env,request:h.request(path,method),next(){count++;return new Response('ok');}});assert.equal(response.status,403,path);
 }
 assert.equal(count,0);
 for(const [method,path] of [['GET','/api/gdr-workspace'],['DELETE','/api/auth/impersonation']]){
 const response=await middleware({env:h.env,request:h.request(path,method),next(){count++;return new Response('ok');}});assert.equal(response.status,200);
 }
 assert.equal(count,2);h.sql.close();
});
test('non continua a impersonare un account disattivato e non riacquista privilegi in silenzio',async()=>{
 const h=await fixture();await h.call('POST','admin-token',{userId:2});h.sql.prepare('UPDATE users SET is_activated=0 WHERE id=2').run();
 assert.equal(await h.session(),null);assert.equal((await h.call('DELETE')).status,200);assert.equal((await h.session()).user.id,1);h.sql.close();
});

test('eliminare il target non restituisce privilegi admin a una pagina ancora impersonata',async()=>{
 const h=await fixture();await h.call('POST','admin-token',{userId:2});h.sql.prepare('DELETE FROM users WHERE id=2').run();
 assert.equal(await h.session(),null);assert.equal((await h.call('DELETE')).status,200);assert.equal((await h.session()).user.id,1);h.sql.close();
});
