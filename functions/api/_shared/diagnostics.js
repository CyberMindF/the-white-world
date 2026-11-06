// Non salva corpi HTTP, cookie, header di autenticazione o query string.
export function cleanDiagnosticText(value, limit = 2000) {
  return String(value ?? '').slice(0, limit)
    .replace(/https?:\/\/[^\s"'<>]+/gi, value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return '[url]'; } })
    .replace(/\b(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/((?:password|token|authorization|cookie|worldKey)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
}

const CONTEXT_FIELDS = new Set(['version','pageId','uptimeMs','visibility','online','language','timezone','userAgent','platform','model','platformVersion','fullVersionList','mobile','deviceMemory','hardwareConcurrency','maxTouchPoints','screen','viewport','dpr','connection','reducedMotion','theme','effects','graphics','breadcrumbs','observedIdentity','method','status','durationMs','resource','line','column','code','reason','cfRay','deployment','requestPath']);
export function cleanDiagnosticContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const clean = (value, depth = 0) => {
    if (depth > 4) return null;
    if (typeof value === 'string') return cleanDiagnosticText(value, 600);
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || value === null) return value;
    if (Array.isArray(value)) return value.slice(0, 20).map(item => clean(item, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).filter(([key]) => !/password|token|cookie|authorization|body|draft|email/i.test(key)).map(([key, v]) => [key.slice(0, 60), clean(v, depth + 1)]));
    return null;
  };
  return Object.fromEntries(Object.entries(input).filter(([key]) => CONTEXT_FIELDS.has(key)).map(([key, value]) => [key, clean(value)]));
}

export async function saveDiagnostic(context, event, session = null) {
  const { request, env } = context;
  const now = new Date().toISOString();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  // Hash giornaliero usato solo per contenere raffiche; nessun IP in chiaro nel registro.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(now.slice(0, 10) + ':' + ip));
  const rateKey = Array.from(new Uint8Array(digest)).map(n => n.toString(16).padStart(2, '0')).join('');
  const id = /^[a-zA-Z0-9-]{8,80}$/.test(event.id || '') ? event.id : crypto.randomUUID();
  const occurred = Date.parse(event.occurredAt);
  const occurredAt = Number.isFinite(occurred) && Math.abs(Date.now() - occurred) < 7 * 86400000 ? new Date(occurred).toISOString() : now;
  const path = cleanDiagnosticText(String(event.path || new URL(request.url).pathname).split(/[?#]/)[0], 500);
  const details = cleanDiagnosticContext(event.context);
  const observed = details.observedIdentity;
  // Una consegna ritardata dopo cambio utente non viene attribuita al nuovo utente.
  if (event.source !== 'server' && observed && Object.hasOwn(observed, 'actorId') &&
      observed.actorId !== (session?.impersonation?.actorId ?? session?.user.id ?? null)) session = null;
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO diagnostic_errors
    (id,source,kind,message,stack,occurred_at,received_at,actor_user_id,effective_user_id,session_id,request_id,path,user_agent,context_json,rate_key)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    WHERE (SELECT COUNT(*) FROM diagnostic_errors WHERE rate_key=? AND received_at>=?) < 120`)
    .bind(id, event.source === 'server' ? 'server' : 'browser', cleanDiagnosticText(event.kind, 80),
      cleanDiagnosticText(event.message), cleanDiagnosticText(event.stack, 6000), occurredAt, now,
      session?.impersonation?.actorId ?? session?.user.id ?? null, session?.user.id ?? null, session?.sessionId ?? null,
      cleanDiagnosticText(event.requestId, 100), path, cleanDiagnosticText(request.headers.get('User-Agent'), 512), JSON.stringify(details), rateKey,
      rateKey, new Date(Date.now() - 3600000).toISOString()).run();
  // Pulizia limitata e indicizzata: non scansiona/elimina l'intero storico a ogni errore.
  await env.DB.prepare('DELETE FROM diagnostic_errors WHERE id IN (SELECT id FROM diagnostic_errors WHERE received_at < ? ORDER BY received_at LIMIT 100)')
    .bind(new Date(Date.now() - 30 * 86400000).toISOString()).run();
  return { id, saved: result.meta.changes > 0 };
}

export async function readDiagnosticBody(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 24000) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}
