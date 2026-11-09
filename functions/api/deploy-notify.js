import { deliverWorldUpdateEmails } from './_shared/world-update-emails.js';
import { json } from './auth/_shared.js';
import { notifyRealtime } from './_shared/realtime.js';

// Chiamato dal workflow soltanto dopo che build-version.json espone il nuovo commit sul dominio.
export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null);
  const version = typeof body?.version === 'string' ? body.version.trim() : '';
  if (!/^[a-f0-9]{40}$/i.test(version)) {
    return json({ error: 'Versione non valida.' }, 400);
  }

  // L'endpoint non si fida del chiamante: annuncia soltanto la versione che Pages sta
  // realmente servendo in questo momento. Ripetere la chiamata è innocuo, perché i client
  // ignorano sia la propria versione sia un avviso già mostrato.
  const versionUrl = new URL('/build-version.json', context.request.url);
  versionUrl.searchParams.set('t', Date.now().toString());
  const publishedResponse = await fetch(versionUrl, { headers: { Accept: 'application/json' } });
  const published = publishedResponse.ok ? await publishedResponse.json().catch(() => null) : null;
  if (published?.version !== version) {
    return json({ error: 'Questa versione non è quella attualmente pubblicata.' }, 409);
  }

  const delivered = await notifyRealtime(context.env, {
    type: 'site-version:changed',
    version
  });
  const emails = await deliverWorldUpdateEmails(context.env);
  return json({ ok: true, delivered, emails });
}
