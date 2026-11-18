// Browser locale, API e database in memoria: nessuna scrittura sul sito reale.
import { apiHarness, mutate } from './gdr-workspace-test-harness.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { join, extname, resolve } from 'node:path';
import assert from 'node:assert/strict';
const read = promisify(readFile), root = resolve('web/dist/web/browser');
const h = apiHarness(), adventure = 'il-prezzo-della-verita';
for (const [id, name, kind] of [['daisy','Daisy','pg'],['sally','Sally','png']])
  await mutate(h.db,{id:1,role:'admin',isTest:false},{action:'createCharacter',id,adventureId:adventure,name,kind});
h.sqlite.prepare("INSERT INTO gdr_workspace_story_links VALUES(?,'pg','daisy')").run(adventure);
const powers = [
  {id:'spell',name:'Scudo magico',kind:'spell',description:'Protegge dai colpi.',adventureIds:[adventure]},
  {id:'ability',name:'Famiglio',kind:'ability',description:'Un compagno fedele.',adventureIds:[adventure]},
  {id:'other',name:'Solo altra avventura',kind:'spell',description:'Riservata.',adventureIds:['la-casa-che-trattiene-il-respiro']},
].map(p=>({...p,effects:[],revision:1}));
for (const p of powers) {
  h.sqlite.prepare('INSERT INTO gdr_powers(id,kind,name,description,created_by) VALUES(?,?,?,?,1)').run(p.id,p.kind,p.name,p.description);
  for (const id of p.adventureIds) h.sqlite.prepare('INSERT INTO gdr_power_adventures VALUES(?,?)').run(p.id,id);
}
class WorkspaceError extends Error { constructor(message,status){super(message);this.status=status;} }
const source=readFileSync('functions/api/gdr-powers/assignments.js','utf8').replace(/^import[\s\S]*?;\s*/gm,'').replace(/export /g,'');
const assign = new Function('json','readJson','masterSession','validId','WorkspaceError','failure','recordEvent','notifyRealtime',source+';return onRequestPut;')(
  (body,status=200)=>Response.json(body,{status}), request=>request.json(), async()=>({user:{id:1},sessionId:'local'}),
  value=>typeof value==='string' && /^[a-z0-9-]+$/.test(value), WorkspaceError,
  error=>Response.json({error:error.message},{status:error.status||500}), async()=>{},async()=>{},
);
let conflict=false;
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://test'), path=url.pathname;
    let payload;
    if (!['GET','HEAD'].includes(req.method)) {let raw='';for await(const chunk of req)raw+=chunk;payload=raw?JSON.parse(raw):{};}
    const send=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    if(path==='/api/gdr-workspace' || path==='/api/gdr-workspace/mutate') {
      const response=await h.call(1,req.method,payload,url.searchParams.get('adventure')||adventure);
      res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());return;
    }
    if(path==='/api/gdr-powers/assignments') {
      if(conflict){conflict=false;send({error:'Il personaggio è cambiato.'},409);return;}
      const response=await assign({request:new Request('https://test/api/gdr-powers/assignments',{method:'PUT',body:JSON.stringify(payload)}),env:{DB:h.db},waitUntil(){}});
      res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());return;
    }
    if(path==='/api/gdr-systems') {send({systems:h.sqlite.prepare('SELECT id,name,revision FROM gdr_systems').all(),rules:[],powers:[],adventures:[]});return;}
    if(path==='/api/gdr-powers') {
      send({powers:powers.map(p=>({...p,characterIds:h.sqlite.prepare('SELECT character_id FROM gdr_character_powers WHERE power_id=?').all(p.id).map(x=>x.character_id)})),adventures:h.sqlite.prepare('SELECT id,title FROM gdr_workspace_adventures').all(),characters:[]});return;
    }
    if(path==='/api/gdr-rules' && req.method==='PUT') {
      h.sqlite.prepare('UPDATE gdr_workspace_adventures SET rules_json=?,rules_revision=rules_revision+1 WHERE id=?').run(JSON.stringify(payload.blocks),payload.adventureId);
      send({blocks:payload.blocks,revision:payload.revision+1});return;
    }
    if(path.startsWith('/api/')) {
      send(path==='/api/auth/session' ? {authenticated:true,adminModeEnabled:true,user:{id:1,nickname:'Master',identity:'lui',role:'admin',isTest:false,safeMode:false}}
        : path==='/api/realtime' ? {enabled:false}
        : path==='/api/world-settings' ? {settings:{},values:{theme:'white-world'}}
        : path==='/api/gdr-blocks' ? {blocks:[]}
        : path==='/api/gdr/character-schema' ? {fields:[]}
        : path==='/api/gdr/character-fields' ? {values:{}}
        : path==='/api/gdr/turns' ? {turns:[]}
        : path==='/api/world-updates' ? {updates:[]}
        : path==='/api/ponti-chat' ? {messages:[],unreadCount:0} : {});return;
    }
    let file=join(root,path),data;
    try {data=await read(file);}catch{file=join(root,'index.html');data=await read(file);}
    res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(data);
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
try {
  for(const width of [1280,390,320]) {
    h.sqlite.exec('DELETE FROM gdr_character_powers');
    const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
    await page.addInitScript(()=>{sessionStorage.setItem('noi-crossword-access-session-v1','1');sessionStorage.setItem('noi-crossword-access-session-touched-at-v1',String(Date.now()));});
    await page.goto(base+'/tavolo-da-gioco/gdr');
    await page.getByRole('link',{name:'Gestione GDR',exact:true}).click();
    await page.getByRole('heading',{name:'Gestione GDR'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Nuova avventura',exact:true}).count(),1);
    await page.locator('.tavolo-game-card').filter({hasText:'Il Prezzo della Verità'}).click();
    const editor=page.locator('app-gdr-character-powers-editor'),nav=page.getByRole('navigation',{name:'Gestione dell’avventura'});
    await editor.getByRole('button',{name:'Scegli abilità e magie'}).click();
    await editor.getByLabel('Scudo magico').check();await editor.getByLabel('Famiglio').check();
    assert.equal(await editor.getByText('Solo altra avventura',{exact:true}).count(),0);
    assert.equal(await nav.getByRole('button',{name:'Sistema e regole',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Modifica scheda',exact:true}).isDisabled(),true);
    await editor.getByRole('button',{name:'Salva abilità e magie'}).click();
    await page.getByRole('status').filter({hasText:'Abilità e magie salvate.'}).first().waitFor();
    assert.equal(h.sqlite.prepare("SELECT count(*) n FROM gdr_character_powers WHERE character_id='daisy'").get().n,2);
    await page.locator('.roster-entry').filter({hasText:'Sally'}).click();
    await editor.getByRole('button',{name:'Scegli abilità e magie'}).click();
    await editor.getByLabel('Scudo magico').check();
    conflict=true;
    await editor.getByRole('button',{name:'Salva abilità e magie'}).click();
    await editor.getByRole('alert').filter({hasText:'Il personaggio è cambiato.'}).waitFor();
    assert.equal(await editor.getByLabel('Scudo magico').isChecked(),true);
    await editor.getByRole('button',{name:'Salva abilità e magie'}).click();
    await page.getByRole('status').filter({hasText:'Abilità e magie salvate.'}).first().waitFor();
    assert.equal(h.sqlite.prepare("SELECT count(*) n FROM gdr_character_powers WHERE character_id='sally'").get().n,1);
    await page.screenshot({path:`/tmp/gdr-management-${width}.png`,fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await nav.getByRole('button',{name:'Sistema e regole',exact:true}).click();
    await page.getByRole('button',{name:'Modifica regole',exact:true}).click();
    await page.getByLabel('Testo delle regole').fill('## Regole condivise\n\nUna regola aggiornata.');
    await page.getByRole('button',{name:'Salva regole',exact:true}).click();
    await page.getByRole('button',{name:'Modifica regole',exact:true}).waitFor();
    await nav.getByRole('link',{name:'Apri partita',exact:true}).click();
    await page.locator('#adventure-title').waitFor();
    assert.equal(await page.locator('app-gdr-character-powers-editor').count(),0);
    await page.getByRole('link',{name:'Gestisci avventura',exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    if (width === 1280) {
      await page.goto(base+'/tavolo-da-gioco/gdr/gestione');
      await page.getByRole('button',{name:'Nuova avventura',exact:true}).click();
      await page.getByLabel('Titolo della nuova avventura',{exact:true}).fill('Nuova storia di prova');
      await page.getByRole('combobox',{name:'Sistema di gioco',exact:true}).selectOption(adventure);
      await page.getByRole('button',{name:'Crea e inizia a scrivere',exact:true}).click();
      await page.getByRole('heading',{name:'Nuova storia di prova',exact:true}).waitFor();
      const adventureNav=page.getByRole('navigation',{name:'Gestione dell’avventura'});
      assert.equal(await adventureNav.getByRole('button',{name:'Avventura',exact:true}).getAttribute('aria-pressed'),'true');
      await page.getByRole('button',{name:'Modifica testo completo',exact:true}).click();
      await page.locator('#lab-document').fill('Una nuova avventura.');
      await page.getByRole('button',{name:'Salva avventura',exact:true}).click();
      await page.getByText('Avventura salvata nel laboratorio.',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Rendi visibile ai giocatori',exact:true}).click();
      await page.getByRole('button',{name:'Torna a bozza riservata',exact:true}).waitFor();
      assert.deepEqual(errors,[]);
    }
    await context.close();
  }
  console.log('PASS: gestione unica, assegnazioni PG/PNG, conflitto con scelta conservata, blocco navigazione, regole condivise e partita separata a 1280/390/320 px.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));h.sqlite.close();}
