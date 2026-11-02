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
  await page.locator('app-gdr-turn button.gdr-edit-start').first().click();
  await page.getByLabel('Formato PNG',{exact:true}).selectOption('full');
  await page.getByRole('button',{name:'Applica al testo',exact:true}).click();
  const full=page.locator('app-gdr-turn .npc-grid.npc-full').first();await full.waitFor();
  assert.equal(blocks[0].type,'npc_grid');assert.equal(blocks[0].data.layout,'full');assert.equal(blocks[0].data.entries[0].name,'Shivay Lorenne');
  const area=page.locator('#lab-turn'),editor=page.locator('app-gdr-source-editor').filter({has:area});
  await editor.locator('select').first().selectOption({index:1});
  await editor.getByRole('button',{name:'PNG a tutta pagina',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#lab-turn')?.value.startsWith('::: npc full'));
  const draft=await area.inputValue();assert.ok(draft.startsWith('::: npc full'));assert.ok(draft.includes(photo));assert.equal(draft.includes(avatar),false);
  assert.equal(await editor.locator('.image-picker').count(),0);
  user=2;await page.evaluate(()=>sessionStorage.setItem('gdr-test-user','2'));await page.reload();
  for(const width of [1280,390,320]) {
    await page.setViewportSize({width,height:900});
    const close=page.getByRole('button',{name:'Chiudi i luoghi',exact:true});if(await close.isVisible())await close.click();
    await page.mouse.move(width-5,5);await page.keyboard.press('Escape');
    const npc=page.locator('app-gdr-turn .npc-grid.npc-full').first();await npc.waitFor();
    const img=npc.locator('img');await img.evaluate(el=>el.decode());
    const sizes=await npc.evaluate(el=>{
      const img=el.querySelector('img'),r=img.getBoundingClientRect(),grid=el.getBoundingClientRect();
      return {width:r.width,gridWidth:grid.width,ratio:r.width/r.height,natural:img.naturalWidth/img.naturalHeight,src:img.getAttribute('src')};
    });
    assert.ok(Math.abs(sizes.width-sizes.gridWidth)<5,JSON.stringify(sizes));assert.ok(Math.abs(sizes.ratio-sizes.natural)<.01,JSON.stringify(sizes));assert.equal(sizes.src,photo);
    assert.ok((await npc.innerText()).includes('Shivay Lorenne'));assert.ok((await npc.innerText()).includes('La compagna di Daisy.'));
    assert.equal(await page.getByRole('button',{name:'PNG a tutta pagina',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await npc.screenshot({path:join(screenshots,`png-full-player-${width}.png`),animations:'disabled'});
  }
  assert.deepEqual(errors,[]);console.log('PASS: formato a tutta pagina di un PNG reale, stesso blocco condiviso, inserimento da toolbar, foto completa e player a 1280/390/320px. Screenshot:',screenshots);
}catch(error){await page.screenshot({path:join(screenshots,'errore.png')});console.error('Screenshot:',screenshots);console.error('Browser errors:',errors);throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));harness.sqlite.close();}
