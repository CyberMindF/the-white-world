import { recordEvent } from "../../_shared/events.js";
import { hasPermission } from "../../_shared/permissions.js";
import { getAuthenticatedSession, json } from "../_shared.js";
import { clearTestAccountData, getTestAccount } from "./_cleanup.js";

function canManageTestAccounts(session) {
  return session?.adminModeEnabled && hasPermission(session.user.role, "users.manage");
}

// Elimina esclusivamente dati che il perimetro dell'account test gli permette di creare.
// Le tabelle condivise/editoriali non possono essere mutate da un account test a monte.
export async function onRequestDelete(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!canManageTestAccounts(session)) return json({ error: "Non autorizzato." }, 403);

    const userId = Number(context.params.id);
    if (!Number.isInteger(userId) || userId <= 0) return json({ error: "Id non valido." }, 400);

    const target = await getTestAccount(context.env, userId);
    if (!target) return json({ error: "Account di prova non trovato." }, 404);

    const cleanup = await clearTestAccountData(context.env, userId);
    await context.env.DB.prepare("DELETE FROM users WHERE id = ? AND is_test = 1").bind(userId).run();

    context.waitUntil(recordEvent(context.env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'auth', eventType: 'content_deleted', metadata: { resource: 'test_account', targetUserId: userId } }));
    return json({ deleted: true, user: target, ...cleanup });
  } catch (error) {
    console.error(JSON.stringify({ event: "test_account_rollback_error", message: error.message }));
    return json({ error: "Non è stato possibile completare il rollback." }, 500);
  }
}
