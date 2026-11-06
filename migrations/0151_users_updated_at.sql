-- Ogni modifica effettiva al profilo aggiorna la data, anche se il writer non la specifica.
CREATE TRIGGER users_touch_updated_at AFTER UPDATE ON users
WHEN NEW.updated_at = OLD.updated_at AND (
 NEW.email IS NOT OLD.email OR NEW.nickname IS NOT OLD.nickname OR NEW.password IS NOT OLD.password
 OR NEW.is_activated IS NOT OLD.is_activated OR NEW.notify_email_updates IS NOT OLD.notify_email_updates
 OR NEW.identity IS NOT OLD.identity OR NEW.role IS NOT OLD.role OR NEW.is_test IS NOT OLD.is_test
 OR NEW.activity_logging_enabled IS NOT OLD.activity_logging_enabled
 OR NEW.admin_email_updates IS NOT OLD.admin_email_updates OR NEW.safe_mode IS NOT OLD.safe_mode)
BEGIN
 UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;
