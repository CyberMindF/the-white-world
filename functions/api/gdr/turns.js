import { getAuthenticatedSession, json } from "../auth/_shared.js";
import { recordEvent } from "../_shared/events.js";
import { notifyRealtime } from "../_shared/realtime.js";

const MAX_BODY_LENGTH = 20000;
const DEFAULT_ADVENTURE = "il-prezzo-della-verita";

// Elenca il thread di gioco in ordine cronologico: sia il master che chi gioca scrivono qui.
export async function onRequestGet(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);

    const url = new URL(context.request.url);
    const adventure = normalizeAdventure(url.searchParams.get("adventure"));

    const result = await context.env.DB
      .prepare(`
        SELECT gdr_turns.id, gdr_turns.author_id, users.nickname AS author_nickname,
               gdr_turns.body, gdr_turns.created_at, users.role AS author_role, users.is_test AS author_is_test
        FROM gdr_turns
        INNER JOIN users ON users.id = gdr_turns.author_id
        WHERE gdr_turns.adventure = ?
        ORDER BY gdr_turns.created_at ASC, gdr_turns.id ASC
      `)
      .bind(adventure)
      .all();

    const turns = result.results.map((row) => ({
      id: row.id,
      author: row.author_nickname,
      isMine: row.author_id === session.user.id,
      isMaster: row.author_role === 'admin' && row.author_is_test !== 1,
      body: row.body,
      createdAt: row.created_at
    }));

    return json({ turns });
  } catch (error) {
    console.error(JSON.stringify({ event: "gdr_turns_get_error", message: error.message }));
    return json({ error: "Errore interno del server." }, 500);
  }
}

// Aggiunge un turno al thread di gioco.
export async function onRequestPost(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);

    const form = await context.request.formData();
    const adventure = normalizeAdventure(form.get("adventure"));
    const text = normalizeRequiredText(form.get("body"), MAX_BODY_LENGTH);
    if (!text) {
      return json({ error: "Scrivi qualcosa prima di inviare." }, 400);
    }

    const createdAt = new Date().toISOString();
    const result = await context.env.DB
      .prepare("INSERT INTO gdr_turns (author_id, adventure, body, created_at) VALUES (?, ?, ?, ?)")
      .bind(session.user.id, adventure, text, createdAt)
      .run();

    context.waitUntil(recordEvent(
      context.env,
      { userId: session.user.id, sessionId: session.sessionId },
      { section: "gdr", eventType: "gdr_turn_submitted", metadata: { adventure } }
    ));
    context.waitUntil(notifyRealtime(context.env, {
      type: "gdr-turns:changed",
      action: "created",
      actorUserId: session.user.id,
      adventure,
      turnId: result.meta.last_row_id
    }));

    return json(
      { saved: true, turnId: result.meta.last_row_id, author: session.user.nickname, isMaster: session.user.role === 'admin' && !session.user.isTest, createdAt },
      201
    );
  } catch (error) {
    console.error(JSON.stringify({ event: "gdr_turns_post_error", message: error.message }));
    return json({ error: "Non è stato possibile salvare il turno." }, 500);
  }
}

function normalizeAdventure(value) {
  if (typeof value !== "string") return DEFAULT_ADVENTURE;
  const trimmed = value.trim();
  return trimmed || DEFAULT_ADVENTURE;
}

function normalizeRequiredText(value, maxLength) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : "";
}
