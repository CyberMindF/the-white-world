-- Le modifiche conservano messaggio, allegato, data di invio e stato di lettura.
ALTER TABLE ponti_chat_messages ADD COLUMN edited_at TEXT;
ALTER TABLE ponti_chat_messages ADD COLUMN edit_revision INTEGER NOT NULL DEFAULT 1;
