import { json, readAuthenticatedRequest, recordEvent } from "./_shared.js";

const CLIENT_EVENT_TYPES = new Set([
  "gdr_adventure_opened",
  "crossword_opened",
  "crossword_closed",
  "crossword_completed",
  "word_completed",
  "theme_changed",
  "world_page_opened",
  "song_played",
  "song_completed",
  "playlist_link_clicked",
  "crossword_hint_requested",
  "prova_a_dire_no_answered",
  "together_nsfw_panel_opened",
  "study_session_started",
  "study_card_flipped",
  "study_card_navigated",
  "study_deck_shuffled",
  "study_session_completed",
  "study_session_ended"
]);

// Registra un evento significativo associandolo sempre all'utente e alla sessione autenticati.
export async function onRequestPost(context) {
  try {
    const parsed = await readAuthenticatedRequest(context.request, context.env);
    if (parsed.error) {
      return parsed.error;
    }

    // Gli eventi auth possono essere prodotti esclusivamente dagli endpoint backend di autenticazione.
    if (parsed.body.section === "auth" || !CLIENT_EVENT_TYPES.has(parsed.body.eventType)) {
      return json({ error: "Tipo di evento non consentito al client." }, 403);
    }

    const result = await recordEvent(
      context.env,
      { userId: parsed.session.user.id, sessionId: parsed.session.sessionId },
      parsed.body
    );
    if (result.error) {
      return json({ error: result.error }, 400);
    }

    return json({ saved: result.recorded, id: result.id }, 201);
  } catch (error) {
    console.error(JSON.stringify({ event: "telemetry_event_error", message: error.message }));
    return json({ error: "Errore interno del server." }, 500);
  }
}
