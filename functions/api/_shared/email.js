const FROM_ADDRESS = "Il Mondo Bianco <notifiche@il-mondo-bianco.com>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EVENT_NOTIFICATION_COOLDOWN_MS = 2 * 60 * 60 * 1000;

// Invia una singola email tramite l'API HTTP di Resend. Non lancia mai: un fallimento nell'invio
// non deve mai far fallire l'azione che lo ha innescato (es. pubblicare una ricetta).
export async function sendEmail(env, { to, subject, html, text, idempotencyKey }) {
  if (!env.RESEND_API_KEY) {
    console.error(JSON.stringify({ event: "email_send_skipped", reason: "missing_api_key" }));
    return { sent: false };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [to],
        subject,
        html: renderEmailTemplate({ subject, content: html }),
        text
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(JSON.stringify({ event: "email_send_failed", status: response.status, detail }));
      return { sent: false };
    }

    return { sent: true };
  } catch (error) {
    console.error(JSON.stringify({ event: "email_send_error", message: error.message }));
    return { sent: false };
  }
}

// Un solo involucro per tutte le email: i singoli flussi devono fornire soltanto il loro
// contenuto. Gli stili sono inline perché restano la soluzione più affidabile tra Gmail,
// Apple Mail e gli altri client che eliminano o limitano i fogli di stile nell'HTML.
export function renderEmailTemplate({ subject, content }) {
  const safeSubject = escapeHtml(subject);
  const decoratedContent = String(content || "")
    .replace(/<p>/g, '<p style="margin:0 0 18px;color:#d1dde6;font-size:16px;line-height:1.65;">')
    .replace(
      /<a\s/g,
      '<a style="display:inline-block;padding:12px 20px;border-radius:999px;background:#e9cf9d;color:#141f32;font-weight:700;text-decoration:none;" '
    );

  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0;padding:0;background:#0d1626;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0d1626;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#141f32;border:1px solid #334056;border-radius:22px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.28);">
            <tr>
              <td style="padding:28px 34px 22px;border-bottom:1px solid #334056;text-align:center;">
                <div style="margin-bottom:8px;color:#e9cf9d;font-size:12px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;">Un messaggio dal</div>
                <div style="color:#f4f7fb;font-family:Georgia,'Times New Roman',serif;font-size:27px;font-weight:700;">Mondo Bianco</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 34px 20px;">
                <h1 style="margin:0 0 22px;color:#f4f7fb;font-family:Georgia,'Times New Roman',serif;font-size:25px;line-height:1.3;">${safeSubject}</h1>
                ${decoratedContent}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 34px 28px;border-top:1px solid #334056;color:#8fa0b5;font-size:12px;line-height:1.55;text-align:center;">
                Questa email arriva dal nostro posto: il Mondo Bianco.<br>
                Se ti è arrivata per errore, è un bug, fammelo sapere.<br>
                <a href="https://il-mondo-bianco.com" style="color:#e9cf9d;text-decoration:none;">il-mondo-bianco.com</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Avvisa l'altra identità (rispetto a chi ha compiuto l'azione) di un aggiornamento sul sito,
// se ha attivato la preferenza personale oppure l'admin ha abilitato gli invii. `force` è
// riservato alle azioni amministrative che hanno già verificato permessi e modalità Admin.
export async function notifyOtherIdentity(env, actorUserId, { subject, html, force = false }) {
  const recipient = await env.DB
    .prepare(`
      SELECT recipient.email
      FROM users actor
      JOIN users recipient
        ON recipient.identity = CASE actor.identity WHEN 'lui' THEN 'lei' ELSE 'lui' END
       AND recipient.is_test = 0
      WHERE actor.id = ?
        AND recipient.id != actor.id
        AND (? = 1 OR recipient.notify_email_updates = 1 OR recipient.admin_email_updates = 1)
      ORDER BY recipient.id
      LIMIT 1
    `)
    .bind(actorUserId, force ? 1 : 0)
    .first();

  if (!recipient) {
    return { sent: false };
  }

  return sendEmail(env, { to: recipient.email, subject, html });
}

// Avvisa l'admin della prima attivita di un account monitorato e silenzia gli avvisi successivi
// per due ore. Il claim in D1 e atomico, quindi eventi contemporanei non generano doppioni.
export async function notifyLoggedEvent(env, { actorUserId, section, eventType }) {
  const recipient = await env.DB
    .prepare("SELECT email FROM users WHERE role = 'admin' AND is_test = 0 ORDER BY id LIMIT 1")
    .first();
  const actor = await env.DB
    .prepare("SELECT nickname, email FROM users WHERE id = ? AND activity_logging_enabled = 1")
    .bind(actorUserId)
    .first();

  if (!recipient?.email || !actor) {
    return { sent: false, reason: "missing_recipient_or_actor" };
  }

  const claimedAt = new Date().toISOString();
  const cooldownStartedBefore = new Date(Date.now() - EVENT_NOTIFICATION_COOLDOWN_MS).toISOString();
  const claim = await env.DB
    .prepare(`
      UPDATE event_email_notification_state
      SET last_sent_at = ?
      WHERE id = 1
        AND (last_sent_at IS NULL OR last_sent_at <= ?)
    `)
    .bind(claimedAt, cooldownStartedBefore)
    .run();

  if (Number(claim.meta.changes || 0) === 0) {
    return { sent: false, reason: "cooldown" };
  }

  const result = await sendEmail(env, {
    to: recipient.email,
    subject: "Nuova attività nel Mondo Bianco",
    html: `
      <p>È stata registrata una nuova attività di ${escapeHtml(actor.nickname || actor.email)} nel Mondo Bianco.</p>
      <p><strong>Sezione:</strong> ${escapeHtml(section)}<br>
      <strong>Evento:</strong> ${escapeHtml(eventType)}</p>
      <p>Per le prossime due ore non riceverai altri avvisi, ma gli eventi continueranno a essere salvati.</p>
      <p><a href="https://il-mondo-bianco.com/log">Apri il registro eventi</a></p>
    `
  });

  if (!result.sent) {
    await env.DB
      .prepare("UPDATE event_email_notification_state SET last_sent_at = NULL WHERE id = 1 AND last_sent_at = ?")
      .bind(claimedAt)
      .run();
  }

  return result;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
