import { recordEvent } from "../_shared/events.js";
import { hasPermission } from "../_shared/permissions.js";
import { getAuthenticatedSession, json, readJson } from "./_shared.js";

function canManage(session) {
  return session?.adminModeEnabled && hasPermission(session.user.role, "users.manage");
}

export async function onRequestGet(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!canManage(session)) return json({ error: "Non autorizzato." }, 403);
    const { results } = await context.env.DB.prepare(`
      SELECT id, email, nickname, identity, is_test, activity_logging_enabled, admin_email_updates, notify_email_updates, notify_email_copies
      FROM users
      WHERE is_activated = 1
      ORDER BY is_test ASC, nickname COLLATE NOCASE, id
    `).all();
    return json({ users: results });
  } catch (error) {
    console.error(JSON.stringify({ event: "activity_logging_list_error", message: error.message }));
    return json({ error: "Non è stato possibile leggere le impostazioni di logging." }, 500);
  }
}

export async function onRequestPut(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!canManage(session)) return json({ error: "Non autorizzato." }, 403);
    const body = await readJson(context.request);
    const userId = Number(body?.userId);
    if (!Number.isInteger(userId) || userId <= 0 || typeof body?.enabled !== "boolean") {
      return json({ error: "Dati non validi." }, 400);
    }
    const result = await context.env.DB
      .prepare("UPDATE users SET activity_logging_enabled = ?, updated_at = ? WHERE id = ? AND is_activated = 1")
      .bind(body.enabled ? 1 : 0, new Date().toISOString(), userId)
      .run();
    if (!result.meta.changes) return json({ error: "Account non trovato." }, 404);
    context.waitUntil(recordEvent(context.env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'auth', eventType: 'account_setting_changed', metadata: { targetUserId: userId, setting: 'activity_logging_enabled', enabled: body.enabled } }));
    return json({ userId, enabled: body.enabled });
  } catch (error) {
    console.error(JSON.stringify({ event: "activity_logging_update_error", message: error.message }));
    return json({ error: "Non è stato possibile aggiornare il logging." }, 500);
  }
}
