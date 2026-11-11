-- Applicare dopo la pubblicazione del codice che rimuove le copie automatiche:
-- la versione precedente legge ancora il campo e la tabella qui ritirati.
-- Le ricevute dei due invii già eseguiti restano come semplice storico.
DROP TRIGGER IF EXISTS queue_world_update_email_copy;
ALTER TABLE users DROP COLUMN notify_email_copies;
ALTER TABLE notification_email_copies RENAME TO notification_email_copy_history;
