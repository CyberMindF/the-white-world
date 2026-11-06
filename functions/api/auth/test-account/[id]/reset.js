import { recordEvent } from "../../../_shared/events.js";
import { hasPermission } from "../../../_shared/permissions.js";
import { getAuthenticatedSession, json } from "../../_shared.js";
import { clearTestAccountData, getTestAccount } from "../_cleanup.js";

export async function onRequestPost(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!session?.adminModeEnabled || !hasPermission(session.user.role, "users.manage")) {
      return json({ error: "Non autorizzato." }, 403);
    }
    const userId = Number(context.params.id);
    if (!Number.isInteger(userId) || userId <= 0) return json({ error: "Id non valido." }, 400);
    const target = await getTestAccount(context.env, userId);
    if (!target) return json({ error: "Account di prova non trovato." }, 404);

    const result = await clearTestAccountData(context.env, userId);
    context.waitUntil(recordEvent(context.env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'auth', eventType: 'content_updated', metadata: { resource: 'test_account', action: 'reset', targetUserId: userId } }));
    return json({ reset: true, user: target, ...result });
  } catch (error) {
    console.error(JSON.stringify({ event: "test_account_reset_error", message: error.message }));
    return json({ error: "Non è stato possibile ripulire l'account di prova." }, 500);
  }
}
