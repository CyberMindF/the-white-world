import { getAuthenticatedSession, json, readJson } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  const session = await getAuthenticatedSession(request, env, {
    ignoreImpersonation: true,
  });
  if (
    !session ||
    session.user.role !== "admin" ||
    session.user.isTest ||
    !session.adminModeEnabled
  )
    return json({ error: "Riservato alla modalità admin." }, 403);
  const { results } = await env.DB.prepare(
    "SELECT id,nickname FROM users WHERE role='member' AND is_test=0 AND is_activated=1 ORDER BY nickname,id",
  ).all();
  return json({ users: results });
}
export async function onRequestPost({ request, env }) {
  try {
    const session = await getAuthenticatedSession(request, env, {
      ignoreImpersonation: true,
    });
    if (
      !session ||
      session.user.role !== "admin" ||
      session.user.isTest ||
      !session.adminModeEnabled
    )
      return json({ error: "Riservato alla modalità admin." }, 403);
    const body = await readJson(request);
    if (!Number.isSafeInteger(body?.userId))
      return json({ error: "Scegli un account." }, 400);
    const target = await env.DB.prepare(
      "SELECT id,nickname FROM users WHERE id=? AND role='member' AND is_test=0 AND is_activated=1",
    )
      .bind(body.userId)
      .first();
    if (!target) return json({ error: "Account non disponibile." }, 404);
    await env.DB.prepare(
      "UPDATE sessions SET impersonated_user_id=?,impersonation_active=1 WHERE id=? AND user_id=? AND deleted_at IS NULL",
    )
      .bind(target.id, session.sessionId, session.user.id)
      .run();
    console.info(
      JSON.stringify({
        event: "admin_impersonation_started",
        actorId: session.user.id,
        targetId: target.id,
        sessionId: session.sessionId,
      }),
    );
    return json({ saved: true, userId: target.id });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "impersonation_start_error",
        message: error.message,
      }),
    );
    return json({ error: "Impossibile attivare l’impersonazione." }, 500);
  }
}
export async function onRequestDelete({ request, env }) {
  try {
    const session = await getAuthenticatedSession(request, env, {
      ignoreImpersonation: true,
    });
    if (!session || session.user.role !== "admin" || session.user.isTest)
      return json({ error: "Non autorizzato." }, 403);
    await env.DB.prepare(
      "UPDATE sessions SET impersonated_user_id=NULL,impersonation_active=0 WHERE id=? AND user_id=?",
    )
      .bind(session.sessionId, session.user.id)
      .run();
    console.info(
      JSON.stringify({
        event: "admin_impersonation_stopped",
        actorId: session.user.id,
        sessionId: session.sessionId,
      }),
    );
    return json({ saved: true });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "impersonation_stop_error",
        message: error.message,
      }),
    );
    return json({ error: "Impossibile terminare l’impersonazione." }, 500);
  }
}
