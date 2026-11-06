import { recordEvent } from "../_shared/events.js";
import { getAuthenticatedSession, json, readJson } from "../auth/_shared.js";
import { hasPermission } from "../_shared/permissions.js";

const LABELS = new Set(["commerciale", "consiglia", "sponsor", "promozionale"]);
const PLACEMENTS = new Set(["automatico", "lato", "alto", "basso"]);
const TARGETS = new Set(["tutti", "lui", "lei"]);

function normalizeRoute(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const route = value.trim();
  return route.startsWith("/") && !route.startsWith("//") && route.length <= 300 ? route : undefined;
}

function promoView(row) {
  return {
    id: String(row.id), label: row.label, emoji: row.emoji, title: row.title, body: row.body,
    route: row.route, ctaLabel: row.cta_label, placement: row.placement,
    targetIdentity: row.target_identity, cooldownDays: row.cooldown_days, active: row.active === 1
  };
}

function normalizedPromo(body) {
  const label = LABELS.has(body?.label) ? body.label : null;
  const placement = PLACEMENTS.has(body?.placement) ? body.placement : null;
  const targetIdentity = TARGETS.has(body?.targetIdentity) ? body.targetIdentity : null;
  const emoji = typeof body?.emoji === "string" ? body.emoji.trim().slice(0, 24) || "📣" : "📣";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  const route = normalizeRoute(body?.route);
  const ctaLabel = route && typeof body?.ctaLabel === "string" ? body.ctaLabel.trim().slice(0, 60) || "Apri" : null;
  const cooldownDays = Number(body?.cooldownDays);
  if (!label || !placement || !targetIdentity || !title || title.length > 120 || !text || text.length > 1200
    || route === undefined || !Number.isInteger(cooldownDays) || cooldownDays < 1 || cooldownDays > 365) return null;
  return { label, placement, targetIdentity, emoji, title, text, route, ctaLabel, cooldownDays, active: body?.active === false ? 0 : 1 };
}

async function globalPromosEnabled(env) {
  const setting = await env.DB.prepare(
    "SELECT enabled FROM world_settings WHERE key = 'promos'"
  ).first();
  // Compatibilita con database sui quali la nuova migration non e ancora stata applicata.
  return setting?.enabled !== 0;
}

export async function onRequestGet({ request, env }) {
  const session = await getAuthenticatedSession(request, env);
  if (!session) return json({ error: "Accesso richiesto." }, 401);
  try {
    const url = new URL(request.url);
    const currentPath = url.searchParams.get("path") || "";
    const admin = session.adminModeEnabled && hasPermission(session.user.role, "content.edit");
    const promosEnabled = await globalPromosEnabled(env);
    const campaigns = admin
      ? (await env.DB.prepare("SELECT * FROM world_promos ORDER BY id DESC").all()).results.map(promoView)
      : undefined;

    // Una sola pubblicità al giorno in tutto il sito, e la stessa campagna rispetta anche il
    // proprio intervallo. ORDER BY random distribuisce le campagne senza profilazione.
    let promo = null;
    if (promosEnabled) {
      const recent = await env.DB.prepare(
        "SELECT MAX(last_seen_at) AS last_seen_at FROM world_promo_views WHERE user_id = ?"
      ).bind(session.user.id).first();
      if (!recent?.last_seen_at || Date.now() - Date.parse(recent.last_seen_at) >= 24 * 60 * 60 * 1000) {
        const row = await env.DB.prepare(
          `SELECT p.* FROM world_promos p
           LEFT JOIN world_promo_views pv ON pv.promo_id = p.id AND pv.user_id = ?
           WHERE p.active = 1
             AND (p.target_identity = 'tutti' OR p.target_identity = ?)
             AND (p.route IS NULL OR p.route != ?)
             AND (pv.last_seen_at IS NULL OR unixepoch('now') - unixepoch(pv.last_seen_at) >= p.cooldown_days * 86400)
           ORDER BY random() LIMIT 1`
        ).bind(session.user.id, session.user.identity, currentPath).first();
        promo = row ? promoView(row) : null;
      }
    }
    return json({ promo, ...(campaigns ? { campaigns, promosEnabled } : {}) });
  } catch {
    return json({ error: "Non è stato possibile scegliere lo sponsor di oggi." }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const session = await getAuthenticatedSession(request, env);
  if (!session) return json({ error: "Accesso richiesto." }, 401);
  if (!session.adminModeEnabled || !hasPermission(session.user.role, "content.edit")) {
    return json({ error: "Attiva la Modalità admin per cambiare questa impostazione." }, 403);
  }
  const body = await readJson(request);
  if (typeof body?.enabled !== "boolean") {
    return json({ error: "Impostazione non valida." }, 400);
  }
  try {
    const enabled = body.enabled ? 1 : 0;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO world_settings (key, enabled, value, updated_by, updated_at)
       VALUES ('promos', ?, NULL, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         enabled = excluded.enabled,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`
    ).bind(enabled, session.user.id, now).run();
    context.waitUntil(recordEvent(env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'world-promos', eventType: 'world_setting_changed', metadata: { setting: 'promos_enabled', enabled: body.enabled } }));
    return json({ promosEnabled: body.enabled });
  } catch {
    return json({ error: "Non è stato possibile aggiornare le pubblicità." }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const session = await getAuthenticatedSession(request, env);
  if (!session) return json({ error: "Accesso richiesto." }, 401);
  if (!session.adminModeEnabled || !hasPermission(session.user.role, "content.create")) {
    return json({ error: "Attiva la Modalità admin per creare una campagna." }, 403);
  }
  const value = normalizedPromo(await readJson(request));
  if (!value) return json({ error: "Controlla i dati della pubblicità." }, 400);
  try {
    const now = new Date().toISOString();
    const row = await env.DB.prepare(
      `INSERT INTO world_promos
       (label, emoji, title, body, route, cta_label, placement, target_identity, cooldown_days, active, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(value.label, value.emoji, value.title, value.text, value.route, value.ctaLabel, value.placement,
      value.targetIdentity, value.cooldownDays, value.active, session.user.id, now, now).first();
    context.waitUntil(recordEvent(env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'world-promos', eventType: 'content_created', metadata: { id: row.id } }));
    return json(promoView(row), 201);
  } catch {
    return json({ error: "Non è stato possibile creare la pubblicità." }, 500);
  }
}

export { normalizedPromo, promoView };
