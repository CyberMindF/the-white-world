import { recordEvent } from "../_shared/events.js";
import { hasPermission } from "../_shared/permissions.js";
import { getAuthenticatedSession, json, readJson } from "./_shared.js";

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const session = await getAuthenticatedSession(request, env);
    if (!session?.adminModeEnabled || !hasPermission(session.user.role, "users.manage")) {
      return json({ error: "Non autorizzato." }, 403);
    }
    const body = await readJson(request);
    const userId = Number(body?.userId);
    if (!Number.isInteger(userId) || userId <= 0 || typeof body?.enabled !== "boolean") {
      return json({ error: "Dati non validi." }, 400);
    }
    const result = await env.DB.prepare(
      "UPDATE users SET admin_email_updates = ?, updated_at = ? WHERE id = ? AND is_activated = 1 AND is_test = 0"
    ).bind(body.enabled ? 1 : 0, new Date().toISOString(), userId).run();
    if (!result.meta.changes) return json({ error: "Account non trovato." }, 404);
    context.waitUntil(recordEvent(context.env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'auth', eventType: 'account_setting_changed', metadata: { targetUserId: userId, setting: 'admin_email_updates', enabled: body.enabled } }));
    return json({ userId, enabled: body.enabled });
  } catch {
    return json({ error: "Non è stato possibile aggiornare gli invii automatici." }, 500);
  }
}
