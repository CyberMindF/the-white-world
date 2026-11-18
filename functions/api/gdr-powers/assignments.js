import { json, readJson } from '../auth/_shared.js';
import { masterSession } from './index.js';
import { validId, WorkspaceError, failure } from '../gdr-workspace/_shared.js';
import { recordEvent } from '../_shared/events.js';
import { notifyRealtime } from '../_shared/realtime.js';

export async function onRequestPut(context) {
  try {
    const session = await masterSession(context);
    const body = await readJson(context.request);
    if (!body || !validId(body.characterId) || !Number.isSafeInteger(body.revision) ||
        !Array.isArray(body.powerIds) || body.powerIds.length > 200 ||
        body.powerIds.some(id => !validId(id)) || new Set(body.powerIds).size !== body.powerIds.length)
      throw new WorkspaceError('Assegnazioni non valide.', 400);
    const db = context.env.DB.withSession('first-primary');
    const character = await db.prepare('SELECT adventure_id FROM gdr_workspace_characters WHERE id=?').bind(body.characterId).first();
    if (!character) throw new WorkspaceError('Personaggio non trovato.', 404);
    // La stessa condizione protegge tutta la batch, anche se il catalogo cambia nel frattempo.
    const guard = `EXISTS(SELECT 1 FROM gdr_workspace_characters c WHERE c.id=? AND c.revision=?
      AND NOT EXISTS(SELECT 1 FROM json_each(?) selected WHERE NOT EXISTS(
        SELECT 1 FROM gdr_power_availability a WHERE a.power_id=selected.value AND a.adventure_id=c.adventure_id)))`;
    const bindings = [body.characterId, body.revision, JSON.stringify(body.powerIds)];
    const results = await db.batch([
      db.prepare(`DELETE FROM gdr_character_powers WHERE character_id=? AND ${guard}`).bind(body.characterId, ...bindings),
      db.prepare(`INSERT INTO gdr_character_powers(character_id,power_id) SELECT ?,value FROM json_each(?) WHERE ${guard}`)
        .bind(body.characterId, JSON.stringify(body.powerIds), ...bindings),
      db.prepare(`UPDATE gdr_workspace_characters SET revision=revision+1 WHERE id=? AND ${guard}`).bind(body.characterId, ...bindings),
    ]);
    if (!results.at(-1).meta.changes)
      throw new WorkspaceError('Il personaggio o il catalogo sono cambiati. Annulla e riapri la selezione per ricaricare i dati; la scelta resta disponibile.', 409);
    context.waitUntil(recordEvent(context.env, { userId: session.user.id, sessionId: session.sessionId },
      { section: 'gdr', eventType: 'content_updated', metadata: { characterId: body.characterId } }));
    context.waitUntil(notifyRealtime(context.env, { type: 'gdr-story:changed', action: 'powers_updated', actorUserId: session.user.id, adventure: character.adventure_id }));
    return json({ saved: true, revision: body.revision + 1 });
  } catch (error) {
    return failure(error, 'gdr_power_assignments_error');
  }
}
