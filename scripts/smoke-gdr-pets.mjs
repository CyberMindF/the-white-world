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
const fields = [{key:'catName',label:'Nome del gatto',type:'text',default:''}];
harness.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,JSON.stringify(fields));
for (const [id,name,kind] of [['daisy','Daisy','pg'],['sally','Sally','png']]) {
  await mutate(harness.db,master,{action:'createCharacter',id,adventureId,name,kind,profile:{appearance:kind==='png'?'Una gatta curiosa.':''}});
}
await mutate(harness.db,master,{action:'grant',characterId:'daisy',revision:1,userId:2,canSpeak:true,canEditSheet:true,canInventory:false});
// Impedisce al sync storico di creare un secondo PG di prova.
harness.sqlite.prepare("INSERT INTO gdr_workspace_story_links VALUES(?,'pg','daisy')").run(adventureId);
let user = 1;
const root = resolve('web/dist/web/browser');
const server = createServer(async(req,res)=>{
  try {
    const url = new URL(req.url,'http://test'), path = url.pathname;
    if(path.startsWith('/api/gdr-workspace')) {
      let payload;
      if(req.method==='POST') { let raw=''; for await(const part of req) raw+=part; payload=JSON.parse(raw); }
      const response=await harness.call(user,req.method,payload,url.searchParams.get('adventure')||adventureId);
      res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());return;
    }
    if(path.startsWith('/api/')) {
      const body = path==='/api/auth/session' ? {authenticated:true,user:{id:user,nickname:user===1?'Master':'Desy',identity:user===1?'lui':'lei',role:user===1?'admin':'member',isTest:false},adminModeEnabled:false}
        : path==='/api/world-settings' ? {settings:{},values:{theme:'white-world'}}
        : path==='/api/realtime' ? {enabled:false}
        : path==='/api/gdr/character-schema' ? {fields}
        : path==='/api/gdr/character-fields' ? {values:{}}
        : path==='/api/gdr-blocks' ? {blocks:[]}
        : path==='/api/gdr/turns' ? {turns:[]} : {};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return;
    }
    let file=join(root,path),data;
    try {data=await readFile(file);}catch{file=join(root,'index.html');data=await readFile(file);}
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp'})[extname(file)]||'application/octet-stream');res.end(data);
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`, screenshots=await mkdtemp(join(tmpdir(),'gdr-pets-'));
const browser=await chromium.launch(), page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
await page.addInitScript(()=>{
  sessionStorage.setItem('noi-crossword-access-session-v1',sessionStorage.getItem('gdr-test-user')||'1');
  sessionStorage.setItem('noi-crossword-access-session-touched-at-v1',String(Date.now()));
});
try {
  await page.goto(`${base}/tavolo-da-gioco/gdr/gioca/${adventureId}`);
  await page.getByRole('button',{name:'Gestisci PG e PNG',exact:true}).click();
  let panel=page.locator('app-gdr-characters');
  await panel.locator('.roster-entry').filter({hasText:'Sally'}).click();
  await panel.getByRole('button',{name:'Modifica scheda',exact:true}).click();
  await panel.getByLabel('Pet',{exact:true}).check();
  await panel.getByLabel('Assegna al PG',{exact:true}).selectOption('daisy');
  await panel.screenshot({path:join(screenshots,'master-assegna-pet.png')});
  await panel.getByRole('button',{name:'Salva modifiche',exact:true}).click();
  await panel.getByRole('button',{name:'Modifica scheda',exact:true}).waitFor();
  assert.equal(harness.sqlite.prepare('SELECT pet_owner_id FROM gdr_workspace_characters WHERE id=?').get('sally').pet_owner_id,'daisy');
  await panel.locator('.roster-entry').filter({has:page.getByText('Daisy',{exact:true})}).click();
  await panel.locator('.assigned-pet').getByText('Sally',{exact:true}).waitFor();
  assert.equal(await panel.getByText('Nome del gatto',{exact:true}).count(),0);
  user=2;await page.evaluate(()=>sessionStorage.setItem('gdr-test-user','2'));await page.reload();
  await page.getByRole('button',{name:'Scheda',exact:true}).click();
  panel=page.locator('.gdr-panel-sheet');
  await panel.locator('.assigned-pet').getByText('Sally',{exact:true}).waitFor();
  assert.equal(await panel.locator('.assigned-pet').getByRole('button').count(),0);
  assert.equal(await panel.getByText('Nome del gatto',{exact:true}).count(),0);
  for(const width of [1280,390,320]) {
    await page.setViewportSize({width,height:900});
    await panel.locator('.assigned-pet').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Overflow a ${width}px`);
    await page.screenshot({path:join(screenshots,`player-pets-${width}.png`)});
  }
  await page.setViewportSize({width:1280,height:900});
  await panel.getByRole('button',{name:'Modifica personaggio',exact:true}).click();
  assert.equal(await panel.locator('#character-is-pet,#pet-owner,#sheet-field-catName').count(),0);
  assert.deepEqual(errors,[]);
  console.log(`PASS: assegna Sally a Daisy, salva sul PNG canonico, lettura nella scheda compatta player e 3 viewport. Screenshot: ${screenshots}`);
}catch(error){await page.screenshot({path:join(screenshots,'errore.png')});console.error('Screenshot:',screenshots);console.error('Browser errors:',errors);throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));harness.sqlite.close();}
