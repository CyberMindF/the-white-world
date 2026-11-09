import { deliverWorldUpdateEmails } from './world-update-emails.js';
// Registra le aggiunte di contenuti che meritano di comparire nelle Novita. Non deve mai far
// fallire l'azione principale: una lettera o una storia devono essere salvate anche se il
// changelog avesse temporaneamente un problema.
export async function addWorldUpdate(env, {
  kind = "contenuto",
  emoji = "✨",
  title,
  body = "",
  route = null,
  ctaLabel = null,
  createdBy = null,
  publishedAt = new Date().toISOString(),
  safe = false,
  announce = true
}) {
  try {
    const safeTitle = String(title || "").trim().slice(0, 120);
    if (!safeTitle) return { created: false };
    const safeBody = String(body || "").trim().slice(0, 1000);
    const now = new Date().toISOString();
    const created = await env.DB.prepare(
      `INSERT INTO world_updates
       (kind, emoji, title, body, route, cta_label, published_at, active, announce, safe, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(
      kind === "mondo" ? "mondo" : "contenuto",
      String(emoji || "✨").trim().slice(0, 24) || "✨",
      safeTitle,
      safeBody,
      route,
      route ? ctaLabel : null,
      publishedAt,
      announce ? 1 : 0,
      safe ? 1 : 0,
      createdBy,
      now,
      now
    ).first();
    // Chi ha appena aggiunto il contenuto sa gia che esiste: il popup serve all'altra
    // persona. La voce resta comunque visibile a entrambi nell'archivio.
    if (createdBy && created?.id) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO world_update_reads (user_id, update_id, seen_at)
         VALUES (?, ?, ?)`
      ).bind(createdBy, created.id, now).run();
    }
    await deliverWorldUpdateEmails(env);
    return { created: true };
  } catch (error) {
    console.error(JSON.stringify({ event: "world_update_auto_create_error", message: error.message }));
    return { created: false };
  }
}
