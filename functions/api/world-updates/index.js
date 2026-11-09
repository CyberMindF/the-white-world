import { deliverWorldUpdateEmails } from '../_shared/world-update-emails.js';
import { recordEvent } from "../_shared/events.js";
import { getAuthenticatedSession, json, readJson } from "../auth/_shared.js";
import { hasPermission } from "../_shared/permissions.js";

function adminCanWrite(session, permission) {
  return session.adminModeEnabled && hasPermission(session.user.role, permission);
}

function normalizeRoute(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const route = value.trim();
  return route.startsWith("/") && !route.startsWith("//") && route.length <= 300 ? route : undefined;
}

function updateView(row) {
  return {
    id: String(row.id),
    kind: row.kind,
    emoji: row.emoji,
    title: row.title,
    body: row.body,
    route: row.route,
    ctaLabel: row.cta_label,
    publishedAt: row.published_at,
    active: row.active === 1,
    announce: row.announce === 1,
    safe: row.safe === 1,
    seen: row.seen === 1
  };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const session = await getAuthenticatedSession(request, env);
  if (!session) return json({ error: "Accesso richiesto." }, 401);
  try {
    const includeInactive = session.adminModeEnabled && hasPermission(session.user.role, "content.edit");
    const { results } = await env.DB.prepare(
      `SELECT wu.*, CASE WHEN wu.announce = 0 OR wur.user_id IS NOT NULL THEN 1 ELSE 0 END AS seen
       FROM world_updates wu
       LEFT JOIN world_update_reads wur ON wur.update_id = wu.id AND wur.user_id = ?
       WHERE (? = 1 OR (wu.active = 1 AND datetime(wu.published_at) <= datetime('now')))
       AND (? = 0 OR wu.safe = 1)
       ORDER BY datetime(wu.published_at) DESC, wu.id DESC`
    ).bind(session.user.id, includeInactive ? 1 : 0, session.user.safeMode ? 1 : 0).all();
    waitUntil(deliverWorldUpdateEmails(env));
    return json({ updates: results.map(updateView) });
  } catch {
    return json({ error: "Non è stato possibile leggere le novità." }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const session = await getAuthenticatedSession(request, env);
  if (!session) return json({ error: "Accesso richiesto." }, 401);
  if (!adminCanWrite(session, "content.create")) return json({ error: "Attiva la Modalità admin per aggiungere una novità." }, 403);
  try {
    const body = await readJson(request);
    const kind = body?.kind === "contenuto" || body?.kind === "mondo" ? body.kind : null;
    const emoji = typeof body?.emoji === "string" ? body.emoji.trim().slice(0, 24) || "✨" : "✨";
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    const route = normalizeRoute(body?.route);
    const ctaLabel = route && typeof body?.ctaLabel === "string" ? body.ctaLabel.trim().slice(0, 60) || "Apri" : null;
    const publishedAt = typeof body?.publishedAt === "string" && Number.isFinite(Date.parse(body.publishedAt))
      ? new Date(body.publishedAt).toISOString() : new Date().toISOString();
    const announce = body?.announce === false ? 0 : 1;
    if (!kind || !title || title.length > 120 || text.length > 1000 || route === undefined) {
      return json({ error: "Controlla categoria, titolo, testo e collegamento." }, 400);
    }
    const now = new Date().toISOString();
    const row = await env.DB.prepare(
      `INSERT INTO world_updates (kind, emoji, title, body, route, cta_label, published_at, active, announce, safe, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *, 0 AS seen`
    ).bind(kind, emoji, title, text, route, ctaLabel, publishedAt, body?.active === false ? 0 : 1,
      announce, body?.safe === true ? 1 : 0, session.user.id, now, now).first();
    context.waitUntil(recordEvent(env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'world-updates', eventType: 'content_created', metadata: { id: row.id } }));
    context.waitUntil(deliverWorldUpdateEmails(env));
    return json(updateView(row), 201);
  } catch {
    return json({ error: "Non è stato possibile creare la novità." }, 500);
  }
}

export { normalizeRoute, updateView };
