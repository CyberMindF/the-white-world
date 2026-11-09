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
const photo='/assets/images/gdr/il-prezzo-della-verita/shivay-lorenne.webp';
const avatar='/assets/images/gdr/il-prezzo-della-verita/valin-fajar.webp';
let blocks=[{id:'123',documentKey:'avventura',position:0,type:'npc_grid',data:{entries:[{name:'Shivay Lorenne',alt:'Shivay Lorenne',image:photo,description:'La compagna di Daisy.'}]}}];

harness.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,JSON.stringify(fields));
for (const [id,name,kind] of [['daisy','Daisy','pg']]) {
  await mutate(harness.db,master,{action:'createCharacter',id,adventureId,name,kind,profile:{}});
}
await mutate(harness.db,master,{action:'createCharacter',id:'shivay',adventureId,kind:'png',name:'Shivay Lorenne',photo,portrait:avatar,profile:{appearance:'La compagna di Daisy.'}});
harness.sqlite.prepare('INSERT INTO gdr_blocks VALUES(?,?,?,?,?)').run(123,'avventura','npc_grid',JSON.stringify(blocks[0].data),0);
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
    if(path==='/api/gdr-blocks/123' && req.method==='PUT') {
      let raw='';for await(const part of req)raw+=part;const payload=JSON.parse(raw);
      blocks=[{...blocks[0],type:payload.type,data:payload.data}];
      harness.sqlite.prepare('UPDATE gdr_blocks SET type=?,data=? WHERE id=?').run(payload.type,JSON.stringify(payload.data),123);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(blocks[0]));return;
    }
    if(path.startsWith('/api/')) {
      const body = path==='/api/auth/session' ? {authenticated:true,user:{id:user,nickname:user===1?'Master':'Desy',identity:user===1?'lui':'lei',role:user===1?'admin':'member',isTest:false},adminModeEnabled:false}
        : path==='/api/world-settings' ? {settings:{},values:{theme:'white-world'}}
        : path==='/api/realtime' ? {enabled:false}
        : path==='/api/gdr/character-schema' ? {fields}
        : path==='/api/gdr/character-fields' ? {values:{}}
        : path==='/api/gdr-blocks' ? {blocks}
        : path==='/api/gdr/turns' ? {turns:[]} : {};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return;
    }
    let file=join(root,path),data;
    try {data=await readFile(file);}catch{file=join(root,'index.html');data=await readFile(file);}
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp'})[extname(file)]||'application/octet-stream');res.end(data);
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`, screenshots=await mkdtemp(join(tmpdir(),'gdr-npc-full-'));
const browser=await chromium.launch(), page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
await page.addInitScript(()=>{
  sessionStorage.setItem('noi-crossword-access-session-v1',sessionStorage.getItem('gdr-test-user')||'1');
  sessionStorage.setItem('noi-crossword-access-session-touched-at-v1',String(Date.now()));
});
try {
  await page.goto(`${base}/tavolo-da-gioco/gdr/gioca/${adventureId}`);
  for(const width of [1280,390]) {
    await page.setViewportSize({width,height:900});
    await page.locator('.npc-card .image-trigger').first().click();
    await page.locator('.character-modal').waitFor();
    assert.equal(await page.locator('.character-artwork').count(),1);
    await page.getByRole('button',{name:'Chiudi scheda',exact:true}).click();
    await page.locator('.npc-card h4 button').click();
    await page.locator('.character-modal').waitFor();
    await page.getByRole('button',{name:'Chiudi scheda',exact:true}).click();
  }
  blocks=[{id:'124',documentKey:'avventura',position:0,type:'image',data:{src:photo,alt:'Artwork',caption:null}}];
  await page.reload();
  await page.getByRole('button',{name:'Apri immagine',exact:true}).click();
  await page.locator('.image-modal').waitFor();
  assert.equal(page.context().pages().length,1);
  await page.screenshot({path:join(screenshots,'image-modal.png')});
  await page.getByRole('button',{name:'Chiudi immagine',exact:true}).click();
  assert.deepEqual(errors,[]);console.log('PASS: PNG immagine e nome, desktop/mobile, immagine in modale senza nuova scheda',screenshots);
}catch(error){await page.screenshot({path:join(screenshots,'errore.png')});console.error('Screenshot:',screenshots);console.error('Browser errors:',errors);throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));harness.sqlite.close();}
