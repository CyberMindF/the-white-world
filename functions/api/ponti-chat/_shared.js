const MAX_BODY_LENGTH = 2000;
const MEDIA_TTL_DAYS = 30;

export function normalizeBody(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= MAX_BODY_LENGTH ? text : undefined;
}

export function otherIdentity(identity) {
  return identity === "lui" ? "lei" : "lui";
}

export function mediaExpiryFromNow() {
  const expires = new Date();
  expires.setDate(expires.getDate() + MEDIA_TTL_DAYS);
  return expires.toISOString();
}

export function toMessageView(row) {
  return {
    id: String(row.id),
    senderUserId: row.sender_user_id,
    senderIdentity: row.sender_identity,
    body: row.body,
    mediaKey: row.media_key,
    mediaType: row.media_type,
    readAt: row.read_at,
    createdAt: row.created_at,
    editedAt: row.edited_at ?? null,
    revision: row.edit_revision ?? 1
  };
}

// Cancellazione pigra dei media scaduti: eseguita a ogni GET invece che con un cron
// dedicato (nessun Cloudflare Cron Trigger esiste ancora nel progetto) — il volume della
// chat è basso, quindi il costo di un controllo in più per lettura è trascurabile. Il testo
// del messaggio (se presente) resta, solo il riferimento al media viene rimosso.
export async function purgeExpiredMedia(env) {
  const now = new Date().toISOString();
  const { results } = await env.DB
    .prepare("SELECT id, media_key FROM ponti_chat_messages WHERE media_key IS NOT NULL AND media_expires_at IS NOT NULL AND media_expires_at <= ?")
    .bind(now)
    .all();

  for (const row of results) {
    await env.MEDIA.delete(row.media_key);
    await env.DB
      .prepare("UPDATE ponti_chat_messages SET media_key = NULL, media_type = NULL, media_expires_at = NULL WHERE id = ?")
      .bind(row.id)
      .run();
  }
}
