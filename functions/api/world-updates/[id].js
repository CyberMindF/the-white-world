import { deliverWorldUpdateEmails } from '../_shared/world-update-emails.js';
import { recordEvent } from "../_shared/events.js";
import { getAuthenticatedSession, json, readJson } from "../auth/_shared.js";
import { hasPermission } from "../_shared/permissions.js";
import { normalizeRoute, updateView } from "./index.js";

function canWrite(session, permission) {
  return session.adminModeEnabled && hasPermission(session.user.role, permission);
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const session = await getAuthenticatedSession(request, env);
  if (!session) return json({ error: "Accesso richiesto." }, 401);
  if (!canWrite(session, "content.edit")) return json({ error: "Non autorizzato." }, 403);
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: "Novità non valida." }, 400);
  try {
    const body = await readJson(request);
    const kind = body?.kind === "contenuto" || body?.kind === "mondo" ? body.kind : null;
    const emoji = typeof body?.emoji === "string" ? body.emoji.trim().slice(0, 24) || "✨" : "✨";
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    const route = normalizeRoute(body?.route);
    const ctaLabel = route && typeof body?.ctaLabel === "string" ? body.ctaLabel.trim().slice(0, 60) || "Apri" : null;
    const publishedAt = typeof body?.publishedAt === "string" && Number.isFinite(Date.parse(body.publishedAt))
      ? new Date(body.publishedAt).toISOString() : null;
    const announce = body?.announce === false ? 0 : 1;
    if (!kind || !title || title.length > 120 || text.length > 1000 || route === undefined || !publishedAt) {
      return json({ error: "Controlla i dati della novità." }, 400);
    }
    const row = await env.DB.prepare(
      `UPDATE world_updates SET kind = ?, emoji = ?, title = ?, body = ?, route = ?, cta_label = ?,
       published_at = ?, active = ?, announce = ?, safe = ?, updated_at = ? WHERE id = ? RETURNING *, 0 AS seen`
    ).bind(kind, emoji, title, text, route, ctaLabel, publishedAt, body?.active === false ? 0 : 1,
      announce, body?.safe === true ? 1 : 0, new Date().toISOString(), id).first();
    if (row) context.waitUntil(recordEvent(env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'world-updates', eventType: 'content_updated', metadata: { id: row.id } }));
  if (row) context.waitUntil(deliverWorldUpdateEmails(env));
  return row ? json(updateView(row)) : json({ error: "Novità non trovata." }, 404);
  } catch {
    return json({ error: "Non è stato possibile aggiornare la novità." }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const session = await getAuthenticatedSession(request, env);
  if (!session) return json({ error: "Accesso richiesto." }, 401);
  if (!canWrite(session, "content.delete")) return json({ error: "Non autorizzato." }, 403);
  const result = await env.DB.prepare("DELETE FROM world_updates WHERE id = ?").bind(Number(params.id)).run();
  if (result.meta.changes === 1) context.waitUntil(recordEvent(env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'world-updates', eventType: 'content_deleted', metadata: { id: Number(params.id) } }));
  return result.meta.changes === 1 ? json({ ok: true }) : json({ error: "Novità non trovata." }, 404);
}
