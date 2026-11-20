// Dopo npm run build. API simulate: nessuna pubblicazione o email reale.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('web/dist/web/browser');
let updates, admin, writes, seen;
function reset() {
  admin = true; writes = []; seen = [];
  updates = [
    { id: '1', kind: 'mondo', emoji: '✨', title: 'Una novità pubblicata', body: 'Già disponibile.', route: null, ctaLabel: null, publishedAt: '2026-01-01T12:00:00Z', active: true, announce: true, safe: true, seen: true },
    { id: '2', kind: 'mondo', emoji: '✨', title: 'Una novità da preparare', body: 'Un annuncio di prova da completare prima della pubblicazione.', route: '/novita', ctaLabel: 'Apri le novità', publishedAt: '2026-01-02T12:00:00Z', active: false, announce: true, safe: true, seen: false },
  ];
}
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://test').pathname;
    if (path.startsWith('/api/')) {
      let payload = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        if (raw) payload = JSON.parse(raw);
      }
      let body = {};
      if (path === '/api/auth/session') body = { authenticated: true, adminModeEnabled: admin, user: { id: 1, nickname: 'Master', email: 'master@example.test', identity: 'lui', role: 'admin', isTest: false, safeMode: false } };
      else if (path === '/api/auth/admin-mode') { admin = payload.enabled; body = { adminModeEnabled: admin }; }
      else if (path === '/api/world-updates/seen') { seen.push(...payload.ids); body = { ok: true }; }
      else if (path === '/api/world-updates' && req.method === 'POST') {
        writes.push(payload); const update = { ...payload, id: String(updates.length + 1), seen: false };
        updates.push(update); body = update;
      } else if (path.startsWith('/api/world-updates/') && req.method === 'PUT') {
        writes.push(payload); const id = path.split('/').at(-1);
        updates = updates.map(update => update.id === id ? { ...update, ...payload } : update);
        body = updates.find(update => update.id === id);
      } else if (path === '/api/world-updates') body = { updates: updates.filter(update => admin || update.active) };
      else if (path === '/api/world-promos') body = { campaigns: [], promosEnabled: true };
      else if (path === '/api/realtime') body = { enabled: false };
      else if (path === '/api/world-settings') body = { settings: { hearts: false }, values: { theme: 'love' } };
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return;
    }
    let file = join(root, path), data;
    try { data = await readFile(file); } catch { file = join(root, 'index.html'); data = await readFile(file); }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' })[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  for (const width of [390, 1280]) {
    reset();
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      sessionStorage.setItem('noi-crossword-access-session-v1', '1');
      sessionStorage.setItem('noi-crossword-access-session-touched-at-v1', String(Date.now()));
    });
    await page.goto(base + '/novita');
    const drafts = page.getByRole('region', { name: 'Bozze · 1', exact: true });
    await drafts.getByRole('heading', { name: updates[1].title, exact: true }).waitFor();
    assert.equal(await page.locator('.updates-timeline').getByText(updates[1].title, { exact: true }).count(), 0);
    assert.equal(seen.includes('2'), false);
    await page.screenshot({ path: `/tmp/news-drafts-${width}.png`, fullPage: true });
    await drafts.getByRole('button', { name: 'Modifica', exact: true }).click();
    await page.locator('[name="updateActive"]:not(:checked)').waitFor();
    assert.equal(await page.getByLabel('Pubblicata', { exact: true }).isChecked(), false);
    await page.getByLabel('Descrizione', { exact: true }).fill('Bozza aggiornata senza pubblicarla.');
    await page.getByRole('button', { name: 'Salva bozza', exact: true }).click();
    await drafts.getByText('Bozza aggiornata senza pubblicarla.', { exact: true }).waitFor();
    assert.equal(writes[0].active, false);
    await page.reload();
    await drafts.getByText('Bozza aggiornata senza pubblicarla.', { exact: true }).waitFor();
    await drafts.getByRole('button', { name: 'Modifica', exact: true }).click();
    await page.locator('[name="updateActive"]:not(:checked)').waitFor();
    await page.getByLabel('Pubblicata', { exact: true }).check();
    await page.getByRole('button', { name: 'Salva modifiche', exact: true }).click();
    await page.locator('.updates-timeline').getByRole('heading', { name: updates[1].title, exact: true }).waitFor();
    await page.getByText('Nessuna bozza salvata.', { exact: true }).waitFor();
    assert.equal(writes[1].active, true);
    await page.getByRole('button', { name: '+ Nuova voce', exact: true }).click();
    await page.getByLabel('Titolo', { exact: true }).first().fill('Altra bozza');
    await page.getByLabel('Pubblicata', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Salva bozza', exact: true }).click();
    await page.locator('.draft-list').getByRole('heading', { name: 'Altra bozza', exact: true }).waitFor();
    assert.equal(writes[2].active, false);
    assert.equal(seen.includes('3'), false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Nessuno scorrimento orizzontale');
    admin = false; await page.reload();
    await page.getByRole('heading', { name: 'Le Novità', exact: true }).waitFor();
    assert.equal(await page.locator('.draft-list').count(), 0);
    assert.equal(await page.getByText('Altra bozza', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Novità: elenco bozze riservato all’admin, modifica, salvataggio, ricaricamento e pubblicazione verificati a 390 e 1280 px.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
