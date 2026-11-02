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
const longText = Array.from({length:240},(_,i)=>`Riga ${String(i).padStart(3,'0')}: racconto.`).join('\n');
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
const base=`http://127.0.0.1:${server.address().port}`, screenshots=await mkdtemp(join(tmpdir(),'gdr-writing-position-'));
const browser=await chromium.launch(), page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
await page.addInitScript(()=>{
  sessionStorage.setItem('noi-crossword-access-session-v1',sessionStorage.getItem('gdr-test-user')||'1');
  sessionStorage.setItem('noi-crossword-access-session-touched-at-v1',String(Date.now()));
});
const settled=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const placeSelection=async(area)=>{
  await area.evaluate(a=>{
    const start=a.value.indexOf('Riga 010');
    if(start<0) throw new Error('Frase da selezionare assente');
    a.focus({preventScroll:true});a.setSelectionRange(start,start+8);a.scrollTop=120;a.scrollLeft=0;
  });
  await settled();
  return area.evaluate(a=>({top:a.scrollTop,start:a.selectionStart,end:a.selectionEnd}));
};
const assertPosition=async(area,before,label)=>{
  await settled();
  const after=await area.evaluate(a=>({top:a.scrollTop,selected:a.value.slice(a.selectionStart,a.selectionEnd),focused:document.activeElement===a,start:a.selectionStart}));
  assert.ok(Math.abs(after.top-before.top)<2,`${label}: scorrimento ${before.top} -> ${after.top}`);
  assert.equal(after.focused,true,`${label}: il focus torna al testo`);
  assert.ok(after.start<1000,`${label}: cursore vicino al punto di inserimento, non in fondo`);
  return after;
};
try {
  await page.goto(`${base}/tavolo-da-gioco/gdr/gioca/${adventureId}`);
  const area=page.locator('#lab-turn'), editor=page.locator('app-gdr-source-editor').filter({has:area});
  for(const width of [1280,390]) {
    await page.setViewportSize({width,height:900});
    for(const mode of ['Solo testo','Testo e anteprima']) {
      await editor.getByRole('button',{name:mode,exact:true}).click();
      await area.fill(longText);let before=await placeSelection(area);
      await editor.getByRole('button',{name:'Titolo',exact:true}).click();
      let after=await assertPosition(area,before,`${width}px ${mode} titolo`);
      assert.equal(after.selected,'Riga 010');
      await page.keyboard.type('Titolo riscritto');
      assert.ok((await area.inputValue()).includes('## Titolo riscritto'));
      await area.fill(longText);before=await placeSelection(area);
      await editor.getByRole('button',{name:'Dialogo',exact:true}).click();
      after=await assertPosition(area,before,`${width}px ${mode} dialogo`);
      assert.ok((await area.inputValue()).includes('::: dialogo Daisy'));
    }
  }
  await editor.getByRole('button',{name:'Solo testo',exact:true}).click();
  await area.fill(longText);let before=await placeSelection(area);
  await editor.getByRole('button',{name:'Immagine',exact:true}).click();
  await editor.locator('.image-choice').first().click();
  await assertPosition(area,before,'immagine dalla libreria');
  // Anche la toolbar della modifica rapida deve conservare la posizione nel blocco lungo.
  await page.locator('app-gdr-turn button.gdr-edit-start').first().click();
  const inline=page.locator('.inline-editor textarea');
  before=await placeSelection(inline);
  await page.getByLabel('Inserisci contenuto nel blocco',{exact:true}).selectOption('heading');
  await assertPosition(inline,before,'modifica rapida');
  await inline.screenshot({path:join(screenshots,'cursore-nella-parte-alta.png')});
  assert.deepEqual(errors,[]);
  console.log(`PASS: cursore, selezione e scorrimento conservati su desktop/mobile, testo e split, titoli, dialoghi, immagini e modifica rapida. Screenshot: ${screenshots}`);
}catch(error){await page.screenshot({path:join(screenshots,'errore.png')});console.error('Screenshot:',screenshots);console.error('Browser errors:',errors);throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));harness.sqlite.close();}
