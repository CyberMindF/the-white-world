// Browser locale e database in memoria: nessuna modifica alle partite reali.
import { apiHarness, mutate } from './gdr-workspace-test-harness.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const harness = apiHarness(), adventureId = 'il-prezzo-della-verita';
const master = {id:1, role:'admin', isTest:false};
const fields = [];
const longText='Il testo iniziale dell’avventura.';
harness.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,JSON.stringify(fields));
for (const [id,name,kind] of [['daisy','Daisy','pg']]) {
  await mutate(harness.db,master,{action:'createCharacter',id,adventureId,name,kind,profile:{}});
}
await mutate(harness.db,master,{action:'grant',characterId:'daisy',revision:1,userId:2,canSpeak:true,canEditSheet:true,canInventory:false});
// Impedisce al sync storico di creare un secondo PG di prova.
harness.sqlite.prepare("INSERT INTO gdr_workspace_story_links VALUES(?,'pg','daisy')").run(adventureId);
harness.sqlite.exec("ALTER TABLE gdr_turns ADD COLUMN author_id INTEGER; ALTER TABLE gdr_turns ADD COLUMN adventure TEXT; ALTER TABLE gdr_turns ADD COLUMN created_at TEXT;");
harness.sqlite.prepare('INSERT INTO gdr_turns(id,author_id,adventure,body,created_at) VALUES(?,?,?,?,?)').run(2,2,adventureId,'Risposta originale di Desy.','2026-11-01T22:54:00Z');
harness.sqlite.prepare('INSERT INTO gdr_turns(id,author_id,adventure,body,created_at) VALUES(?,?,?,?,?)').run(3,1,adventureId,'Il master continua la storia.','2026-11-02T12:56:00Z');
const turnSource=(await readFile(resolve('functions/api/gdr/turns.js'),'utf8')).replace(/^import[\s\S]*?;\s*/gm,'').replace(/export /g,'');
const turnApi=new Function('getAuthenticatedSession','json','readJson','recordEvent','notifyRealtime',turnSource+';return {GET:onRequestGet,PUT:onRequestPut,DELETE:onRequestDelete};')(
 async request=>{const id=Number(request.headers.get('x-user'));return {user:{id,nickname:id===1?'Master':'Desy',role:id===1?'admin':'member',isTest:false},sessionId:'test'};},
 (body,status=200)=>Response.json(body,{status}),request=>request.json(),async()=>{},async()=>{},
);
let user = 1;
const root = resolve('web/dist/web/browser');
const server = createServer(async(req,res)=>{
  try {
    const url = new URL(req.url,'http://test'), path = url.pathname;
    if(path==='/api/gdr/turns') {
      let body;if(req.method!=='GET'){body='';for await(const part of req)body+=part;}
      const response=await turnApi[req.method]({env:{DB:harness.db},waitUntil(){},request:new Request('https://test'+req.url,{method:req.method,headers:{'x-user':String(user),'Content-Type':'application/json'},...(body===undefined?{}:{body})})});
      res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());return;
    }
    if(path.startsWith('/api/gdr-workspace')) {
      let payload;
      if(req.method==='POST') { let raw=''; for await(const part of req) raw+=part; payload=JSON.parse(raw); }
      const response=await harness.call(user,req.method,payload,url.searchParams.get('adventure')||adventureId);
      res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());return;
    }
    if(path.startsWith('/api/')) {
      const body = path==='/api/auth/session' ? {authenticated:true,user:{id:user,nickname:user===1?'Master':'Desy',identity:user===1?'lui':'lei',role:user===1?'admin':'member',isTest:false},adminModeEnabled:false}
        : path==='/api/world-settings' ? {settings:{},values:{theme:'red-of-you'}}
        : path==='/api/realtime' ? {enabled:false}
        : path==='/api/gdr/character-schema' ? {fields}
        : path==='/api/gdr/character-fields' ? {values:{}}
        : path==='/api/gdr-blocks' ? {blocks:[{id:'123',documentKey:'avventura',position:0,type:'paragraph',data:{text:longText}}]}
        : path==='/api/gdr/turns' ? {turns:[]} : {};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return;
    }
    let file=join(root,path),data;
    try {data=await readFile(file);}catch{file=join(root,'index.html');data=await readFile(file);}
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp'})[extname(file)]||'application/octet-stream');res.end(data);
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`, screenshots=await mkdtemp(join(tmpdir(),'gdr-turn-editing-'));
const browser=await chromium.launch(), page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
await page.addInitScript(()=>{
  sessionStorage.setItem('noi-crossword-access-session-v1',sessionStorage.getItem('gdr-test-user')||'1');
  sessionStorage.setItem('noi-crossword-access-session-touched-at-v1',String(Date.now()));
});
const switchUser=async id=>{user=id;await page.evaluate(id=>sessionStorage.setItem('gdr-test-user',String(id)),id);await page.reload();};
try {
  await page.goto(`${base}/tavolo-da-gioco/gdr/gioca/${adventureId}`);
  const thread=page.locator('.gdr-thread'),master=thread.locator('article.is-story');
  await master.getByText('Il master continua la storia.',{exact:true}).waitFor();
  assert.equal(await thread.locator('.gdr-turn-divider').count(),2);
  assert.equal(await master.locator('.insertion-point button').count(),2);
  assert.equal(await thread.getByRole('button',{name:'Modifica il tuo turno',exact:true}).count(),0);
  await master.getByRole('button',{name:'Aggiungi alla fine',exact:true}).click();
  await master.getByLabel('Testo del nuovo blocco',{exact:true}).fill('Un nuovo paragrafo nel seguito.');
  await master.getByRole('button',{name:'Aggiungi al racconto',exact:true}).click();
  await master.getByText('Un nuovo paragrafo nel seguito.',{exact:true}).waitFor();
  assert.equal(harness.sqlite.prepare('SELECT body FROM gdr_turns WHERE id=3').get().body,'Il master continua la storia.\n\nUn nuovo paragrafo nel seguito.');
  const original=harness.sqlite.prepare('SELECT * FROM gdr_turns WHERE id=2').get();
  await switchUser(2);
  const mine=thread.locator('article.is-mine');
  await mine.getByRole('button',{name:'Modifica il tuo turno',exact:true}).click();
  const editing=mine.locator('.published-turn-editor');
  assert.equal(await editing.getByRole('button',{name:'Titolo',exact:true}).count(),0);
  assert.equal(await thread.locator('article.is-story .insertion-point').count(),0);
  await editing.getByLabel('Modifica il tuo turno',{exact:true}).fill('La risposta corretta di Desy.');
  await editing.getByRole('button',{name:'Anteprima',exact:true}).click();
  await editing.getByRole('button',{name:'Salva modifiche',exact:true}).click();
  await mine.getByRole('button',{name:'Modifica il tuo turno',exact:true}).waitFor();
  await mine.getByText('La risposta corretta di Desy.',{exact:true}).waitFor();
  const changed=harness.sqlite.prepare('SELECT * FROM gdr_turns WHERE id=2').get();assert.equal(changed.created_at,original.created_at);assert.equal(changed.author_id,original.author_id);
  await mine.getByRole('button',{name:'Modifica il tuo turno',exact:true}).click();
  await editing.getByLabel('Modifica il tuo turno',{exact:true}).fill('Questa modifica va annullata.');
  await editing.getByRole('button',{name:'Annulla',exact:true}).click();
  await mine.getByText('La risposta corretta di Desy.',{exact:true}).waitFor();
  await switchUser(1);
  await thread.getByText('La risposta corretta di Desy.',{exact:true}).waitFor();
  await master.getByText('Un nuovo paragrafo nel seguito.',{exact:true}).waitFor();
  assert.equal(await thread.locator('article').count(),2);assert.equal(await thread.locator('.gdr-turn-divider').count(),2);
  for(const width of [1280,390,320]) {
    await page.setViewportSize({width,height:900});await page.mouse.move(width-5,5);await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await thread.screenshot({path:join(screenshots,`turni-master-${width}.png`),animations:'disabled'});
  }
  assert.deepEqual(errors,[]);console.log('PASS: modifica player autenticata, anteprima e annullamento, salvataggio visibile al master, + nel seguito, separatori e 3 viewport. Screenshot:',screenshots);
}catch(error){await page.screenshot({path:join(screenshots,'errore.png')});console.error('Screenshot:',screenshots);console.error('Browser errors:',errors);throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));harness.sqlite.close();}
