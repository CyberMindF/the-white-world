import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const emailSource = readFileSync('functions/api/_shared/email.js','utf8').replace(/export /g,'');
const {sendEmail,getEmailBcc} = new Function(emailSource + ';return {sendEmail,getEmailBcc};')();
const queueSource = readFileSync('functions/api/_shared/world-update-emails.js','utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
const deliverWorldUpdateEmails = new Function('sendEmail','getEmailBcc', queueSource + ';return deliverWorldUpdateEmails;')(sendEmail,getEmailBcc);
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,identity TEXT,email TEXT,is_test INTEGER DEFAULT 0,notify_email_updates INTEGER DEFAULT 1,admin_email_updates INTEGER DEFAULT 0,safe_mode INTEGER DEFAULT 0,role TEXT DEFAULT 'member',is_activated INTEGER DEFAULT 1);
 INSERT INTO users(id,identity,email) VALUES(1,'lui','master@example.test'),(2,'lei','player@example.test');
 UPDATE users SET role='admin' WHERE id=1;`);
 sql.exec(readFileSync('migrations/0132_add_world_updates_and_promos.sql','utf8').split('CREATE TABLE world_promos')[0]);
 sql.exec('ALTER TABLE world_updates ADD COLUMN announce INTEGER DEFAULT 1; ALTER TABLE world_updates ADD COLUMN safe INTEGER DEFAULT 1;');
 const insert=()=>Number(sql.prepare(`INSERT INTO world_updates(kind,title,body,route,published_at,created_by,created_at,updated_at) VALUES('mondo','Titolo <test>','Testo & dettagli','/novita',CURRENT_TIMESTAMP,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run().lastInsertRowid);
 const old=insert();sql.exec(readFileSync('migrations/0156_world_update_email_queue.sql','utf8'));
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
  assert.deepEqual(JSON.parse(calls[0].body).bcc,['master@example.test']);
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
  h.sql.exec("UPDATE users SET email='new-master@example.test' WHERE id=1");
  assert.equal((await deliverWorldUpdateEmails(h.env)).sent,1);
  assert.equal(calls[0].body,calls[1].body);assert.deepEqual(calls[0].headers,calls[1].headers);
  await deliverWorldUpdateEmails(h.env);assert.equal(calls.length,2);
 }finally{globalThis.fetch=original;h.sql.close()}
});

test('CCN globale: copre anche recupero password e avvisi generici senza cambiare destinatario o contenuto',async()=>{
 const h=setup(),original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({id:'ok'})};
 try{
  for(const subject of ['Nuova attività','Avviso scambio carte','Reimposta la password del Mondo Bianco']){
   const message={to:'player@example.test',subject,html:'<p>Testo originale e link personale</p>',text:'Testo originale e link personale'};
   assert.equal((await sendEmail(h.env,message)).sent,true);
   const sent=calls.at(-1);
   assert.deepEqual(sent.to,['player@example.test']);assert.deepEqual(sent.bcc,['master@example.test']);
   assert.equal(sent.cc,undefined);assert.equal(sent.subject,message.subject);assert.equal(sent.text,message.text);
   assert.match(sent.html,/Testo originale e link personale/);
  }
  assert.equal(calls.length,3);
 }finally{globalThis.fetch=original;h.sql.close()}
});

test('nessuna CCN duplicata se Rory è già destinatario, nemmeno con maiuscole diverse',async()=>{
 const h=setup(),original=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({id:'ok'})};
 try{
  for(const to of ['master@example.test','MASTER@example.test']){
   assert.equal((await sendEmail(h.env,{to,subject:'Avviso',html:'<p>Testo</p>'})).sent,true);
   assert.equal(calls.at(-1).bcc,undefined);
   assert.deepEqual(calls.at(-1).to,[to]);
  }
 }finally{globalThis.fetch=original;h.sql.close()}
});

test('la CCN è legata all’account di Rory e non passa ad altri admin o account test',async()=>{
 const h=setup(),original=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({id:'ok'})};
 try{
  h.sql.exec("UPDATE users SET role='admin' WHERE id=2");
  for(const setting of ["is_test=1","is_activated=0","role='member'"]){
   h.sql.exec("UPDATE users SET is_test=0,is_activated=1,role='admin' WHERE id=1");
   h.sql.exec(`UPDATE users SET ${setting} WHERE id=1`);
   assert.equal((await sendEmail(h.env,{to:'another@example.test',subject:'Avviso',html:'<p>Testo</p>'})).sent,true);
   assert.equal(calls.at(-1).bcc,undefined);
  }
 }finally{globalThis.fetch=original;h.sql.close()}
});

test('un retry iniziato senza CCN conserva i destinatari originali e non genera un secondo invio',async()=>{
 const h=setup(),original=globalThis.fetch,calls=[];globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({id:'ok'})};
 try{
  const id=h.insert();
  h.sql.prepare(`UPDATE world_update_emails SET payload=?,first_attempt_at=? WHERE update_id=?`)
   .run(JSON.stringify({to:'player@example.test',subject:'Originale',html:'<p>Originale</p>',text:'Originale'}),new Date().toISOString(),id);
  await deliverWorldUpdateEmails(h.env);await deliverWorldUpdateEmails(h.env);
  assert.equal(calls.length,1);assert.equal(calls[0].bcc,undefined);
  assert.deepEqual(calls[0].to,['player@example.test']);
 }finally{globalThis.fetch=original;h.sql.close()}
});
