// Dopo npm run build. API simulate, nessuna scrittura remota.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('web/dist/web/browser');
const adventures = [{ id:'a', title:'Avventura A' }, { id:'b', title:'Avventura B' }];
const characters = [
  { id:'daisy', name:'Daisy', kind:'pg', adventureId:'a', archived:0 },
  { id:'sally', name:'Sally', kind:'png', adventureId:'b', archived:0 },
];
let power, writes;
const reset = () => {
  writes = [];
  power = { id:'scudo', name:'Scudo magico', kind:'spell', description:'Protegge da un colpo.', effects:[], revision:1, adventureIds:['a'], characterIds:['daisy'] };
};
reset();
const server = createServer(async (req,res) => {
  try {
    const path = new URL(req.url,'http://test').pathname;
    if (path.startsWith('/api/')) {
      let body = {};
      if (path === '/api/auth/session') body = { authenticated:true, adminModeEnabled:true, user:{ id:1, nickname:'Master', email:'test@example.com', identity:'lui', role:'admin', isTest:false, safeMode:false } };
      else if (path === '/api/gdr-powers') {
        if (req.method === 'POST') {
          let raw=''; for await (const chunk of req) raw+=chunk;
          const payload=JSON.parse(raw); writes.push(payload);
          assert.equal(payload.revision,power.revision);
          power={...payload,revision:power.revision+1}; body={saved:true};
        } else body={powers:[power],adventures,characters};
      } else if (path === '/api/realtime') body={enabled:false};
      else if (path === '/api/world-settings') body={settings:{hearts:false},values:{theme:'love'}};
      else if (path === '/api/world-updates') body={updates:[]};
      else if (path === '/api/gdr-workspace') body={adventures:[],characters:[],grants:[],users:[],isMaster:true};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return;
    }
    let file=join(root,path),data;
    try { data=await readFile(file); } catch { file=join(root,'index.html');data=await readFile(file); }
    res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]||'application/octet-stream');
    res.end(data);
  } catch(error) { res.writeHead(500);res.end(String(error)); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();
try {
  for (const width of [390,1280]) {
    reset();
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      sessionStorage.setItem('noi-crossword-access-session-v1','1');
      sessionStorage.setItem('noi-crossword-access-session-touched-at-v1',String(Date.now()));
    });
    await page.goto(base+'/tavolo-da-gioco/gdr/poteri?adventure=a');
    await page.getByRole('heading',{name:'Scudo magico',exact:true}).waitFor();
    await page.getByLabel('Descrizione',{exact:true}).fill('Protezione condivisa aggiornata.');
    await page.getByLabel('Avventura B',{exact:true}).check();
    await page.getByLabel('Sally · PNG · Avventura B',{exact:true}).check();
    await page.getByRole('button',{name:'Salva voce e assegnazioni',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Voce e assegnazioni salvate.'}).waitFor();
    assert.deepEqual(writes[0].adventureIds,['a','b']);
    assert.deepEqual(writes[0].characterIds,['daisy','sally']);
    assert.equal(await page.getByLabel('Descrizione',{exact:true}).inputValue(),'Protezione condivisa aggiornata.');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Nessuno scorrimento orizzontale');
    await page.screenshot({path:`/tmp/gdr-power-catalog-${width}.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log('Catalogo GDR: apertura, modifica, assegnazione PG/PNG e salvataggio verificati a 390 e 1280 px.');
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
