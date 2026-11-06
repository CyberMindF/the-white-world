import { getAuthenticatedSession } from './api/auth/_shared.js';
import { readDiagnosticBody, saveDiagnostic } from './api/_shared/diagnostics.js';

// Copre anche i 500 gestiti dai singoli endpoint; il messaggio originale delle eccezioni
// non gestite è conservato senza includere il corpo della richiesta.
export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  if (!path.startsWith('/api/') || path.startsWith('/api/diagnostics')) return context.next();
  const requestId = crypto.randomUUID();
  const started = Date.now();
  let response, failure;
  try { response = await context.next(); }
  catch (error) { failure = error; response = Response.json({ error: 'Errore interno del server.', requestId }, { status: 500 }); }
  if (response.status >= 500) {
    const diagnosticResponse = failure ? null : response.clone();
    context.waitUntil((async () => {
      let session = null;
      try { session = await getAuthenticatedSession(context.request, context.env); } catch { /* Auth può essere la causa del 500. */ }
      const body = diagnosticResponse ? await readDiagnosticBody(diagnosticResponse) : null;
      await saveDiagnostic(context, {
        source: 'server', kind: failure ? 'server_exception' : 'server_http_error',
        message: failure instanceof Error ? failure.message : typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`, stack: failure instanceof Error ? failure.stack : '',
        path, requestId, context: { method: context.request.method, status: response.status, durationMs: Date.now() - started, cfRay: context.request.headers.get('CF-Ray'), deployment: context.env.CF_PAGES_COMMIT_SHA || 'unknown' },
      }, session);
    })().catch(() => console.error('diagnostic_server_write_failed', { requestId, path })));
  }
  const headers = new Headers(response.headers); headers.set('X-Request-Id', requestId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
