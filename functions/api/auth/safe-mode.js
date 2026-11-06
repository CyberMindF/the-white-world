import { recordEvent } from "../_shared/events.js";
import { getAuthenticatedSession, json, readJson } from './_shared.js';

// Preferenza personale: nessuna modifica alle impostazioni condivise del mondo.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const session = await getAuthenticatedSession(request, env);
    if (!session) return json({ error: 'Accesso richiesto.' }, 401);
    const body = await readJson(request);
    if (typeof body?.enabled !== 'boolean') return json({ error: 'Scelta non valida.' }, 400);
    const statements = [env.DB.prepare('UPDATE users SET safe_mode = ?, updated_at = ? WHERE id = ?')
      .bind(body.enabled ? 1 : 0, new Date().toISOString(), session.user.id)];
    // Anche le altre sessioni dello stesso utente devono uscire dalla modalità admin.
    // La seconda condizione gestisce chi era già in safe mode con il vecchio codice.
    if (body.enabled || session.user.safeMode) {
      statements.push(env.DB.prepare('UPDATE sessions SET admin_mode_enabled = 0 WHERE user_id = ?')
        .bind(session.user.id));
    }
    await env.DB.batch(statements);
    if (body.enabled !== session.user.safeMode) context.waitUntil(recordEvent(env,
      { userId: session.user.id, sessionId: session.sessionId },
      { section: 'auth', eventType: 'safe_mode_changed', metadata: { enabled: body.enabled, previous: session.user.safeMode } }));
    return json({ safeMode: body.enabled });
  } catch {
    return json({ error: 'Non è stato possibile salvare la safe mode.' }, 500);
  }
}
