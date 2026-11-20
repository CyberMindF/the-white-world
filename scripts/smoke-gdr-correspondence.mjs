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
const initial = '::: lettera {"signature":"Ada","date":"Terza luna"}\nCara Daisy,\n\nla chiave è sotto la finestra.\n:::\n\n::: pensiero Daisy | | daisy\nDevo trovarla prima degli altri.\n:::\n\n::: dialogo Daisy | | daisy\nLa cercherò io.\n:::\n\n::: messaggio {"name":"Shivay","characterId":"shivay","date":"Ieri","time":"18:42"}\nCi vediamo al castello.\n:::';
harness.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,JSON.stringify(fields));
for (const [id,name,kind] of [['daisy','Daisy','pg']]) {
  await mutate(harness.db,master,{action:'createCharacter',id,adventureId,name,kind,portrait:avatar,profile:{}});
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
    const choose = async label => editor.getByLabel('Tipo di blocco',{exact:true}).selectOption({label});
    const person = editor.getByLabel('Personaggio',{exact:true});
    const code = async (label,value) => area.fill((await area.inputValue()).replace(new RegExp('^'+label+':.*$','m'),label+': '+value));
    // Un solo editor: dati facoltativi e corpo si scrivono nella stessa textbox.
    await choose('Lettera');
    await area.fill('Cara Ada,\n\nci vediamo domani.');await area.evaluate(el=>el.select());
    await editor.getByRole('button',{name:'Aggiungi',exact:true}).click();
    assert.equal(await area.isVisible(),true);assert.equal(await editor.locator('.inline-editor, .insertion-details').count(),0);
    await page.waitForFunction(()=>document.querySelector('#lab-turn')?.value.includes('DATA: (Elimina se non ti serve)'));
    await code('DATA','Terza luna');await code('FIRMA','Daisy');
    assert.equal((await area.inputValue()).includes('"signature"'),false);
    for(const width of [1280,390,320]) {
      await page.setViewportSize({width,height:1000});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await editor.screenshot({path:join(screenshots,`insertion-${actor}-${width}.png`),animations:'disabled'});
    }
    await choose('Messaggio');
    const option=person.locator('option').filter({hasText:'Shivay'});assert.equal(await option.count(),1);
    await person.selectOption(await option.getAttribute('value'));
    await area.fill('Arrivo.');await area.evaluate(el=>el.select());await editor.getByRole('button',{name:'Aggiungi',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#lab-turn')?.value.includes('ORA: (Elimina se non ti serve)'));
    await code('DATA','Ieri');await code('ORA','Dopo cena');
    assert.equal(await area.isVisible(),true);assert.equal(await editor.locator('.inline-editor').count(),0);
    assert.equal((await area.inputValue()).includes('characterId'),false);
    await editor.getByRole('button',{name:'Solo anteprima',exact:true}).click();
    const message=editor.locator('.chat-message');await message.waitFor();
    assert.ok((await message.innerText()).includes('Shivay'));assert.equal(await message.locator('img').getAttribute('src'),avatar);
    assert.ok((await message.innerText()).includes('Dopo cena'));
    assert.equal(await editor.locator('.edit-start, .edit-speaker, .gdr-edit-start, .inline-editor').count(),0);
    await editor.getByRole('button',{name:'Torna al testo',exact:true}).click();
    await choose('Messaggio');await person.selectOption({label:'Nome o numero libero'});
    await area.fill('<img src=x onerror=alert(1)>\nArrivo.');await area.evaluate(el=>el.select());
    await editor.getByRole('button',{name:'Aggiungi',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#lab-turn')?.value.includes('CONTATTO: (Elimina se non ti serve)'));await code('CONTATTO','+39 123 456');
    await area.fill((await area.inputValue()).replace(/^(?:DATA|ORA):.*\n/gm,''));
    await editor.getByRole('button',{name:'Solo anteprima',exact:true}).click();
    assert.equal(await message.locator('img, .chat-meta').count(),0);assert.ok((await message.innerText()).includes('<img src=x onerror=alert(1)>'));
    assert.equal((await message.innerText()).includes('Elimina se non ti serve'),false);
    await editor.getByRole('button',{name:'Torna al testo',exact:true}).click();
    for (const [label,kind,rendered] of [['Pensiero','pensiero','.thought em'],['Dialogo','dialogo','.dialogue p']]) {
      for (const mode of ['Solo testo','Testo e anteprima']) {
        await area.fill('Non posso fidarmi.');await area.evaluate(el=>el.select());
        await editor.getByRole('button',{name:mode,exact:true}).click();
        await choose(label);await person.selectOption({label:'Daisy · PG'});await editor.getByRole('button',{name:'Aggiungi',exact:true}).click();
        await page.waitForFunction(()=>{
          const field=document.querySelector('#lab-turn');
          return document.activeElement===field && field.value.slice(field.selectionStart,field.selectionEnd)==='Non posso fidarmi.';
        });
        assert.ok((await area.inputValue()).startsWith(`::: ${kind} Daisy`));
        assert.equal((await area.inputValue()).includes('|'),false);
        assert.equal(await area.isVisible(),true);
        assert.equal(await editor.locator('.inline-editor').count(),0);
        if(mode==='Testo e anteprima') assert.equal(await editor.locator(rendered).innerText(),'Non posso fidarmi.');
      }
    }
    if(actor===1) {
      await area.fill('::: lettera\n---\nUna parola importante.\n:::');
      for(const label of ['Grassetto','Sottolineato']) {
        await area.evaluate(el=>{const start=el.value.indexOf('parola');el.setSelectionRange(start,start+6);});
        await choose(label);await editor.getByRole('button',{name:'Aggiungi',exact:true}).click();
        await page.waitForFunction(()=>{const el=document.querySelector('#lab-turn');return document.activeElement===el&&el.value.slice(el.selectionStart,el.selectionEnd)==='parola';});
      }
      assert.equal((await area.inputValue()).includes('Una **__parola__** importante.'),true);
      await editor.getByRole('button',{name:'Solo anteprima',exact:true}).click();
      assert.equal(await editor.locator('.letter-body strong u').innerText(),'parola');
      assert.ok(await editor.locator('.letter-body strong').evaluate(el=>Number(getComputedStyle(el).fontWeight)>=600));
      assert.ok((await editor.locator('.letter-body u').evaluate(el=>getComputedStyle(el).textDecorationLine)).includes('underline'));
      await editor.getByRole('button',{name:'Torna al testo',exact:true}).click();
    } else {
      const options=editor.getByLabel('Tipo di blocco',{exact:true}).locator('option');
      assert.equal(await options.filter({hasText:/^(Grassetto|Sottolineato|Corsivo)$/}).count(),0);
    }
    await area.fill(initial);await editor.getByRole('button',{name:'Solo anteprima',exact:true}).click();
    for (const width of [1280,390,320]) {
      await page.setViewportSize({width,height:1000});
      const close = page.getByRole('button',{name:'Chiudi i luoghi',exact:true});if(await close.isVisible())await close.click();
      await page.keyboard.press('Escape');
      const letter = editor.locator('.letter'); await letter.waitFor();
      await page.evaluate(()=>document.fonts.ready);
      assert.equal(await letter.evaluate(el=>getComputedStyle(el).fontFamily.includes('Caveat')),true);
      assert.equal(await editor.locator('.thought .speaker img').getAttribute('src'),avatar);
      assert.equal(await editor.locator('.dialogue .speaker img').getAttribute('src'),avatar);
      assert.equal((await editor.locator('.thought').innerText()).includes('Pensiero'),false);
      assert.equal(await editor.locator('.cloud-outline').count(),1);
      assert.equal(await editor.locator('.thought em').evaluate(el=>getComputedStyle(el).fontStyle),'italic');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Overflow ${actor}/${width}`);
      await editor.screenshot({path:join(screenshots,`editor-${actor}-${width}.png`),animations:'disabled'});
    }
    if (actor === 1) {
      for (const [sample,text] of [['short','Ci penserò.'],['long','PROVA '.repeat(90).trim()]]) {
        await editor.getByRole('button',{name:'Torna al testo',exact:true}).click();
        await area.fill(`::: pensiero Daisy | | daisy\n${text}\n:::`);
        for (const [width,mode] of [[1280,'Solo anteprima'],[1280,'Testo e anteprima'],[390,'Testo e anteprima'],[320,'Solo anteprima']]) {
          await page.setViewportSize({width,height:1000});
          await editor.getByRole('button',{name:mode,exact:true}).click();
          const thought = editor.locator('.thought'), bubble = thought.locator('.thought-bubble');
          await page.waitForFunction(()=>{
            const svg=document.querySelector('app-gdr-source-editor .thought-bubble svg');
            return svg && Math.abs(svg.viewBox.baseVal.width-svg.getBoundingClientRect().width)<1 && Math.abs(svg.viewBox.baseVal.height-svg.getBoundingClientRect().height)<1;
          });
          const spacing = await bubble.evaluate(el=>{
            const rect=el.getBoundingClientRect(), avatar=el.closest('.thought').querySelector('.portrait-trigger').getBoundingClientRect();
            const dots=['::before','::after'].map(pseudo=>{
              const css=getComputedStyle(el,pseudo), left=rect.left+parseFloat(css.left), top=rect.top+parseFloat(css.top);
              return {left,top,right:left+parseFloat(css.width),bottom:top+parseFloat(css.height)};
            });
            return {bubbleLeft:rect.left,avatarRight:avatar.right,dots};
          });
          const [large,small]=spacing.dots;
          assert.ok(small.left-spacing.avatarRight>=4, 'Pallini separati dall’avatar');
          assert.ok(large.left-small.right>=4, 'Pallini separati tra loro');
          assert.ok(spacing.bubbleLeft-large.right>=4, 'Pallini fuori dal contorno');
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
          await thought.screenshot({path:join(screenshots,`thought-${sample}-${width}-${mode==='Solo anteprima'?'preview':'split'}.png`),animations:'disabled'});
          if (width === 1280 && mode === 'Solo anteprima') {
            await page.evaluate(()=>document.body.dataset.theme='the-white-world');
            await thought.screenshot({path:join(screenshots,`thought-${sample}-dark.png`),animations:'disabled'});
            await page.evaluate(()=>document.body.dataset.theme='white-world');
          }
        }
      }
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
