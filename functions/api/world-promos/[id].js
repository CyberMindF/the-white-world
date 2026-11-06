import { recordEvent } from "../_shared/events.js";
import { getAuthenticatedSession, json, readJson } from "../auth/_shared.js";
import { hasPermission } from "../_shared/permissions.js";
import { normalizedPromo, promoView } from "./index.js";

function canWrite(session, permission) {
  return session.adminModeEnabled && hasPermission(session.user.role, permission);
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const session = await getAuthenticatedSession(request, env);
  if (!session) return json({ error: "Accesso richiesto." }, 401);
  if (!canWrite(session, "content.edit")) return json({ error: "Non autorizzato." }, 403);
  const value = normalizedPromo(await readJson(request));
  if (!value) return json({ error: "Controlla i dati della pubblicità." }, 400);
  const row = await env.DB.prepare(
    `UPDATE world_promos SET label = ?, emoji = ?, title = ?, body = ?, route = ?, cta_label = ?,
     placement = ?, target_identity = ?, cooldown_days = ?, active = ?, updated_at = ?
     WHERE id = ? RETURNING *`
  ).bind(value.label, value.emoji, value.title, value.text, value.route, value.ctaLabel, value.placement,
    value.targetIdentity, value.cooldownDays, value.active, new Date().toISOString(), Number(params.id)).first();
  if (row) context.waitUntil(recordEvent(env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'world-promos', eventType: 'content_updated', metadata: { id: row.id } }));
  return row ? json(promoView(row)) : json({ error: "Pubblicità non trovata." }, 404);
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const session = await getAuthenticatedSession(request, env);
  if (!session) return json({ error: "Accesso richiesto." }, 401);
  if (!canWrite(session, "content.delete")) return json({ error: "Non autorizzato." }, 403);
  const result = await env.DB.prepare("DELETE FROM world_promos WHERE id = ?").bind(Number(params.id)).run();
  if (result.meta.changes === 1) context.waitUntil(recordEvent(env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'world-promos', eventType: 'content_deleted', metadata: { id: Number(params.id) } }));
  return result.meta.changes === 1 ? json({ ok: true }) : json({ error: "Pubblicità non trovata." }, 404);
}
