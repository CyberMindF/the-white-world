-- Una sola scheda per personaggio; i collegamenti restano anche dopo l'eliminazione
-- per evitare che un PNG del racconto venga ricreato al caricamento successivo.
ALTER TABLE gdr_workspace_characters ADD COLUMN fields_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE gdr_workspace_story_links (
  adventure_id TEXT NOT NULL REFERENCES gdr_workspace_adventures(id),
  source_key TEXT NOT NULL,
  character_id TEXT REFERENCES gdr_workspace_characters(id) ON DELETE SET NULL,
  PRIMARY KEY (adventure_id, source_key)
);
