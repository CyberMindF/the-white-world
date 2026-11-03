import { notifyLoggedEvent } from "./email.js";

const ALLOWED_EVENTS = new Set([
  "register",
  "login_success",
  "logout",
  "world_unlocked",
  "crossword_opened",
  "crossword_closed",
  "crossword_completed",
  "word_completed",
  "theme_changed",
  // Aperture di pagina nel Mondo Bianco (client, vedi assets/js/world/main.js).
  "world_page_opened",
  // Media delle Cuffiette (client, vedi assets/js/music/main.js).
  "song_played",
  "song_completed",
  "playlist_link_clicked",
  "crossword_hint_requested",
  "prova_a_dire_no_answered",
  // Azioni esplicite registrate lato server, subito dopo la scrittura riuscita in D1.
  // Gli appunti (autosalvati a ogni pausa di scrittura) restano esclusi: sarebbero rumorosi
  // quanto tracciare i tasti, l'apertura della pagina è già coperta da world_page_opened.
  "letter_sent",
  "letter_edited",
  "gdr_turn_submitted",
  "gdr_character_saved",
  "suggestion_sent",
  "password_changed",
  "question_asked",
  "answer_given",
  "question_edited",
  "answer_edited",
  "together_status_changed",
  "together_nsfw_attempt",
  "together_nsfw_panel_opened",
  "letter_read",
  "nickname_changed",
  "story_suggestion_sent",
  "world_setting_changed",
  "admin_mode_enabled",
  "admin_mode_disabled",
  "content_created",
  "content_updated",
  "content_version_added",
  "content_deleted",
  "bulk_import_created",
  "bulk_import_reverted",
  "study_session_started",
  "study_card_flipped",
  "study_card_navigated",
  "study_deck_shuffled",
  "study_session_completed",
  "study_session_ended",
  "quiz_started",
  "admin_log_viewed",
  "content_export_downloaded",
  "barattolo_biglietto_pescato",
  "chat_message_sent",
  "chat_message_deleted",
  "carte_trade_proposto",
  "carte_trade_accettato",
  "carte_trade_rifiutato",
  "carte_trade_controproposto"
]);
const MAX_METADATA_LENGTH = 4096;

// Valida e registra un evento generico senza duplicare SQL nei singoli endpoint.
export async function recordEvent(env, actor, event) {
  const section = normalizeIdentifier(event.section);
  const eventType = normalizeIdentifier(event.eventType);
  let metadata = normalizeMetadata(event.metadata);

  if (!section || !eventType || !ALLOWED_EVENTS.has(eventType)) {
    return { error: "Tipo di evento non valido." };
  }

  if (!metadata) {
    return { error: "Metadati non validi o troppo grandi." };
  }

  // La sessione rimane dell'admin, anche quando un waitUntil finisce dopo l'uscita.
  // Nessun falso accesso/lettura; i salvataggi espliciti sono interventi admin, senza email.
  const owner = actor.sessionId
    ? await env.DB.prepare("SELECT user_id FROM sessions WHERE id = ?").bind(actor.sessionId).first()
    : null;
  const impersonated = owner && owner.user_id !== actor.userId;
  if (impersonated && ["login_success", "world_unlocked", "world_page_opened", "logout", "letter_read"].includes(eventType)) {
    return { id: null, recorded: false };
  }
  const actorUserId = impersonated ? owner.user_id : actor.userId;
  if (impersonated) {
    metadata = normalizeMetadata({ ...JSON.parse(metadata), impersonation: { actorId: actorUserId, targetId: actor.userId } });
    if (!metadata) return { error: "Metadati non validi o troppo grandi." };
  }

  const result = await env.DB
    .prepare(`
      INSERT INTO events (user_id, session_id, section, event_type, event_version, metadata)
      SELECT ?, ?, ?, ?, 1, ?
      WHERE EXISTS (
        SELECT 1
        FROM users
        WHERE users.id = ?
          AND users.activity_logging_enabled = 1
      )
    `)
    .bind(actorUserId, actor.sessionId || null, section, eventType, metadata, actorUserId)
    .run();

  const recorded = Number(result.meta.changes || 0) > 0;

  if (recorded && !impersonated) {
    try {
      await notifyLoggedEvent(env, { actorUserId: actor.userId, section, eventType });
    } catch (error) {
      // Il log deve restare affidabile anche se l'avviso email o il suo cooldown falliscono.
      console.error(JSON.stringify({
        event: "event_email_notification_error",
        message: error.message
      }));
    }
  }

  return { id: recorded ? result.meta.last_row_id : null, recorded };
}

// Accetta identificatori semplici e prevedibili, adatti anche alle sezioni future.
function normalizeIdentifier(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : "";
}

// Serializza soltanto oggetti JSON piccoli per evitare payload arbitrari nella telemetria.
function normalizeMetadata(value) {
  if (value === undefined) {
    return "{}";
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= MAX_METADATA_LENGTH ? serialized : null;
  } catch {
    return null;
  }
}
