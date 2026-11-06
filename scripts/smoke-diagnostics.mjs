// Browser locale, API simulate: nessuna richiesta al sito o al database di produzione.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('web/dist/web/browser');
const reports = [];
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://local').pathname;
    if (path === '/api/diagnostics' && request.method === 'POST') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      reports.push(JSON.parse(raw)); response.writeHead(202, {'Content-Type':'application/json'}); response.end('{}'); return;
    }
    if (path === '/api/diagnostic-failure') {
      response.writeHead(500, {'Content-Type':'application/json','X-Request-Id':'smoke-request-id'});response.end('{"error":"simulated"}');return;
    }
    if (path.startsWith('/api/')) {
      const body = path === '/api/auth/session' ? {authenticated:true,user:{id:1,nickname:'Test',role:'admin',identity:'lui',isTest:false},adminModeEnabled:true}
        : path === '/api/world-settings' ? {settings:{silk:false,sparkles:true},values:{theme:'red-of-you'}}
        : path === '/api/realtime' ? {enabled:false} : {};
      response.setHeader('Content-Type','application/json');response.end(JSON.stringify(body));return;
    }
    let file = join(root,path), data;
    try { data=await readFile(file); } catch {file=join(root,'index.html');data=await readFile(file);}
    response.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[extname(file)]||'application/octet-stream');response.end(data);
  } catch {response.writeHead(500);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await page.addInitScript(()=>{
    sessionStorage.setItem('noi-crossword-access-session-v1','1');
    sessionStorage.setItem('noi-crossword-access-session-touched-at-v1',String(Date.now()));
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/log`);
  await page.getByRole('link',{name:'Registro degli errori'}).waitFor();
  await page.evaluate(async()=>{
    console.error(new Error('diagnostic-smoke-error'));
    await fetch('/api/diagnostic-failure');
    const canvas=document.createElement('canvas');document.body.appendChild(canvas);
    canvas.dispatchEvent(new Event('webglcontextlost'));
  });
  for(let i=0;i<50&&!['console_error','http_error','webgl_context_lost'].every(kind=>reports.some(r=>r.kind===kind));i++) await new Promise(resolve=>setTimeout(resolve,100));
  const js=reports.find(r=>r.kind==='console_error'&&r.message==='diagnostic-smoke-error');
  assert.ok(js,'Errore console consegnato');assert.ok(js.stack);assert.equal(js.context.version,'local');assert.equal(js.context.viewport.width,390);
  assert.ok(reports.some(r=>r.kind==='webgl_context_lost'),'Perdita contesto rilevata');
  const http=reports.find(r=>r.kind==='http_error'&&r.context.status===500);
  assert.ok(http);assert.equal(http.requestId,'smoke-request-id');
  assert.ok(reports.length<10,'Nessun ciclo nella diagnostica');
  await page.getByRole('link',{name:'Registro degli errori'}).click();
  await page.getByRole('heading',{name:'Registro degli errori'}).waitFor();
  console.log('PASS: errori console, HTTP e WebGL consegnati nel browser mobile; contesto e correlazione presenti; registro amministrativo accessibile.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
