import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('il middleware conserva upgrade, messaggi WebSocket e risposte HTTP', async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../functions/_middleware.js', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser'
  });
  const runtime = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text + `
      export default {
        fetch(request, env, ctx) {
          return onRequest({ request, env, waitUntil: ctx.waitUntil.bind(ctx), next: async () => {
            if (request.headers.get('Upgrade') !== 'websocket') {
              return new Response('ok', { headers: { 'X-Upstream': 'preserved' } });
            }
            const [client, server] = Object.values(new WebSocketPair());
            server.accept();
            server.addEventListener('message', event => server.send('echo:' + event.data));
            return new Response(null, { status: 101, webSocket: client });
          }});
        }
      }`
  });
  let socket;
  try {
    const upgrade = await runtime.dispatchFetch('https://test/api/realtime', {
      headers: { Upgrade: 'websocket' }
    });
    assert.equal(upgrade.status, 101);
    socket = upgrade.webSocket;
    assert.ok(socket, 'la risposta conserva il canale WebSocket');
    socket.accept();
    const reply = new Promise(resolve => socket.addEventListener('message', event => resolve(event.data), { once: true }));
    socket.send('presence');
    assert.equal(await reply, 'echo:presence');

    const http = await runtime.dispatchFetch('https://test/api/realtime');
    assert.equal(http.status, 200);
    assert.equal(await http.text(), 'ok');
    assert.equal(http.headers.get('X-Upstream'), 'preserved');
    assert.ok(http.headers.get('X-Request-Id'));
  } finally {
    socket?.close(1000, 'Test completed');
    await runtime.dispose();
  }
});
