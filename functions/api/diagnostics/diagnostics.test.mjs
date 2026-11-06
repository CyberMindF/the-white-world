import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
const helpers = new Function(source('../_shared/diagnostics.js') + ';return {saveDiagnostic,cleanDiagnosticContext,cleanDiagnosticText,readDiagnosticBody}')();
const session = { user: { id: 2, role: 'member' }, sessionId: 38, impersonation: { actorId: 1 } };
const routes = new Function('getAuthenticatedSession','json','hasPermission', ...Object.keys(helpers),source('./index.js')+';return {post:onRequestPost,get:onRequestGet}')(async req => req.headers.has('x-anonymous') ? null : req.headers.has('x-admin') ? {user:{id:1,role:'admin'}} : session, (v,s=200)=>Response.json(v,{status:s}), (role)=>role==='admin',...Object.values(helpers));
function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../../migrations/0154_diagnostic_errors.sql',import.meta.url),'utf8'));
  const db = { prepare(query) { return { bind(...args) { const stmt = sql.prepare(query); return { async run(){ const result=stmt.run(...args);return {meta:{changes:Number(result.changes)}} },async all(){return {results:stmt.all(...args)}} }; } }; } };
  const context = (body, headers={},method='POST',query='')=>({env:{DB:db},request:new Request('https://test/api/diagnostics'+query,{method,headers:{Origin:'https://test',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})})});
  return {sql, context};
}
const event = (id='event-0001')=>({id,kind:'javascript_error',message:'Test',occurredAt:new Date().toISOString(),path:'/gioca?token=secret',context:{version:'abc',breadcrumbs:[{action:'gdr_publish_started',characters:123}],observedIdentity:{actorId:1}}});
test('salva errore con identità reale ed effettiva distinte, deduplica i retry',async()=>{
  const {sql,context}=setup();
  assert.equal((await routes.post(context(event()))).status,202);
  await routes.post(context(event()));
  const rows=sql.prepare('SELECT * FROM diagnostic_errors').all(); assert.equal(rows.length,1);
  assert.equal(rows[0].actor_user_id,1);assert.equal(rows[0].effective_user_id,2);assert.equal(rows[0].path,'/gioca');
  assert.equal(rows[0].session_id,38);assert.equal(rows[0].source,'browser');
  sql.close();
});
test('consegna dopo cambio identità non attribuisce l’errore al nuovo utente',async()=>{
  const {sql,context}=setup();const e=event();e.context.observedIdentity.actorId=99;
  await routes.post(context(e));assert.equal(sql.prepare('SELECT actor_user_id FROM diagnostic_errors').get().actor_user_id,null);sql.close();
});
test('limita input e origini, consente solo admin alla lettura',async()=>{
  const {sql,context}=setup();
  assert.equal((await routes.post(context(event(),{Origin:'https://evil.test'}))).status,403);
  assert.equal((await routes.post(context({...event(),message:'x'.repeat(25000)}))).status,400);
  assert.equal((await routes.get(context(null,{},'GET'))).status,403);
  assert.equal((await routes.get(context(null,{'x-anonymous':'1'},'GET'))).status,403);
  assert.equal((await routes.get(context(null,{'x-admin':'1'},'GET'))).status,200);
  sql.close();
});
test('rimuove dati sensibili e campi arbitrari dal contesto',()=>{
  const clean=helpers.cleanDiagnosticContext({password:'secret',theme:'red-of-you',breadcrumbs:[{body:'bozza privata',action:'preview'}],resource:'https://site.test/api?token=secret#password'});
  assert.equal(JSON.stringify(clean).includes('secret'),false);assert.equal(JSON.stringify(clean).includes('privata'),false);
  assert.equal(clean.theme,'red-of-you');assert.equal(clean.resource,'https://site.test/api');
});
test('contiene raffiche di errori anche con ID diversi',async()=>{
  const {sql,context}=setup();
  for(let i=0;i<125;i++) await routes.post(context(event('event-'+String(i).padStart(6,'0'))));
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM diagnostic_errors').get().n,120);sql.close();
});
test('paginazione non perde record con la stessa data',async()=>{
  const {sql,context}=setup();
  for(let i=0;i<55;i++) await routes.post(context(event('event-'+String(i).padStart(6,'0'))));
  sql.exec("UPDATE diagnostic_errors SET received_at='2026-11-06T00:00:00.000Z'");
  const first=await (await routes.get(context(null,{'x-admin':'1'},'GET'))).json();assert.equal(first.errors.length,50);
  const second=await (await routes.get(context(null,{'x-admin':'1'},'GET','?before='+encodeURIComponent(first.nextBefore)))).json();assert.equal(second.errors.length,5);sql.close();
});
test('middleware conserva risposta e correla errori server; guasti del logger non bloccano il sito',async()=>{
  const saved=[],tasks=[];
  const middleware=new Function('getAuthenticatedSession','saveDiagnostic','readDiagnosticBody',source('../../_middleware.js')+';return onRequest')(async()=>session,async(...args)=>saved.push(args),helpers.readDiagnosticBody);
  const context={request:new Request('https://test/api/gdr/turns',{method:'POST'}),env:{},waitUntil:p=>tasks.push(p),next:async()=>Response.json({error:'Errore gestito'},{status:500})};
  const response=await middleware(context);await Promise.all(tasks);
  assert.equal(response.status,500);assert.equal((await response.json()).error,'Errore gestito');
  assert.equal(saved.length,1);assert.equal(saved[0][1].requestId,response.headers.get('X-Request-Id'));
  const broken=new Function('getAuthenticatedSession','saveDiagnostic','readDiagnosticBody',source('../../_middleware.js')+';return onRequest')(async()=>session,async()=>{throw new Error('DB offline')},helpers.readDiagnosticBody);
  const original=console.error;console.error=()=>{};
  try {const result=await broken({...context,next:async()=>{throw new Error('Original error')}});await Promise.all(tasks);assert.equal(result.status,500);} finally{console.error=original;}
});
