import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const emailSource = readFileSync('functions/api/_shared/email.js','utf8').replace(/export /g,'');
const {sendEmail,deliverNotificationEmailCopies,notifyOtherIdentity} = new Function(emailSource + ';return {sendEmail,deliverNotificationEmailCopies,notifyOtherIdentity};')();
const queueSource = readFileSync('functions/api/_shared/world-update-emails.js','utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
const deliverWorldUpdateEmails = new Function('sendEmail','deliverNotificationEmailCopies', queueSource + ';return deliverWorldUpdateEmails;')(sendEmail,deliverNotificationEmailCopies);
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,identity TEXT,email TEXT,is_test INTEGER DEFAULT 0,is_activated INTEGER DEFAULT 1,updated_at TEXT,notify_email_updates INTEGER DEFAULT 1,admin_email_updates INTEGER DEFAULT 0,safe_mode INTEGER DEFAULT 0);
 INSERT INTO users(id,identity,email) VALUES(1,'lui','master@example.test'),(2,'lei','player@example.test');`);
 sql.exec(readFileSync('migrations/0132_add_world_updates_and_promos.sql','utf8').split('CREATE TABLE world_promos')[0]);
 sql.exec('ALTER TABLE world_updates ADD COLUMN announce INTEGER DEFAULT 1; ALTER TABLE world_updates ADD COLUMN safe INTEGER DEFAULT 1;');
 const insert=()=>Number(sql.prepare(`INSERT INTO world_updates(kind,title,body,route,published_at,created_by,created_at,updated_at) VALUES('mondo','Titolo <test>','Testo & dettagli','/novita',CURRENT_TIMESTAMP,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run().lastInsertRowid);
 const old=insert();sql.exec(readFileSync('migrations/0156_world_update_email_queue.sql','utf8'));
 sql.exec(readFileSync('migrations/0158_notification_email_copies.sql','utf8'));
 const db={prepare(query){const statement=sql.prepare(query);let args=[];return {bind(...v){args=v;return this},async all(){return {results:statement.all(...args)}},async first(){return statement.get(...args)??null},async run(){return {meta:{changes:Number(statement.run(...args).changes)}}}}}};
 const env={DB:db,RESEND_API_KEY:'fake-key'};return {sql,env,insert,old};
}
test('nuova novità: un solo invio anche con concorrenza e modifiche; nessun recupero dell’archivio',async()=>{
 const h=setup(),original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{calls.push(init);return Response.json({id:'email-1'})};
 try{
  const id=h.insert();await Promise.all([deliverWorldUpdateEmails(h.env),deliverWorldUpdateEmails(h.env)]);
  assert.equal(calls.length,1);assert.equal(calls[0].headers['Idempotency-Key'],`world-update/${id}`);
  assert.match(JSON.parse(calls[0].body).html,/Testo &amp; dettagli/);
  h.sql.prepare("UPDATE world_updates SET body='Correzione' WHERE id=?").run(id);
  await deliverWorldUpdateEmails(h.env);assert.equal(calls.length,1);
  assert.equal(h.sql.prepare('SELECT count(*) AS n FROM world_update_emails WHERE update_id=?').get(h.old).n,0);
 }finally{globalThis.fetch=original;h.sql.close()}
});
test('preferenze, safe mode, bozza, data futura e announce disattivato impediscono invii',async()=>{
 const h=setup(),original=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;return Response.json({})};
 try{
  h.sql.exec('UPDATE users SET notify_email_updates=0 WHERE id=2');h.insert();await deliverWorldUpdateEmails(h.env);assert.equal(count,0);
  h.sql.exec('UPDATE users SET notify_email_updates=1,safe_mode=1 WHERE id=2');const unsafe=h.insert();h.sql.prepare('UPDATE world_updates SET safe=0 WHERE id=?').run(unsafe);await deliverWorldUpdateEmails(h.env);assert.equal(count,0);
  const draft=h.insert(),future=h.insert(),quiet=h.insert();
  h.sql.prepare('UPDATE world_updates SET active=0 WHERE id=?').run(draft);
  h.sql.prepare("UPDATE world_updates SET published_at='2099-01-01' WHERE id=?").run(future);
  h.sql.prepare('UPDATE world_updates SET announce=0 WHERE id=?').run(quiet);
  await deliverWorldUpdateEmails(h.env);assert.equal(count,0);
  h.sql.prepare('UPDATE world_updates SET active=1 WHERE id=?').run(draft);await deliverWorldUpdateEmails(h.env);assert.equal(count,1);
 }finally{globalThis.fetch=original;h.sql.close()}
});
test('l’override admin invia anche senza consenso personale e con Safe attiva, una sola volta',async()=>{
 const h=setup(),original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({id:'forced'})};
 try{
  h.sql.exec('UPDATE users SET notify_email_updates=0,admin_email_updates=1,safe_mode=1 WHERE id=2');
  const id=h.insert();h.sql.prepare('UPDATE world_updates SET safe=0 WHERE id=?').run(id);
  const totals=await Promise.all([deliverWorldUpdateEmails(h.env),deliverWorldUpdateEmails(h.env)]);
  assert.equal(totals.reduce((n,t)=>n+t.sent,0),1);
  assert.equal(calls.length,1);assert.deepEqual(calls[0].to,['player@example.test']);
  assert.equal(h.sql.prepare('SELECT state FROM world_update_emails WHERE update_id=?').get(id).state,'sent');
  await deliverWorldUpdateEmails(h.env);assert.equal(calls.length,1);
  h.sql.exec('UPDATE users SET admin_email_updates=0 WHERE id=2');
  const normal=h.insert();h.sql.prepare('UPDATE world_updates SET safe=0 WHERE id=?').run(normal);
  await deliverWorldUpdateEmails(h.env);assert.equal(calls.length,1);
 }finally{globalThis.fetch=original;h.sql.close()}
});
test('l’override non invia bozze, novità future, voci senza annuncio o email di account test',async()=>{
 const original=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;return Response.json({})};
 try{
  for(const query of [
   'UPDATE world_updates SET active=0',
   "UPDATE world_updates SET published_at='2099-01-01'",
   'UPDATE world_updates SET announce=0',
   'UPDATE users SET is_test=1 WHERE id=1',
   'UPDATE users SET is_test=1 WHERE id=2'
  ]){
   const h=setup();try{
    h.sql.exec('UPDATE users SET notify_email_updates=0,admin_email_updates=1,safe_mode=1 WHERE id=2');
    h.insert();h.sql.exec('UPDATE world_updates SET safe=0');h.sql.exec(query);
    await deliverWorldUpdateEmails(h.env);assert.equal(count,0,query);
   }finally{h.sql.close()}
  }
 }finally{globalThis.fetch=original}
});
test('una novità saltata si recupera solo rimettendola esplicitamente in coda, senza duplicati',async()=>{
 const h=setup(),original=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;return Response.json({id:'recovered'})};
 try{
  h.sql.exec('UPDATE users SET notify_email_updates=1,safe_mode=1 WHERE id=2');
  const id=h.insert();h.sql.prepare('UPDATE world_updates SET safe=0 WHERE id=?').run(id);
  await deliverWorldUpdateEmails(h.env);
  assert.equal(h.sql.prepare('SELECT state FROM world_update_emails WHERE update_id=?').get(id).state,'skipped');
  h.sql.exec('UPDATE users SET admin_email_updates=1 WHERE id=2');
  await deliverWorldUpdateEmails(h.env);assert.equal(count,0);
  h.sql.prepare("UPDATE world_update_emails SET state='pending' WHERE update_id=? AND state='skipped'").run(id);
  await Promise.all([deliverWorldUpdateEmails(h.env),deliverWorldUpdateEmails(h.env)]);assert.equal(count,1);
  assert.equal(h.sql.prepare('SELECT state FROM world_update_emails WHERE update_id=?').get(id).state,'sent');
  await deliverWorldUpdateEmails(h.env);assert.equal(count,1);
 }finally{globalThis.fetch=original;h.sql.close()}
});
test('errore del provider: retry con stesso contenuto e chiave, poi stato definitivo',async()=>{
 const h=setup(),original=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push(init);return calls.length===1?new Response('temporaneo',{status:503}):Response.json({id:'ok'})};
 try{
  const id=h.insert();assert.equal((await deliverWorldUpdateEmails(h.env)).failed,1);
  h.sql.prepare("UPDATE world_updates SET body='Nuovo testo' WHERE id=?").run(id);
  assert.equal((await deliverWorldUpdateEmails(h.env)).sent,1);
  assert.equal(calls[0].body,calls[1].body);assert.deepEqual(calls[0].headers,calls[1].headers);
  await deliverWorldUpdateEmails(h.env);assert.equal(calls.length,2);
 }finally{globalThis.fetch=original;h.sql.close()}
});
test('copie future: stesso contenuto al mittente abilitato, originale e copia inviati una sola volta',async()=>{
 const h=setup(),original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{calls.push(init);return Response.json({id:'ok'})};
 try{
  h.sql.exec('UPDATE users SET notify_email_copies=1,admin_email_updates=1,safe_mode=1 WHERE id=1');
  const id=h.insert();h.sql.prepare('UPDATE world_updates SET safe=0 WHERE id=?').run(id);
  await Promise.all([deliverWorldUpdateEmails(h.env),deliverWorldUpdateEmails(h.env)]);
  assert.equal(calls.length,2);
  const primary=calls.find(c=>c.headers['Idempotency-Key']===`world-update/${id}`);
  const copy=calls.find(c=>c.headers['Idempotency-Key']===`world-update/${id}/copy/1`);
  const sent=JSON.parse(primary.body),copied=JSON.parse(copy.body);
  assert.deepEqual(copied,{...sent,to:['master@example.test']});
  assert.equal(h.sql.prepare('SELECT state FROM notification_email_copies').get().state,'sent');
  h.sql.prepare("UPDATE world_updates SET body='Modifica successiva' WHERE id=?").run(id);
  await deliverWorldUpdateEmails(h.env);assert.equal(calls.length,2);
 }finally{globalThis.fetch=original;h.sql.close()}
});
test('recupero delle due email passate: usa il payload inviato, senza ri-inviare alla destinataria',async()=>{
 const h=setup(),original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{calls.push(init);return Response.json({id:'ok'})};
 try{
  const ids=[h.insert(),h.insert()];await deliverWorldUpdateEmails(h.env);
  assert.equal(calls.length,2);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM notification_email_copies').get().n,0);
  h.sql.exec('UPDATE users SET notify_email_copies=1,admin_email_updates=1 WHERE id=1');
  h.sql.exec("UPDATE world_updates SET body='Non copiare questo testo modificato'");
  const enqueue=h.sql.prepare(`INSERT OR IGNORE INTO notification_email_copies(id,recipient_id,safe,payload)
    SELECT 'world-update/'||q.update_id||'/copy/'||u.id,u.id,w.safe,json_set(q.payload,'$.to',u.email)
    FROM world_update_emails q JOIN world_updates w ON w.id=q.update_id JOIN users u ON u.id=1
    WHERE q.state='sent' AND q.update_id=?`);
  for(const id of ids){enqueue.run(id);enqueue.run(id);}
  await Promise.all([deliverWorldUpdateEmails(h.env),deliverWorldUpdateEmails(h.env)]);
  assert.equal(calls.length,4);
  for(let index=0;index<2;index++){
   assert.deepEqual(JSON.parse(calls[index+2].body),{...JSON.parse(calls[index].body),to:['master@example.test']});
  }
  await deliverWorldUpdateEmails(h.env);assert.equal(calls.length,4);
 }finally{globalThis.fetch=original;h.sql.close()}
});
test('un errore sulla copia non ripete l’originale e il retry mantiene contenuto e chiave',async()=>{
 const h=setup(),original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{calls.push(init);return calls.length===2?new Response('temporaneo',{status:503}):Response.json({id:'ok'})};
 try{
  h.sql.exec('UPDATE users SET notify_email_copies=1 WHERE id=1');h.insert();
  const first=await deliverWorldUpdateEmails(h.env);assert.equal(first.sent,1);assert.equal(first.copies.failed,1);
  h.sql.exec("UPDATE world_updates SET body='Testo nuovo'");
  const second=await deliverWorldUpdateEmails(h.env);assert.equal(second.sent,0);assert.equal(second.copies.sent,1);
  assert.equal(calls.length,3);assert.equal(calls[1].body,calls[2].body);
  assert.deepEqual(calls[1].headers,calls[2].headers);
 }finally{globalThis.fetch=original;h.sql.close()}
});
test('le copie richiedono opt-in, preferenze compatibili e un account reale',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({id:'ok'})};
 try{
  for(const settings of [
   'notify_email_copies=0',
   'notify_email_copies=1,notify_email_updates=0',
   'notify_email_copies=1,safe_mode=1',
   'notify_email_copies=1,is_test=1'
  ]){
   const h=setup();try{
    h.sql.exec(`UPDATE users SET ${settings} WHERE id=1`);
    const id=h.insert();h.sql.prepare('UPDATE world_updates SET safe=0 WHERE id=?').run(id);
    await deliverWorldUpdateEmails(h.env);
    assert.equal(calls.filter(c=>c.to.includes('master@example.test')).length,0,settings);
   }finally{h.sql.close()}
  }
 }finally{globalThis.fetch=original}
});
test('gli avvisi manuali condivisi generano copie; sendEmail da solo non ne genera',async()=>{
 const h=setup(),original=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({id:'ok'})};
 try{
  h.sql.exec('UPDATE users SET notify_email_copies=1 WHERE id=1');
  assert.equal((await notifyOtherIdentity(h.env,1,{subject:'Avviso',html:'<p>Contenuto originale</p>'})).sent,true);
  assert.equal(calls.length,2);assert.deepEqual(calls[1],{...calls[0],to:['master@example.test']});
  await sendEmail(h.env,{to:'player@example.test',subject:'Recupero password',html:'<p>Link personale</p>'});
  assert.equal(calls.length,3);assert.equal(h.sql.prepare('SELECT count(*) n FROM notification_email_copies').get().n,1);
 }finally{globalThis.fetch=original;h.sql.close()}
});
test('le copie incerte oltre 23 ore vanno in revisione, senza nuovi invii',async()=>{
 const h=setup(),original=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push(init);return Response.json({id:'ok'})};
 try{
  h.sql.exec('UPDATE users SET notify_email_copies=1 WHERE id=1');h.insert();await deliverWorldUpdateEmails(h.env);
  h.sql.exec("UPDATE notification_email_copies SET state='pending',first_attempt_at=datetime('now','-24 hours')");
  const result=await deliverNotificationEmailCopies(h.env);
  assert.equal(result.failed,1);assert.equal(calls.length,2);
  assert.equal(h.sql.prepare('SELECT state FROM notification_email_copies').get().state,'review');
 }finally{globalThis.fetch=original;h.sql.close()}
});
test('impostazioni admin: le copie e il forzatore sono indipendenti, con validazione e permessi',async()=>{
 const h=setup(),events=[];let session={user:{id:1,role:'admin'},adminModeEnabled:true};
 const source=readFileSync('functions/api/auth/automatic-emails.js','utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
 const put=new Function('recordEvent','hasPermission','getAuthenticatedSession','json','readJson',source+';return onRequestPut;')(
  async(env,actor,event)=>{events.push(event)},role=>role==='admin',async()=>session,
  (body,status=200)=>Response.json(body,{status}),request=>request.json());
 const call=body=>put({env:h.env,request:new Request('https://test/',{method:'PUT',body:JSON.stringify(body)}),waitUntil(){}});
 try{
  assert.equal((await call({userId:1,enabled:true,setting:'copies'})).status,200);
  const copies=h.sql.prepare('SELECT notify_email_copies,admin_email_updates FROM users WHERE id=1').get();
  assert.equal(copies.notify_email_copies,1);assert.equal(copies.admin_email_updates,0);
  assert.equal(events[0].metadata.setting,'notify_email_copies');
  assert.equal((await call({userId:1,enabled:true})).status,200);
  assert.equal(h.sql.prepare('SELECT admin_email_updates FROM users WHERE id=1').get().admin_email_updates,1);
  assert.equal((await call({userId:1,enabled:true,setting:'unknown'})).status,400);
  assert.equal((await call({userId:1,enabled:'true',setting:'copies'})).status,400);
  h.sql.exec('UPDATE users SET is_test=1 WHERE id=2');
  assert.equal((await call({userId:2,enabled:true,setting:'copies'})).status,404);
  session={user:{id:1,role:'member'},adminModeEnabled:true};
  assert.equal((await call({userId:1,enabled:false,setting:'copies'})).status,403);
  session={user:{id:1,role:'admin'},adminModeEnabled:false};
  assert.equal((await call({userId:1,enabled:false,setting:'copies'})).status,403);
  assert.equal(h.sql.prepare('SELECT notify_email_copies FROM users WHERE id=1').get().notify_email_copies,1);
 }finally{h.sql.close()}
});
