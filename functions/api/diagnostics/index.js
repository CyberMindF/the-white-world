import { getAuthenticatedSession, json } from '../auth/_shared.js';
import { hasPermission } from '../_shared/permissions.js';
import { cleanDiagnosticText, readDiagnosticBody, saveDiagnostic } from '../_shared/diagnostics.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'Origine non consentita.' }, 403);
  const body = await readDiagnosticBody(request);
  if (!body || typeof body.message !== 'string' || typeof body.kind !== 'string' || !body.kind) return json({ error: 'Diagnostica non valida.' }, 400);
  try {
    const session = await getAuthenticatedSession(request, env);
    const result = await saveDiagnostic(context, { ...body, source: 'browser' }, session);
    // Un duplicato è già consegnato; il client non deve ritentare all'infinito.
    return json(result, 202);
  } catch {
    return json({ error: 'Diagnostica temporaneamente non disponibile.' }, 503);
  }
}

export async function onRequestGet(context) {
  const session = await getAuthenticatedSession(context.request, context.env);
  if (!session || !hasPermission(session.user.role, 'events.view')) return json({ error: 'Non autorizzato.' }, 403);
  const params = new URL(context.request.url).searchParams;
  const before = params.get('before');
  const kind = cleanDiagnosticText(params.get('kind') || '', 80);
  const actor = Number(params.get('actor'));
  const clauses = [], values = [];
  if (before) {
    const [date, id] = before.split('|');
    if (Number.isFinite(Date.parse(date)) && /^[a-zA-Z0-9-]{8,80}$/.test(id || '')) {
      clauses.push('(received_at < ? OR (received_at = ? AND id < ?))');
      const timestamp = new Date(date).toISOString(); values.push(timestamp, timestamp, id);
    }
  }
  if (kind) { clauses.push('kind = ?'); values.push(kind); }
  if (Number.isInteger(actor) && actor > 0) { clauses.push('actor_user_id = ?'); values.push(actor); }
  const { results } = await context.env.DB.prepare(`SELECT id,source,kind,message,stack,occurred_at,received_at,actor_user_id,effective_user_id,session_id,request_id,path,user_agent,context_json FROM diagnostic_errors ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY received_at DESC, id DESC LIMIT 50`).bind(...values).all();
  return json({ errors: results.map(row => ({ ...row, context: JSON.parse(row.context_json), context_json: undefined })), nextBefore: results.length === 50 ? results.at(-1).received_at + '|' + results.at(-1).id : null });
}
