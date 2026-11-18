import { getAuthenticatedSession, json, readJson } from "../auth/_shared.js";
import { normalizeBody, toMessageView } from "./_shared.js";
import { recordEvent } from "../_shared/events.js";
import { notifyRealtime } from "../_shared/realtime.js";

export async function onRequestPatch(context) {
  const { env, request, params } = context;
  try {
    const session = await getAuthenticatedSession(request, env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);
    const id = Number(params.id);
    if (!Number.isSafeInteger(id) || id < 1)
      return json({ error: "Id non valido." }, 400);
    const payload = await readJson(request);
    if (
      typeof payload?.body !== "string" ||
      !Number.isSafeInteger(payload?.revision) ||
      payload.revision < 1
    )
      return json({ error: "Modifica non valida." }, 400);
    const body = normalizeBody(payload.body);
    if (body === undefined)
      return json({ error: "Testo del messaggio non valido." }, 400);

    const db = env.DB.withSession("first-primary");
    const existing = await db
      .prepare("SELECT * FROM ponti_chat_messages WHERE id = ?")
      .bind(id)
      .first();
    if (!existing) return json({ error: "Messaggio non trovato." }, 404);
    if (existing.sender_user_id !== session.user.id)
      return json(
        { error: "Puoi modificare soltanto i messaggi che hai scritto." },
        403,
      );
    const now = new Date().toISOString();
    const hasMedia =
      existing.media_key &&
      (!existing.media_expires_at || existing.media_expires_at > now);
    if (!body && !hasMedia)
      return json({ error: "Il messaggio non può essere vuoto." }, 400);
    if (existing.edit_revision !== payload.revision)
      return json(
        {
          error:
            "Il messaggio è cambiato. Ricarica la chat prima di riprovare; la bozza resta disponibile.",
        },
        409,
      );
    if (existing.body === body) return json(toMessageView(existing));

    const result = await db
      .prepare(
        `UPDATE ponti_chat_messages
      SET body = ?, edited_at = ?, edit_revision = edit_revision + 1
      WHERE id = ? AND sender_user_id = ? AND edit_revision = ?
      AND (? IS NOT NULL OR (media_key IS NOT NULL AND (media_expires_at IS NULL OR media_expires_at > ?)))`,
      )
      .bind(body, now, id, session.user.id, payload.revision, body, now)
      .run();
    if (!result.meta.changes)
      return json(
        {
          error:
            "Il messaggio è cambiato o è stato eliminato. La bozza resta disponibile.",
        },
        409,
      );
    const updated = await db
      .prepare("SELECT * FROM ponti_chat_messages WHERE id = ?")
      .bind(id)
      .first();
    if (!updated)
      return json({ error: "Il messaggio è stato eliminato." }, 404);

    context.waitUntil(
      recordEvent(
        env,
        { userId: session.user.id, sessionId: session.sessionId },
        {
          section: "ponti-chat",
          eventType: "content_updated",
          metadata: { messageId: id },
        },
      ),
    );
    context.waitUntil(
      notifyRealtime(env, {
        type: "ponti-chat:changed",
        action: "edited",
        actorUserId: session.user.id,
        messageId: id,
      }),
    );
    return json(toMessageView(updated));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ponti_chat_edit_error",
        message: error.message,
      }),
    );
    return json(
      { error: "Non è stato possibile modificare il messaggio." },
      500,
    );
  }
}

// Un messaggio si può eliminare solo dall'account che lo ha creato. L'identità lui/lei è
// una label narrativa e non partecipa mai ai controlli di proprietà.
export async function onRequestDelete(context) {
  const { env, request, params } = context;
  try {
    const session = await getAuthenticatedSession(request, env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);

    const id = Number(params.id);
    if (!Number.isInteger(id)) return json({ error: "Id non valido." }, 400);

    const existing = await env.DB.prepare(
      "SELECT * FROM ponti_chat_messages WHERE id = ?",
    )
      .bind(id)
      .first();
    if (!existing) return json({ error: "Messaggio non trovato." }, 404);
    if (existing.sender_user_id !== session.user.id) {
      return json(
        { error: "Non puoi eliminare un messaggio che non hai scritto." },
        403,
      );
    }

    if (existing.media_key) {
      await env.MEDIA.delete(existing.media_key);
    }
    await env.DB.prepare("DELETE FROM ponti_chat_messages WHERE id = ?")
      .bind(id)
      .run();

    context.waitUntil(
      recordEvent(
        env,
        { userId: session.user.id, sessionId: session.sessionId },
        {
          section: "ponti-chat",
          eventType: "chat_message_deleted",
          metadata: { messageId: id },
        },
      ),
    );
    context.waitUntil(
      notifyRealtime(env, {
        type: "ponti-chat:changed",
        action: "deleted",
        actorUserId: session.user.id,
        messageId: id,
      }),
    );

    return json({ deleted: true });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ponti_chat_delete_error",
        message: error.message,
      }),
    );
    return json(
      { error: "Non è stato possibile eliminare il messaggio." },
      500,
    );
  }
}
