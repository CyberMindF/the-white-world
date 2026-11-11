ALTER TABLE users ADD COLUMN notify_email_copies INTEGER NOT NULL DEFAULT 0 CHECK (notify_email_copies IN (0, 1));

CREATE TABLE notification_email_copies (
  id TEXT PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  safe INTEGER NOT NULL DEFAULT 0 CHECK (safe IN (0, 1)),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent', 'skipped', 'review')),
  claimed_at TEXT,
  first_attempt_at TEXT,
  sent_at TEXT,
  payload TEXT NOT NULL
);

-- La copia nasce solo alla conferma dell'invio originale, nello stesso aggiornamento.
-- Il payload originale conserva il testo effettivamente inviato, anche se la Novità cambia.
CREATE TRIGGER queue_world_update_email_copy AFTER UPDATE OF state ON world_update_emails
WHEN NEW.state = 'sent' AND OLD.state != 'sent' AND NEW.payload IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO notification_email_copies (id, recipient_id, safe, payload)
  SELECT 'world-update/' || NEW.update_id || '/copy/' || actor.id, actor.id, w.safe,
    json_set(NEW.payload, '$.to', actor.email)
  FROM world_updates w JOIN users actor ON actor.id = w.created_by
  WHERE w.id = NEW.update_id AND actor.is_test = 0 AND actor.notify_email_copies = 1
    AND actor.email != json_extract(NEW.payload, '$.to');
END;
