// Browser locale e database in memoria: nessuna modifica alle partite reali.
// GDR_SMOKE_ASSET_ORIGIN=https://il-mondo-bianco.com verifica gli asset pubblicati con le stesse API simulate.
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
const avatar = '/assets/images/gdr/il-prezzo-della-verita/valin-fajar.webp';
const initial = '::: lettera {"signature":"Ada","date":"Terza luna"}\nCara Daisy,\n\nla chiave è sotto la finestra.\n:::\n\n::: pensiero Daisy | | daisy\nDevo trovarla prima degli altri.\n:::\n\n::: messaggio {"name":"Shivay","characterId":"shivay","date":"Ieri","time":"18:42"}\nCi vediamo al castello.\n:::';
harness.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,JSON.stringify(fields));
for (const [id,name,kind] of [['daisy','Daisy','pg']]) {
  await mutate(harness.db,master,{action:'createCharacter',id,adventureId,name,kind,profile:{}});
}
await mutate(harness.db,master,{action:'createCharacter',id:'shivay',adventureId,name:'Shivay',kind:'png',portrait:avatar,profile:{}});
await mutate(harness.db,master,{action:'grant',characterId:'daisy',revision:1,userId:2,canSpeak:true,canEditSheet:true,canInventory:false});
// Impedisce al sync storico di creare un secondo PG di prova.
harness.sqlite.prepare("INSERT INTO gdr_workspace_story_links VALUES(?,'pg','daisy')").run(adventureId);
let user = 1;
const root = resolve('web/dist/web/browser');
const assetOrigin = process.env.GDR_SMOKE_ASSET_ORIGIN;
const assetCache = new Map();
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
        : path==='/api/gdr-blocks' ? {blocks:[{id:'123',documentKey:'avventura',position:0,type:'paragraph',data:{text:initial,format:'gdr-narrative'}}]}
        : path==='/api/gdr/turns' ? {turns:[]} : {};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return;
    }
    if (assetOrigin) {
      if (!assetCache.has(path)) {
        const upstream = await fetch(new URL(req.url, assetOrigin));
        if (!upstream.ok) throw new Error(`Asset ${path}: ${upstream.status}`);
        assetCache.set(path, {type: upstream.headers.get('content-type') || 'application/octet-stream', data: Buffer.from(await upstream.arrayBuffer())});
      }
      const asset = assetCache.get(path);
      res.setHeader('Content-Type', asset.type);res.end(asset.data);return;
    }
    let file=join(root,path),data;
    try {data=await readFile(file);}catch{file=join(root,'index.html');data=await readFile(file);}
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp'})[extname(file)]||'application/octet-stream');res.end(data);
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`, screenshots=await mkdtemp(join(tmpdir(),'gdr-correspondence-'));
const browser=await chromium.launch(), page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
await page.addInitScript(()=>{
  sessionStorage.setItem('noi-crossword-access-session-v1',sessionStorage.getItem('gdr-test-user')||'1');
  sessionStorage.setItem('noi-crossword-access-session-touched-at-v1',String(Date.now()));
});
try {
  for (const actor of [1, 2]) {
    user = actor;
    await page.goto(`${base}/tavolo-da-gioco/gdr/gioca/${adventureId}`);
    const area = page.locator('#lab-turn'), editor = page.locator('app-gdr-source-editor').filter({has: area});
    await area.waitFor();
    // Stessi strumenti per master e giocatrice; i contatti includono i PNG pubblici.
    await editor.getByRole('button', {name:'Lettera / Messaggio',exact:true}).click();
    await editor.getByLabel('Formato',{exact:true}).selectOption('lettera');
    await editor.getByLabel('Corpo della lettera',{exact:true}).fill('Cara Ada,\n\nci vediamo domani.');
    await editor.getByLabel('Firma (facoltativa)',{exact:true}).fill('Daisy');
    await editor.getByLabel('Data (facoltativo)',{exact:true}).fill('Terza luna');
    await editor.getByLabel('Formato',{exact:true}).selectOption('messaggio');
    const contact = editor.getByLabel('Contatto',{exact:true});
    const option = contact.locator('option').filter({hasText:'Shivay'});
    assert.equal(await option.count(),1);
    await contact.selectOption(await option.getAttribute('value'));
    await editor.getByLabel('Orario (facoltativo)',{exact:true}).fill('Dopo cena');
    await editor.getByLabel('Formato',{exact:true}).selectOption('lettera');
    assert.equal(await editor.getByLabel('Firma (facoltativa)',{exact:true}).inputValue(),'Daisy');
    await editor.getByLabel('Formato',{exact:true}).selectOption('messaggio');
    await editor.getByRole('button',{name:'Applica al testo',exact:true}).click();
    const message = editor.locator('.chat-message'); await message.waitFor();
    assert.ok((await message.innerText()).includes('Shivay'));
    assert.equal(await message.locator('img').getAttribute('src'),avatar);
    assert.ok((await area.inputValue()).includes('"characterId":"shivay"'));
    assert.equal((await area.inputValue()).includes(avatar),false);
    // Testo letterale, senza HTML eseguibile, e contatto libero senza collegamento automatico.
    await editor.getByRole('button',{name:'✎ Modifica messaggio',exact:true}).click();
    await editor.getByLabel('Contatto',{exact:true}).selectOption({label:'Nome o numero libero'});
    await editor.getByLabel('Nome o numero',{exact:true}).fill('+39 123 456');
    await editor.getByLabel('Testo del messaggio',{exact:true}).fill('<img src=x onerror=alert(1)>\nArrivo.');
    await editor.getByRole('button',{name:'Applica al testo',exact:true}).click();
    assert.equal(await message.locator('img').count(),0);
    assert.ok((await message.innerText()).includes('<img src=x onerror=alert(1)>'));
    await editor.getByRole('button',{name:'Torna al testo',exact:true}).click();
    await area.fill('Non posso fidarmi.');await area.evaluate(el=>el.select());
    await editor.getByRole('button',{name:'Pensiero',exact:true}).click();
    const thoughtBody = editor.locator('.inline-editor textarea');await thoughtBody.waitFor();
    assert.equal(await thoughtBody.inputValue(),'Non posso fidarmi.');
    await editor.getByRole('button',{name:'Applica al testo',exact:true}).click();
    assert.equal(await editor.locator('.thought em').innerText(),'Non posso fidarmi.');
    await editor.getByRole('button',{name:'Torna al testo',exact:true}).click();
    await area.fill(initial);await editor.getByRole('button',{name:'Solo anteprima',exact:true}).click();
    for (const width of [1280,390,320]) {
      await page.setViewportSize({width,height:1000});
      const close = page.getByRole('button',{name:'Chiudi i luoghi',exact:true});if(await close.isVisible())await close.click();
      await page.keyboard.press('Escape');
      const letter = editor.locator('.letter'); await letter.waitFor();
      await page.evaluate(()=>document.fonts.ready);
      assert.equal(await letter.evaluate(el=>getComputedStyle(el).fontFamily.includes('Caveat')),true);
      assert.equal(await editor.locator('.thought em').evaluate(el=>getComputedStyle(el).fontStyle),'italic');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Overflow ${actor}/${width}`);
      await editor.screenshot({path:join(screenshots,`editor-${actor}-${width}.png`),animations:'disabled'});
    }
    await editor.getByRole('button',{name:'Torna al testo',exact:true}).click();
    await area.fill('');
    await page.evaluate(()=>sessionStorage.setItem('gdr-test-user','2'));
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: lettere, messaggi singoli neutri, contatti liberi/PG/PNG, cambio formato e pensieri per master e giocatrice a 1280/390/320px. Screenshot:',screenshots);
} catch(error) {
  await page.screenshot({path:join(screenshots,'errore.png')});console.error('Screenshot:',screenshots);console.error('Browser errors:',errors);throw error;
} finally {
  await browser.close();await new Promise(resolve=>server.close(resolve));harness.sqlite.close();
}
