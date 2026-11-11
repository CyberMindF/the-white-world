import { sendEmail, deliverNotificationEmailCopies } from './email.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Il claim atomico evita doppioni fra richieste concorrenti. Il payload resta congelato
// dopo il primo tentativo per riusare la stessa chiave di idempotenza anche dopo una modifica.
export async function deliverWorldUpdateEmails(env) {
  const totals = { sent: 0, skipped: 0, failed: 0 };
  try {
    const { results } = await env.DB.prepare(`
      SELECT w.*, q.payload, q.first_attempt_at FROM world_update_emails q JOIN world_updates w ON w.id=q.update_id
      WHERE w.active=1 AND w.announce=1 AND datetime(w.published_at)<=datetime('now')
        AND (q.state='pending' OR (q.state='sending' AND datetime(q.claimed_at)<datetime('now','-5 minutes')))
      ORDER BY w.id LIMIT 10`).all();
    for (const update of results) {
      const now = new Date().toISOString();
      const claim = await env.DB.prepare(`UPDATE world_update_emails SET state='sending',claimed_at=?
        WHERE update_id=? AND (state='pending' OR (state='sending' AND datetime(claimed_at)<datetime('now','-5 minutes')))`)
        .bind(now, update.id).run();
      if (!claim.meta.changes) continue;
      try {
        // Resend conserva le chiavi per 24 ore: oltre questa finestra non tentare
        // automaticamente un invio dall'esito incerto, per evitare un doppione.
        if (update.first_attempt_at && Date.now() - Date.parse(update.first_attempt_at) > 23 * 60 * 60 * 1000) {
          await env.DB.prepare("UPDATE world_update_emails SET state='review' WHERE update_id=? AND claimed_at=?").bind(update.id, now).run();
          totals.failed++; continue;
        }
        // L'abilitazione admin forza anche gli invii non safe. Senza override valgono
        // sia la preferenza personale sia il filtro Safe del destinatario.
        const recipient = await env.DB.prepare(`SELECT recipient.id, recipient.email FROM users actor
          JOIN users recipient ON recipient.identity=CASE actor.identity WHEN 'lui' THEN 'lei' ELSE 'lui' END
          WHERE actor.id=? AND actor.is_test=0 AND recipient.is_test=0 AND recipient.id!=actor.id
            AND (recipient.admin_email_updates=1 OR
              (recipient.notify_email_updates=1 AND (recipient.safe_mode=0 OR ?=1)))
          ORDER BY recipient.id LIMIT 1`).bind(update.created_by, update.safe).first();
        if (!recipient) {
          await env.DB.prepare("UPDATE world_update_emails SET state='skipped' WHERE update_id=? AND claimed_at=?")
            .bind(update.id, now).run();
          totals.skipped++; continue;
        }
        const route = update.route?.startsWith('/') && !update.route.startsWith('//') ? update.route : '/novita';
        const payload = update.payload ? JSON.parse(update.payload) : {
          to: recipient.email,
          subject: `Novità nel Mondo Bianco: ${update.title}`,
          html: `<p>${escapeHtml(update.body).replace(/\n/g, '<br>')}</p><p><a href="${escapeHtml('https://il-mondo-bianco.com' + route)}">${escapeHtml(update.cta_label || 'Leggi la novità')}</a></p>`,
          text: `${update.title}\n\n${update.body}\n\nhttps://il-mondo-bianco.com${route}`
        };
        // Se cambia il destinatario durante un retry, non inviare al vecchio indirizzo.
        if (payload.to !== recipient.email) throw new Error('Destinatario della notifica modificato');
        await env.DB.prepare('UPDATE world_update_emails SET payload=?,first_attempt_at=COALESCE(first_attempt_at,?) WHERE update_id=? AND claimed_at=?')
          .bind(JSON.stringify(payload), now, update.id, now).run();
        const result = await sendEmail(env, {...payload, idempotencyKey: `world-update/${update.id}`});
        await env.DB.prepare(`UPDATE world_update_emails SET state=?,sent_at=? WHERE update_id=? AND claimed_at=?`)
          .bind(result.sent ? 'sent' : 'pending', result.sent ? now : null, update.id, now).run();
        totals[result.sent ? 'sent' : 'failed']++;
      } catch (error) {
        await env.DB.prepare("UPDATE world_update_emails SET state='pending' WHERE update_id=? AND claimed_at=?")
          .bind(update.id, now).run();
        totals.failed++;
        console.error(JSON.stringify({event:'world_update_email_failed', id:update.id, message:error.message}));
      }
    }
  } catch (error) {
    console.error(JSON.stringify({event:'world_update_email_queue_failed',message:error.message}));
    totals.failed++;
  }
  return { ...totals, copies: await deliverNotificationEmailCopies(env) };
}
