import { recordEvent } from "../_shared/events.js";
import { hasPermission } from "../_shared/permissions.js";
import {
  getAuthenticatedSession,
  isValidEmail,
  isValidPassword,
  json,
  normalizeEmail,
  normalizeNickname,
  normalizePassword,
  readJson
} from "./_shared.js";

function canManageTestAccounts(session) {
  return session?.adminModeEnabled && hasPermission(session.user.role, "users.manage");
}

export async function onRequestGet(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!canManageTestAccounts(session)) return json({ error: "Non autorizzato." }, 403);

    const { results } = await context.env.DB
      .prepare(`
        SELECT id, email, nickname, identity, is_activated, created_at
        FROM users
        WHERE is_test = 1
        ORDER BY created_at DESC, id DESC
      `)
      .all();

    return json({ users: results });
  } catch (error) {
    console.error(JSON.stringify({ event: "test_account_list_error", message: error.message }));
    return json({ error: "Non è stato possibile leggere gli account di prova." }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!canManageTestAccounts(session)) return json({ error: "Non autorizzato." }, 403);

    const body = await readJson(context.request);
    const email = normalizeEmail(body?.email);
    const password = normalizePassword(body?.password);
    const nickname = normalizeNickname(body?.nickname) || "Account test";
    const identity = body?.identity === "lui" ? "lui" : "lei";

    if (!isValidEmail(email)) return json({ error: "Email non valida." }, 400);
    if (!isValidPassword(password)) {
      return json({ error: "La password deve contenere almeno 8 caratteri." }, 400);
    }

    const existing = await context.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) return json({ error: "Esiste già un account con questa email." }, 409);

    const result = await context.env.DB
      .prepare(`
        INSERT INTO users
          (email, nickname, password, is_activated, notify_email_updates, identity, role, is_test)
        VALUES (?, ?, ?, 1, 0, ?, 'member', 1)
      `)
      .bind(email, nickname, password, identity)
      .run();

    context.waitUntil(recordEvent(context.env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'auth', eventType: 'content_created', metadata: { resource: 'test_account', targetUserId: result.meta.last_row_id } }));
    return json({
      user: { id: result.meta.last_row_id, email, nickname, identity, role: "member", isTest: true }
    }, 201);
  } catch (error) {
    console.error(JSON.stringify({ event: "test_account_create_error", message: error.message }));
    return json({ error: "Non è stato possibile creare l'account di prova." }, 500);
  }
}
