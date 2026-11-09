-- Solo le nuove Novità entrano in coda: nessun invio retroattivo dell'archivio.
CREATE TABLE world_update_emails (
  update_id INTEGER PRIMARY KEY REFERENCES world_updates(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','skipped','review')),
  claimed_at TEXT,
  first_attempt_at TEXT,
  sent_at TEXT,
  payload TEXT
);
CREATE TRIGGER queue_world_update_email AFTER INSERT ON world_updates
BEGIN
  INSERT INTO world_update_emails(update_id) VALUES(NEW.id);
END;
