import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

function fixture({ announce } = {}) {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,nickname TEXT,role TEXT,is_test INTEGER);
    INSERT INTO users VALUES(1,'Rory','admin',0),(2,'Desy','member',0),(3,'Test','admin',1),(4,'Altra giocatrice','member',0);
    CREATE TABLE gdr_turns(id INTEGER PRIMARY KEY,author_id INTEGER,adventure TEXT,body TEXT,created_at TEXT);
    CREATE TABLE gdr_workspace_adventures(id TEXT PRIMARY KEY,title TEXT,published INTEGER);
    INSERT INTO gdr_workspace_adventures VALUES('il-prezzo-della-verita','Il Prezzo della Verità',1),('bozza','Avventura non pubblicata',0);`);
  const db={prepare(sql){let args=[];return{
    bind(...values){args=values;return this;},
    async all(){return {results:sqlite.prepare(sql).all(...args)};},
    async first(){return sqlite.prepare(sql).get(...args)??null;},
    async run(){const result=sqlite.prepare(sql).run(...args);return {meta:{last_row_id:Number(result.lastInsertRowid),changes:Number(result.changes)}};},
  };}};
  const session=async request=>{
    const row=sqlite.prepare('SELECT * FROM users WHERE id=?').get(Number(request.headers.get('x-user')));
    return row?{user:{...row,isTest:!!row.is_test},sessionId:'test',...(request.headers.has('x-impersonation')?{impersonation:{readOnly:false}}:{})}:null;
  };
  const source=readFileSync(new URL('./turns.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\s*/gm,'').replace(/export /g,'');
  const announcements=[];
  const api=new Function('getAuthenticatedSession','json','readJson','recordEvent','notifyRealtime','addWorldUpdate',source+';return {onRequestGet,onRequestPost,onRequestPut,onRequestDelete};')(
    session,(body,status=200)=>Response.json(body,{status}),request=>request.json(),async()=>{},async()=>{},
    announce ?? (async(env,update)=>{announcements.push(update);return {created:true}}),
  );
  const call=async(user,body,adventure='il-prezzo-della-verita',extra={})=>{
    const form=new FormData();if(body!==undefined){form.set('body',body);form.set('isMaster','true');}
    form.set('adventure',adventure);
    const pending=[];
    const response=await (body===undefined?api.onRequestGet:api.onRequestPost)({env:{DB:db},waitUntil(promise){pending.push(promise)},request:new Request('https://test/api/gdr/turns',{method:body===undefined?'GET':'POST',headers:{'x-user':String(user),...extra},...(body===undefined?{}:{body:form})})});
    await Promise.all(pending);
    return response;
  };
  const change=(user,method,payload,extra={})=>(method==='DELETE'?api.onRequestDelete:api.onRequestPut)({env:{DB:db},waitUntil(){},request:new Request('https://test/api/gdr/turns',{method,headers:{'x-user':String(user),'Content-Type':'application/json',...extra},body:JSON.stringify(payload)})});
  return {sqlite,call,change,announcements};
}

test('il racconto del master è riconosciuto allo stesso modo da entrambi, mantenendo testo e ordine',async()=>{
  const h=fixture(), body='## La biblioteca\n\nLa porta si apre.\n\n::: dialogo Shivay\nEntriamo?\n:::';
  const saved=await (await h.call(1,body)).json();assert.equal(saved.isMaster,true);
  const playerSaved=await (await h.call(2,'Mi avvicino alla porta.')).json();assert.equal(playerSaved.isMaster,false);
  const master=(await (await h.call(1)).json()).turns, player=(await (await h.call(2)).json()).turns;
  assert.deepEqual(master.map(t=>t.isMaster),[true,false]);assert.deepEqual(player.map(t=>t.isMaster),[true,false]);
  assert.equal(master[0].body.replace(/\r\n/g,'\n'),body);assert.equal(master[0].isMine,true);assert.equal(player[0].isMine,false);
  assert.equal(master[0].id,player[0].id);h.sqlite.close();
});
test('solo il master può rimuovere un paragrafo dal proprio racconto; il risultato è condiviso',async()=>{
 const h=fixture();const saved=await (await h.call(1,'Primo paragrafo.\n\nSecondo paragrafo.')).json();
 const before=(await (await h.call(1)).json()).turns[0];
 const payload={id:saved.turnId,adventure:'il-prezzo-della-verita',expectedBody:before.body,body:'Secondo paragrafo.'};
 assert.equal((await h.change(2,'PUT',payload)).status,403);assert.equal((await h.change(3,'DELETE',payload)).status,403);
 assert.equal((await h.change(1,'PUT',payload)).status,200);
 assert.equal((await (await h.call(2)).json()).turns[0].body,'Secondo paragrafo.');
 assert.equal((await h.change(1,'DELETE',payload)).status,409);
 assert.equal((await h.change(1,'DELETE',{...payload,expectedBody:'Secondo paragrafo.'})).status,200);
 assert.deepEqual((await (await h.call(2)).json()).turns,[]);h.sqlite.close();
});
test('il master non riscrive gli interventi della giocatrice e una richiesta obsoleta non cancella testo nuovo',async()=>{
 const h=fixture();const saved=await (await h.call(2,'Risposta di Desy')).json();
 assert.equal((await h.change(1,'DELETE',{id:saved.turnId,expectedBody:'Risposta di Desy'})).status,403);
 assert.equal((await h.change(0,'DELETE',{id:saved.turnId,expectedBody:'Risposta di Desy'})).status,401);
 assert.equal((await h.change(1,'DELETE',{id:999,expectedBody:''})).status,404);
 assert.equal((await (await h.call(2)).json()).turns[0].body,'Risposta di Desy');h.sqlite.close();
});
test('l’etichetta master dipende dall’autore autenticato, anche per i turni esistenti',async()=>{
  const h=fixture();assert.equal((await h.call(0)).status,401);
  h.sqlite.prepare('INSERT INTO gdr_turns(author_id,adventure,body,created_at) VALUES(?,?,?,?)').run(1,'il-prezzo-della-verita','Vecchio seguito della storia','2026-10-31T12:00:00Z');
  assert.equal((await (await h.call(2)).json()).turns[0].isMaster,true);
  assert.equal((await (await h.call(3,'Prova')).json()).isMaster,false);h.sqlite.close();
});

test('Desy modifica soltanto il proprio turno; autore, data e ordine restano invariati e la modifica è condivisa',async()=>{
 const h=fixture();const first=await (await h.call(2,'Prima risposta.')).json();await h.call(1,'Il master continua.');
 const before=h.sqlite.prepare('SELECT * FROM gdr_turns WHERE id=?').get(first.turnId);
 const payload={id:first.turnId,adventure:'il-prezzo-della-verita',expectedBody:before.body,body:'Risposta corretta.\n\n::: azione\nAccarezzo Sally.\n:::'};
 assert.equal((await h.change(4,'PUT',payload)).status,403);
 assert.equal((await h.change(1,'PUT',payload)).status,403);
 assert.equal((await h.change(2,'PUT',payload,{'x-impersonation':'1'})).status,200);
 assert.equal((await h.change(2,'DELETE',{...payload,expectedBody:payload.body},{'x-impersonation':'1'})).status,403);
 const after=h.sqlite.prepare('SELECT * FROM gdr_turns WHERE id=?').get(first.turnId);
 assert.equal(after.author_id,before.author_id);assert.equal(after.created_at,before.created_at);
 for(const user of [1,2]){
  const turns=(await (await h.call(user)).json()).turns;assert.deepEqual(turns.map(t=>t.id),[first.turnId,first.turnId+1]);assert.equal(turns[0].body,payload.body);assert.equal(turns[0].isMaster,false);
 }
 assert.equal((await h.change(2,'PUT',{...payload,body:'Vecchia scheda'})).status,409);
 assert.equal((await h.change(2,'DELETE',{...payload,expectedBody:after.body})).status,403);
 assert.equal(h.sqlite.prepare('SELECT body FROM gdr_turns WHERE id=?').get(first.turnId).body,payload.body);
 h.sqlite.close();
});
test('modifica player: testo vuoto o troppo lungo, avventura errata, account test e turni altrui non vengono salvati',async()=>{
 const h=fixture();const mine=await (await h.call(2,'Risposta originale.')).json(), master=await (await h.call(1,'Storia originale.')).json();
 const payload={id:mine.turnId,expectedBody:'Risposta originale.',body:'Nuovo testo'};
 for(const body of ['', '   ', 'x'.repeat(20001)]) assert.equal((await h.change(2,'PUT',{...payload,body})).status,400);
 assert.equal((await h.change(2,'PUT',{...payload,adventure:'altra-avventura'})).status,404);
 assert.equal((await h.change(3,'PUT',payload)).status,403);
 assert.equal((await h.change(2,'PUT',{id:master.turnId,expectedBody:'Storia originale.',body:'No'})).status,403);
 assert.equal(h.sqlite.prepare('SELECT body FROM gdr_turns WHERE id=?').get(mine.turnId).body,'Risposta originale.');h.sqlite.close();
});

test('un nuovo seguito del master crea una sola Novità con il link alla partita e senza anticipare il racconto',async()=>{
 const h=fixture();try{
  const saved=await (await h.call(1,'Il contenuto segreto del seguito.')).json();
  assert.equal(h.announcements.length,1);
  const update=h.announcements[0];
  assert.equal(update.title,'L’avventura continua: Il Prezzo della Verità');
  assert.equal(update.route,'/tavolo-da-gioco/gdr/gioca/il-prezzo-della-verita');
  assert.equal(update.createdBy,1);assert.equal(update.publishedAt,saved.createdAt);
  assert.equal(update.ctaLabel,'Leggi il seguito');
  assert.ok(!JSON.stringify(update).includes('Il contenuto segreto'));
  await h.call(2);
  assert.equal((await h.change(1,'PUT',{id:saved.turnId,expectedBody:'Il contenuto segreto del seguito.',body:'Correzione.'})).status,200);
  assert.equal((await h.change(1,'DELETE',{id:saved.turnId,expectedBody:'Correzione.'})).status,200);
  assert.equal(h.announcements.length,1);
 }finally{h.sqlite.close()}
});

test('risposte della giocatrice, account test, impersonazione e avventure non pubblicate non creano Novità',async()=>{
 const h=fixture();try{
  await h.call(2,'La mia risposta.');
  await h.call(3,'Turno di prova.');
  await h.call(1,'Preparazione privata.','bozza');
  await h.call(1,'Avventura inesistente.','inesistente');
  await h.call(1,'Intervento impersonato.','il-prezzo-della-verita',{'x-impersonation':'1'});
  assert.equal((await h.call(1,'   ')).status,400);
  assert.equal((await h.call(0,'Non autenticato.')).status,401);
  assert.equal(h.announcements.length,0);
 }finally{h.sqlite.close()}
});

test('il titolo della Novità viene letto anche per le nuove avventure pubblicate',async()=>{
 const h=fixture();try{
  h.sqlite.prepare('INSERT INTO gdr_workspace_adventures VALUES(?,?,1)').run('nuova-avventura','Una nuova avventura');
  assert.equal((await h.call(1,'Un altro seguito.','nuova-avventura')).status,201);
  assert.equal(h.announcements[0].title,'L’avventura continua: Una nuova avventura');
  assert.equal(h.announcements[0].route,'/tavolo-da-gioco/gdr/gioca/nuova-avventura');
 }finally{h.sqlite.close()}
});

test('un problema alle Novità non impedisce di salvare il seguito',async()=>{
 const h=fixture({announce:async()=>{throw new Error('Novità non disponibili')}});try{
  const response=await h.call(1,'Il seguito resta salvato.');
  assert.equal(response.status,201);
  assert.equal(h.sqlite.prepare('SELECT body FROM gdr_turns').get().body,'Il seguito resta salvato.');
 }finally{h.sqlite.close()}
});

test('pubblicazione completa: il seguito crea la Novità e invia una sola email con il forzatore Safe',async()=>{
 const source=path=>readFileSync(path,'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
 const sendEmail=new Function(source('functions/api/_shared/email.js')+';return sendEmail;')();
 const deliver=new Function('sendEmail',source('functions/api/_shared/world-update-emails.js')+';return deliverWorldUpdateEmails;')(sendEmail);
 const add=new Function('deliverWorldUpdateEmails',source('functions/api/_shared/world-updates.js')+';return addWorldUpdate;')(deliver);
 const h=fixture({announce:(env,update)=>add({...env,RESEND_API_KEY:'fake-key'},update)}),original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({id:'email-gdr'})};
 try{
  h.sqlite.exec(`ALTER TABLE users ADD COLUMN email TEXT;
    ALTER TABLE users ADD COLUMN identity TEXT;
    ALTER TABLE users ADD COLUMN notify_email_updates INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN admin_email_updates INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN safe_mode INTEGER DEFAULT 0;
    UPDATE users SET email='master@example.test',identity='lui' WHERE id=1;
    UPDATE users SET email='player@example.test',identity='lei',admin_email_updates=1,safe_mode=1 WHERE id=2;`);
  h.sqlite.exec(readFileSync('migrations/0132_add_world_updates_and_promos.sql','utf8').split('CREATE TABLE world_promos')[0]);
  h.sqlite.exec('ALTER TABLE world_updates ADD COLUMN announce INTEGER DEFAULT 1; ALTER TABLE world_updates ADD COLUMN safe INTEGER DEFAULT 0;');
  h.sqlite.exec(readFileSync('migrations/0156_world_update_email_queue.sql','utf8'));
  assert.equal((await h.call(1,'Il seguito completo rimane nel GDR.')).status,201);
  const update=h.sqlite.prepare('SELECT * FROM world_updates').get();
  assert.equal(update.kind,'contenuto');assert.equal(update.active,1);assert.equal(update.announce,1);
  assert.equal(h.sqlite.prepare('SELECT state FROM world_update_emails WHERE update_id=?').get(update.id).state,'sent');
  assert.equal(h.sqlite.prepare('SELECT user_id FROM world_update_reads WHERE update_id=?').get(update.id).user_id,1);
  assert.equal(calls.length,1);assert.deepEqual(calls[0].to,['player@example.test']);
  assert.match(calls[0].subject,/L’avventura continua: Il Prezzo della Verità/);
  assert.ok(calls[0].text.includes('https://il-mondo-bianco.com/tavolo-da-gioco/gdr/gioca/il-prezzo-della-verita'));
  assert.ok(!calls[0].html.includes('Il seguito completo rimane nel GDR.'));
 }finally{globalThis.fetch=original;h.sqlite.close()}
});
