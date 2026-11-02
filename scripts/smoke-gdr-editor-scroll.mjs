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
const longText = Array.from({length:100},(_,i)=>`## Scena ${i}\n\nRiga ${String(i).padStart(3,'0')}: una lunga passeggiata attraverso il castello, fra i corridoi e le stanze della scuola.\n\n::: dialogo Daisy\nUna battuta della protagonista nella scena ${i}.\n:::`).join('\n\n');
harness.sqlite.prepare('INSERT INTO gdr_character_schema VALUES(?,?)').run(adventureId,JSON.stringify(fields));
for (const [id,name,kind] of [['daisy','Daisy','pg']]) {
  await mutate(harness.db,master,{action:'createCharacter',id,adventureId,name,kind,profile:{}});
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
const base=`http://127.0.0.1:${server.address().port}`, screenshots=await mkdtemp(join(tmpdir(),'gdr-editor-scroll-'));
const browser=await chromium.launch(), page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
await page.addInitScript(()=>{
  sessionStorage.setItem('noi-crossword-access-session-v1',sessionStorage.getItem('gdr-test-user')||'1');
  sessionStorage.setItem('noi-crossword-access-session-touched-at-v1',String(Date.now()));
});
const settled=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
const fraction=area=>area.evaluate(el=>el.scrollTop/(el.scrollHeight-el.clientHeight));
try {
  await page.goto(`${base}/tavolo-da-gioco/gdr/gioca/${adventureId}`);
  const area=page.locator('#lab-turn'),editor=page.locator('app-gdr-source-editor').filter({has:area});
  await area.fill(longText);
  for(const width of [1280,390,320]) {
    await page.setViewportSize({width,height:900});
    await editor.getByRole('button',{name:'Testo e anteprima',exact:true}).click();
    const preview=editor.locator('.preview-pane');await settled();
    assert.ok(await area.evaluate(el=>el.scrollHeight>el.clientHeight*3),'Il testo deve scorrere dentro il pannello');
    assert.ok(await preview.evaluate(el=>el.scrollHeight>el.clientHeight*3),'L’anteprima deve scorrere dentro il pannello');
    assert.ok((await editor.locator('.panes').boundingBox()).height<850,'Il testo lungo non dilata l’editor');
    await area.evaluate(el=>el.scrollTop=(el.scrollHeight-el.clientHeight)*.55);await settled();
    assert.ok(Math.abs(await fraction(preview)-.55)<.005,`Testo -> anteprima ${width}`);
    await preview.dispatchEvent('pointerdown');
    await preview.evaluate(el=>el.scrollTop=(el.scrollHeight-el.clientHeight)*.25);await settled();
    assert.ok(Math.abs(await fraction(area)-.25)<.005,`Anteprima -> testo ${width}`);
    await preview.evaluate(el=>el.scrollTop=el.scrollHeight);await settled();
    assert.ok(await fraction(area)>.995,`Fine raggiungibile ${width}`);
    await preview.evaluate(el=>el.scrollTop=0);await settled();assert.ok(await fraction(area)<.005,`Inizio raggiungibile ${width}`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Nessun overflow ${width}`);
    await editor.evaluate(el=>el.scrollIntoView({block:'start'}));
    await page.screenshot({path:join(screenshots,`split-${width}.png`)});
    await editor.getByRole('button',{name:'Solo testo',exact:true}).click();
    // Simula l’allargamento manuale della casella: la toolbar deve seguire la pagina.
    await area.evaluate(el=>{el.style.height='1800px';el.style.flex='none';});
    await editor.evaluate(el=>window.scrollTo(0,window.scrollY+el.getBoundingClientRect().top+450));await settled();
    const tools=editor.locator('.editor-controls'),bounds=await tools.boundingBox();
    assert.ok(bounds.y>=0 && bounds.y<20,`Barra fissa ${width}: ${JSON.stringify(bounds)}`);
    const button=editor.getByRole('button',{name:'Titolo',exact:true});
    assert.equal(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,`Comando raggiungibile ${width}`);
    await page.screenshot({path:join(screenshots,`toolbar-${width}.png`)});
    await area.evaluate(el=>{el.style.height='';el.style.flex='';});
  }
  assert.deepEqual(errors,[]);console.log(`PASS: toolbar sempre raggiungibile, editor contenuto e scroll sincronizzato bidirezionale a 1280/390/320px. Screenshot: ${screenshots}`);
}catch(error){await page.screenshot({path:join(screenshots,'errore.png')});console.error('Screenshot:',screenshots);console.error('Browser errors:',errors);throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));harness.sqlite.close();}
