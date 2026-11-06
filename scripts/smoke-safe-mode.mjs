// Eseguire dopo npm run build. API simulate; verifica accesso, filtri e preferenze separate.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('web/dist/web/browser');
const preferences = new Map([[1, true], [2, false]]);
const news = [
  { id:'1', kind:'mondo', title:'Novità studio', body:'Quiz disponibili', safe:true, active:true, announce:true, seen:true, publishedAt:'2026-10-30T00:00:00Z' },
  { id:'2', kind:'mondo', title:'Una lettera romantica', body:'NON SAFE', safe:false, active:true, announce:true, seen:true, publishedAt:'2026-10-30T00:00:00Z' }
];
const trackedEvents = [];
const adventures = [
 {id:'il-prezzo-della-verita',title:'Il Prezzo della Verità',source:'',legacy:true,published:true,revision:1},
 {id:'la-casa-che-trattiene-il-respiro',title:'La casa che trattiene il respiro',source:'',legacy:true,published:true,revision:1}
];
let failSave = false;
const adminModes = new Map([[1,false],[2,false]]);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://test').pathname;
    if (path.startsWith('/api/')) {
      const id = Number(/user=(\d+)/.exec(req.headers.cookie || '')?.[1] || 1);
      const user = {id, nickname:'Test', email:'test@example.com', identity:id === 1 ? 'lui' : 'lei', role:'admin', isTest:false, safeMode:preferences.get(id)};
      let body = {};
      if (path === '/api/telemetry/events') {
        let data=''; for await (const chunk of req) data+=chunk;
        trackedEvents.push(JSON.parse(data)); body={saved:true};
      } else if (path === '/api/auth/safe-mode') {
        let data=''; for await (const chunk of req) data+=chunk;
        if (failSave) { res.writeHead(500, {'Content-Type':'application/json'}); res.end('{}'); return; }
        preferences.set(id, JSON.parse(data).enabled); if (preferences.get(id)) adminModes.set(id,false); body={ safeMode:preferences.get(id) };
      } else if (path === '/api/auth/session') body=id === 0 ? {authenticated:false} : {authenticated:true,user,adminModeEnabled:adminModes.get(id)};
      else if (path === '/api/auth/login' && id === 0) {
        res.setHeader('Set-Cookie','user=1; Path=/');
        body={authenticated:true,user:{...user,id:1,safeMode:preferences.get(1)}};
      }
      else if (path === '/api/auth/admin-mode') {
        let data=''; for await (const chunk of req) data+=chunk;
        adminModes.set(id,JSON.parse(data).enabled); body={adminModeEnabled:adminModes.get(id)};
      }
      else if (path === '/api/gdr-workspace') body={adventures,characters:[],grants:[],users:[],isMaster:false};
      else if (path === '/api/giochi-due/nuvola') body={version:0,pets:[],coins:0,events:[]};
      else if (path === '/api/world-settings') body={settings:{hearts:true}, values:{theme:'love'}};
      else if (path === '/api/realtime') body={enabled:false};
      else if (path === '/api/world-updates') body={updates:news.filter(n => !preferences.get(id) || n.safe)};
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(body)); return;
    }
    let file=join(root,path), data;
    try { data=await readFile(file); } catch { file=join(root,'index.html'); data=await readFile(file); }
    res.setHeader('Content-Type', ({'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch(e) {res.writeHead(500);res.end(String(e));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();
try {
 for (const width of [390,1280]) {
  trackedEvents.length=0;
  const context=await browser.newContext({viewport:{width,height:850},reducedMotion:'reduce'});
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await context.addCookies([{name:'user',value:'1',url:base}]);
  await page.addInitScript(()=>{
    sessionStorage.setItem('noi-crossword-access-session-v1','1');
    sessionStorage.setItem('noi-crossword-access-session-touched-at-v1',String(Date.now()));
  });
  await page.goto(base+'/');
  await page.getByRole('heading',{name:'Il Mondo Bianco',exact:true}).waitFor();
  assert.equal(await page.locator('.world-music').count(),0);
  assert.equal(await page.locator('app-world-hearts').count(),0);
  assert.equal(await page.locator('app-global-chat-widget').count(),1);
  assert.equal(await page.locator('a[href="/bacheca"]').count(),0);
  assert.equal(await page.locator('a[href="/aula-studio"]').count()>0,true);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(245, 246, 248)');
  await page.screenshot({path:`/tmp/safe-mode-${width}.png`});
  await page.getByRole('button',{name:'Apri la chat globale',exact:true}).click();
  await page.getByRole('link',{name:'Apri la chat a pagina intera',exact:true}).click();
  await page.waitForURL(base+'/ponti-chat');
  await page.getByRole('heading',{name:'Chat',exact:true}).waitFor();
  assert.equal(await page.locator('app-global-chat-widget').count(),0);
  await page.goto(base+'/bacheca');
  await page.waitForURL(base+'/');
  await page.goto(base+'/tavolo-da-gioco');
  await page.locator('.tavolo-games-grid').waitFor();
  assert.equal(await page.locator('.tavolo-game-card').count(),4);
  await page.locator('.tavolo-game-card[href="/tavolo-da-gioco/gdr"]').click();
  await page.getByRole('heading',{name:'Gioco di Ruolo',exact:true}).waitFor();
  assert.match(await page.locator('.tavolo-intro').innerText(), /Io faccio da master/);
  await page.screenshot({path:`/tmp/gdr-safe-intro-${width}.png`,fullPage:true});
  assert.equal(await page.locator('app-editorial-text[contentKey="gdr.introduzione"]').count(),0);
  await page.locator('.tavolo-game-card[href="/tavolo-da-gioco/gdr/gioca/il-prezzo-della-verita"]').click();
  await page.waitForURL(base+'/tavolo-da-gioco/gdr/gioca/il-prezzo-della-verita');
  await page.locator('app-gdr-laboratorio').waitFor();
  await page.getByRole('button',{name:'Apri il pannello con tutti i luoghi',exact:true}).click();
  const adventureLinks=page.locator('.world-navigation-entry:has(a[href="/tavolo-da-gioco"]) .is-adventure');
  await adventureLinks.last().waitFor();
  assert.equal(await adventureLinks.count(),2);
  assert.deepEqual(await adventureLinks.locator('span[aria-hidden="true"]').allTextContents(), ['🪄','📜']);
  await page.screenshot({path:`/tmp/gdr-sidebar-${width}.png`,animations:'disabled'});
  await adventureLinks.last().click();
  await page.waitForURL(base+'/tavolo-da-gioco/gdr/gioca/la-casa-che-trattiene-il-respiro');
  await page.waitForFunction(()=>document.querySelector('app-gdr-laboratorio')?.textContent?.includes('La casa che trattiene il respiro'));
  assert.ok(trackedEvents.some(e=>e.eventType==='gdr_adventure_opened' && e.metadata.adventure==='la-casa-che-trattiene-il-respiro'));
  await page.getByRole('button',{name:'Apri il pannello con tutti i luoghi',exact:true}).click();
  await adventureLinks.first().click();
  await page.waitForURL(base+'/tavolo-da-gioco/gdr/gioca/il-prezzo-della-verita');

  if (width <= 680) {
    const sheetTrigger = page.locator('.gdr-panel-trigger');
    await sheetTrigger.waitFor();
    const nav = await page.locator('.world-navigation-rail').boundingBox();
    const gdr = await sheetTrigger.boundingBox();
    const chat = await page.locator('.global-chat-trigger').boundingBox();
    assert.ok(gdr.y + gdr.height < nav.y, 'Scheda GDR sopra la navigazione');
    assert.ok(chat.y + chat.height < nav.y, 'Chat sopra la navigazione');
    assert.ok(gdr.x + gdr.width < chat.x, 'Scheda GDR e chat separate');
    await sheetTrigger.click();
    await page.locator('.gdr-panel-sheet').waitFor();
    await page.screenshot({path:`/tmp/gdr-mobile-tools-${width}.png`,fullPage:false});
    await page.getByRole('button',{name:'Chiudi la scheda',exact:true}).click();
  }
  await page.goto(base+'/tavolo-da-gioco/animali');
  await page.getByRole('heading',{name:'🐾 La casa degli animali',exact:true}).waitFor();
  await page.locator('app-pet-room').waitFor();
  await page.goto(base+'/novita');
  await page.getByRole('heading',{name:'Novità studio'}).waitFor();
  assert.equal(await page.getByRole('tab',{name:'Novità del Mondo',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await page.getByRole('tab',{name:'Da scoprire',exact:true}).isDisabled(),true);
  assert.equal(await page.getByText('Una lettera romantica',{exact:true}).count(),0);
  failSave=true;
  await page.getByRole('switch',{name:'Safe mode',exact:true}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('switch',{name:'Safe mode',exact:true}).isChecked(),true);
  failSave=false;
  await page.getByRole('switch',{name:'Safe mode',exact:true}).click();
  await page.waitForFunction(()=>!document.body.classList.contains('safe-mode'));
  assert.equal(preferences.get(1),false); assert.equal(preferences.get(2),false);
  await page.goto(base+'/'); await page.locator('.world-music').waitFor();
  await page.locator('.userbar-admin-toggle').click();
  await page.waitForFunction(() => document.querySelector('a[aria-label="Amministrazione"]'));
  assert.equal(adminModes.get(1),true);
  await page.getByRole('switch',{name:'Safe mode',exact:true}).click();
  await page.locator('.world-music').waitFor({state:'detached'});
  assert.equal(adminModes.get(1),false);
  assert.equal(await page.getByRole('checkbox',{name:'Modalità admin',exact:true}).count(),0);
  await page.getByRole('switch',{name:'Safe mode',exact:true}).click();
  await page.getByRole('checkbox',{name:'Modalità admin',exact:true}).waitFor();
  assert.equal(await page.getByRole('checkbox',{name:'Modalità admin',exact:true}).isChecked(),false);
  await page.getByRole('switch',{name:'Safe mode',exact:true}).click();
  await page.locator('.world-music').waitFor({state:'detached'});
  await page.reload(); await page.getByRole('switch',{name:'Safe mode',exact:true}).waitFor();
  assert.equal(await page.getByRole('switch',{name:'Safe mode',exact:true}).isChecked(),true);
  assert.equal(preferences.get(2),false);
  await page.goto(base+'/login');
  await page.getByRole('heading',{name:'Ti ricordi della chiave?'}).waitFor();
  assert.equal(await page.locator('.portone-story').count(),0);
  assert.equal(await page.getByRole('combobox',{name:'Safe mode',exact:true}).count(),0);
  await page.screenshot({path:`/tmp/safe-login-${width}.png`});
  await page.getByRole('switch',{name:'Safe mode',exact:true}).click();
  await page.locator('.portone-story').waitFor();
  await page.waitForFunction(() => !document.querySelector('[role="switch"]').disabled);
  assert.equal(preferences.get(1),false);
  await page.reload();
  await page.getByRole('heading',{name:'Ti ricordi della chiave?'}).waitFor();
  await page.locator('.portone-story').waitFor();
  assert.equal(await page.getByRole('switch',{name:'Safe mode',exact:true}).isChecked(),false);
  await page.locator('input[name="worldKey"]').fill('chiave-test');
  await page.getByRole('button',{name:'Entra',exact:true}).click();
  await page.waitForURL(base+'/');
  await page.locator('.world-music').waitFor();
  assert.equal(preferences.get(1),false);
  await page.goto(base+'/login');
  await page.getByRole('heading',{name:'Ti ricordi della chiave?'}).waitFor();
  await page.locator('.portone-story').waitFor();
  await page.getByRole('switch',{name:'Safe mode',exact:true}).click();
  await page.locator('.portone-story').waitFor({state:'detached'});
  await page.waitForFunction(() => !document.querySelector('[role="switch"]').disabled);
  assert.equal(preferences.get(1),true);
  await page.locator('input[name="worldKey"]').fill('chiave-test');
  await page.getByRole('button',{name:'Entra',exact:true}).click();
  await page.waitForURL(base+'/');
  assert.equal(preferences.get(1),true);
  assert.equal(await page.locator('.world-music').count(),0);
  assert.deepEqual(errors,[]);
  await context.close();
 }
 // Senza una sessione, il cambio aggiorna subito l’ingresso e viene salvato dopo il login.
 const anonymous = await browser.newContext({viewport:{width:390,height:850},reducedMotion:'reduce'});
 await anonymous.addCookies([{name:'user',value:'0',url:base}]);
 const login = await anonymous.newPage();
 await login.addInitScript(() => localStorage.setItem('noi-crossword-known-account-v1','true'));
 await login.goto(base+'/login');
 await login.getByRole('heading',{name:'Accedi al Mondo Bianco',exact:true}).waitFor();
 const savedPreference = preferences.get(1);
 await login.getByRole('switch',{name:'Safe mode',exact:true}).click();
 await login.locator('.portone-story').waitFor();
 assert.equal(preferences.get(1),savedPreference);
 await login.locator('input[name="email"]').fill('test@example.com');
 await login.locator('app-password-field input').first().fill('password-test');
 await login.locator('input[name="worldKey"]').fill('chiave-test');
 await login.getByRole('button',{name:'Accedi ed entra',exact:true}).click();
 await login.waitForURL(base+'/');
 await login.locator('.world-music').waitFor();
 assert.equal(preferences.get(1),false);
 await anonymous.close();
 preferences.set(1,true);
 news.forEach(update => update.seen = false);
 const context = await browser.newContext();
 await context.addCookies([{name:'user',value:'1',url:base}]);
 const page = await context.newPage();
 await page.addInitScript(() => {
   sessionStorage.setItem('noi-crossword-access-session-v1','1');
   sessionStorage.setItem('noi-crossword-access-session-touched-at-v1',String(Date.now()));
 });
 await page.goto(base+'/');
 const dialog = page.getByRole('dialog');
 await dialog.waitFor();
 assert.equal(await dialog.getByRole('heading',{name:'Novità studio',exact:true}).count(),1);
 assert.equal(await dialog.getByText('Una lettera romantica',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Chiudi le novità',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 assert.equal(await page.locator('.daily-reward,.world-promo').count(),0);
 await context.close();
 console.log('Safe mode e sidebar GDR: desktop/mobile, gerarchia avventure, navigazione e relativo log, filtri, persistenza e separazione account verificati.');
} finally {await browser.close(); await new Promise(r=>server.close(r));}
