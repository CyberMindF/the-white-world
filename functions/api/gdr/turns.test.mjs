import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,nickname TEXT,role TEXT,is_test INTEGER);
    INSERT INTO users VALUES(1,'Rory','admin',0),(2,'Desy','member',0),(3,'Test','admin',1);
    CREATE TABLE gdr_turns(id INTEGER PRIMARY KEY,author_id INTEGER,adventure TEXT,body TEXT,created_at TEXT);`);
  const db={prepare(sql){return{bind(...args){return{
    async all(){return {results:sqlite.prepare(sql).all(...args)};},
    async first(){return sqlite.prepare(sql).get(...args)??null;},
    async run(){const result=sqlite.prepare(sql).run(...args);return {meta:{last_row_id:Number(result.lastInsertRowid),changes:Number(result.changes)}};},
  };}};}};
  const session=async request=>{
    const row=sqlite.prepare('SELECT * FROM users WHERE id=?').get(Number(request.headers.get('x-user')));
    return row?{user:{...row,isTest:!!row.is_test},sessionId:'test'}:null;
  };
  const source=readFileSync(new URL('./turns.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\s*/gm,'').replace(/export /g,'');
  const api=new Function('getAuthenticatedSession','json','readJson','recordEvent','notifyRealtime',source+';return {onRequestGet,onRequestPost,onRequestPut,onRequestDelete};')(
    session,(body,status=200)=>Response.json(body,{status}),request=>request.json(),async()=>{},async()=>{},
  );
  const call=async(user,body)=>{
    const form=new FormData();if(body!==undefined){form.set('body',body);form.set('isMaster','true');}
    return (body===undefined?api.onRequestGet:api.onRequestPost)({env:{DB:db},waitUntil(){},request:new Request('https://test/api/gdr/turns',{method:body===undefined?'GET':'POST',headers:{'x-user':String(user)},...(body===undefined?{}:{body:form})})});
  };
  const change=(user,method,payload)=>(method==='DELETE'?api.onRequestDelete:api.onRequestPut)({env:{DB:db},waitUntil(){},request:new Request('https://test/api/gdr/turns',{method,headers:{'x-user':String(user),'Content-Type':'application/json'},body:JSON.stringify(payload)})});
  return {sqlite,call,change};
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
