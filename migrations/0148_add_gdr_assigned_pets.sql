-- Un pet resta un PNG canonico, collegato a un solo PG della stessa avventura.
ALTER TABLE gdr_workspace_characters ADD COLUMN is_pet INTEGER NOT NULL DEFAULT 0
  CHECK(is_pet IN (0,1) AND (is_pet=0 OR kind='png'));
ALTER TABLE gdr_workspace_characters ADD COLUMN pet_owner_id TEXT
  REFERENCES gdr_workspace_characters(id) ON DELETE SET NULL
  CHECK(pet_owner_id IS NULL OR is_pet=1);
CREATE INDEX gdr_workspace_pet_owner ON gdr_workspace_characters(pet_owner_id);

CREATE TRIGGER gdr_workspace_pet_insert BEFORE INSERT ON gdr_workspace_characters
WHEN NEW.pet_owner_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM gdr_workspace_characters pg
  WHERE pg.id=NEW.pet_owner_id AND pg.kind='pg' AND pg.adventure_id=NEW.adventure_id
)
BEGIN
  SELECT RAISE(ABORT,'Il pet deve essere assegnato a un PG della stessa avventura.');
END;
CREATE TRIGGER gdr_workspace_pet_update BEFORE UPDATE OF pet_owner_id,adventure_id,kind,is_pet ON gdr_workspace_characters
WHEN NEW.pet_owner_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM gdr_workspace_characters pg
  WHERE pg.id=NEW.pet_owner_id AND pg.kind='pg' AND pg.adventure_id=NEW.adventure_id
)
BEGIN
  SELECT RAISE(ABORT,'Il pet deve essere assegnato a un PG della stessa avventura.');
END;
-- Anche lo scollegamento automatico dopo l'eliminazione del PG invalida gli editor aperti.
CREATE TRIGGER gdr_workspace_pet_unlink AFTER UPDATE OF pet_owner_id ON gdr_workspace_characters
WHEN OLD.pet_owner_id IS NOT NEW.pet_owner_id AND OLD.revision=NEW.revision
BEGIN
  UPDATE gdr_workspace_characters SET revision=revision+1 WHERE id=NEW.id;
END;
