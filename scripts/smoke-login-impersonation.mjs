// API simulate e chiave fittizia: nessun accesso o invio su account reali.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('web/dist/web/browser');
const actor = { id: 1, nickname: 'Rory', email: 'admin@example.test', identity: 'lui', role: 'admin', isTest: false, safeMode: true };
const target = { ...actor, id: 2, nickname: 'Desy', identity: 'lei', role: 'member' };
let impersonating = true;
let safeWrites = 0;
const writes = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://test');
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      let body = { saved: true };
      if (url.pathname === '/api/auth/session') {
        if (req.method === 'POST') {
          let raw = ''; for await (const chunk of req) raw += chunk;
          const payload = JSON.parse(raw); writes.push(payload);
          if (payload.worldKey !== 'test-key') {
            res.writeHead(403); res.end(JSON.stringify({ error: 'Chiave del Mondo non valida.' })); return;
          }
          assert.equal(payload.access, true); impersonating = false;
        }
        const effective = impersonating && url.searchParams.get('access') !== '1';
        body = { authenticated: true, user: effective ? target : actor, adminModeEnabled: false,
          accessImpersonationActive: url.searchParams.get('access') === '1' && impersonating,
          impersonation: effective ? { actorId: 1, actorNickname: 'Rory', readOnly: false } : null };
      } else if (url.pathname === '/api/auth/safe-mode') {
        assert.equal(impersonating, false);
        let raw = ''; for await (const chunk of req) raw += chunk;
        actor.safeMode = JSON.parse(raw).enabled; safeWrites++;
      } else if (url.pathname === '/api/world-settings') body = { settings: {}, values: {} };
      else if (url.pathname === '/api/realtime') body = { enabled: false };
      else if (url.pathname === '/api/gdr-workspace') body = { adventures: [], characters: [], grants: [], users: [], isMaster: false };
      else if (url.pathname === '/api/world-updates') body = { updates: [] };
      else if (url.pathname === '/api/ponti-chat') body = { messages: [], unreadCount: 0 };
      res.end(JSON.stringify(body)); return;
    }
    const path = resolve(root, '.' + url.pathname);
    assert.ok(path.startsWith(root + '/') || path === root);
    let file;
    try { file = await readFile(path); } catch { file = await readFile(resolve(root, 'index.html')); }
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', mime[extname(path)] || 'text/html'); res.end(file);
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const initialPath of ['/login', '/tavolo-da-gioco/gdr']) {
    impersonating = true; writes.length = 0; safeWrites = 0; actor.safeMode = true;
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(origin + initialPath);
    await page.waitForSelector('input[name="worldKey"]');
    await page.waitForFunction(() => !document.querySelector('input[name="email"]'));
    assert.equal(await page.locator('.impersonation-banner').count(), 0);
    await page.getByRole('switch', { name: 'Safe mode' }).click();
    assert.equal(safeWrites, 0);
    await page.locator('input[name="worldKey"]').fill('wrong');
    await page.locator('#access-submit-button').click();
    await page.waitForFunction(() => document.querySelector('#access-error')?.textContent.includes('non valida'));
    assert.equal(impersonating, true);
    await page.locator('input[name="worldKey"]').fill('test-key');
    await page.locator('#access-submit-button').click();
    await page.waitForURL(url => url.pathname !== '/login');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.impersonation-banner').count(), 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('noi-crossword-access-session-v1')), '1');
    assert.equal(impersonating, false); assert.equal(writes.length, 2);
    assert.equal(safeWrites, 1); assert.equal(actor.safeMode, false);
    await page.reload(); await page.waitForLoadState('networkidle');
    assert.notEqual(new URL(page.url()).pathname, '/login');
    await context.close();
  }
  // Un'impersonazione esplicita già sbloccata continua a funzionare nelle pagine protette.
  impersonating = true;
  const context = await browser.newContext();
  await context.addInitScript(() => {
    sessionStorage.setItem('noi-crossword-access-session-v1', '1');
    sessionStorage.setItem('noi-crossword-access-session-touched-at-v1', String(Date.now()));
  });
  const page = await context.newPage(); await page.goto(origin + '/tavolo-da-gioco/gdr');
  await page.waitForSelector('.impersonation-banner');
  assert.match(await page.locator('.impersonation-banner').innerText(), /Stai impersonando Desy/);
  assert.notEqual(new URL(page.url()).pathname, '/login');
  await context.close(); console.log('Login: accesso diretto e da rotta protetta, chiave errata/corretta, reload e impersonazione esplicita OK.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
