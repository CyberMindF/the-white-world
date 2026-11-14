CREATE TABLE gdr_powers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('ability','spell')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  effects_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE gdr_power_adventures (
  power_id TEXT NOT NULL REFERENCES gdr_powers(id) ON DELETE CASCADE,
  adventure_id TEXT NOT NULL REFERENCES gdr_workspace_adventures(id) ON DELETE CASCADE,
  PRIMARY KEY(power_id,adventure_id)
);
CREATE TABLE gdr_character_powers (
  character_id TEXT NOT NULL REFERENCES gdr_workspace_characters(id) ON DELETE CASCADE,
  power_id TEXT NOT NULL REFERENCES gdr_powers(id) ON DELETE CASCADE,
  PRIMARY KEY(character_id,power_id)
);
CREATE INDEX gdr_character_powers_power ON gdr_character_powers(power_id);
ALTER TABLE gdr_workspace_adventures ADD COLUMN rules_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE gdr_workspace_adventures ADD COLUMN rules_revision INTEGER NOT NULL DEFAULT 1;

-- Legge i contenuti attuali: nessuna riscrittura dei blocchi originali o delle schede.
CREATE VIEW _gdr_reference_seed AS
SELECT b.*,
  CASE b.document_key WHEN 'maga-regole' THEN 'il-prezzo-della-verita'
    ELSE 'la-casa-che-trattiene-il-respiro' END AS adventure_id,
  (SELECT json_extract(h.data,'$.text') FROM gdr_blocks h
   WHERE h.document_key=b.document_key AND h.type='heading' AND h.position<=b.position
     AND lower(json_extract(h.data,'$.text')) IN ('abilità','abilità speciali','incantesimi')
     AND NOT EXISTS(SELECT 1 FROM gdr_blocks stop WHERE stop.document_key=h.document_key
       AND stop.type='heading' AND stop.position>h.position AND stop.position<=b.position
       AND json_extract(stop.data,'$.level')<=json_extract(h.data,'$.level'))
   ORDER BY h.position DESC LIMIT 1) AS power_heading
FROM gdr_blocks b WHERE b.document_key IN ('maga-regole','casa-regole');

UPDATE gdr_workspace_adventures SET rules_json=(
  SELECT json_group_array(json_object('type',r.type,'data',json(r.data)))
  FROM (SELECT type,data FROM _gdr_reference_seed s
    WHERE s.adventure_id=gdr_workspace_adventures.id AND s.power_heading IS NULL
    ORDER BY position,id) r
) WHERE id IN ('il-prezzo-della-verita','la-casa-che-trattiene-il-respiro');

CREATE VIEW _gdr_power_items AS
SELECT s.*,j.key AS item_index,j.value AS item,
  'legacy-power-'||s.id||'-'||j.key AS power_id
FROM _gdr_reference_seed s,json_each(s.data,'$.items') j
WHERE s.type='list' AND s.power_heading IS NOT NULL;

INSERT INTO gdr_powers(id,kind,name,description,effects_json,sort_order,created_by)
SELECT i.power_id,CASE lower(i.power_heading) WHEN 'incantesimi' THEN 'spell' ELSE 'ability' END,
  substr(trim(CASE WHEN instr(i.item,':')>0 THEN substr(i.item,1,instr(i.item,':')-1) ELSE i.item END),1,160),
  trim(CASE WHEN instr(i.item,':')>0 THEN substr(i.item,instr(i.item,':')+1) ELSE '' END),
  (SELECT json_group_array(json_object('type',r.type,'data',json(r.data))) FROM (
    SELECT s.type,s.data FROM _gdr_reference_seed s
    WHERE s.adventure_id=i.adventure_id AND s.power_heading=i.power_heading
      AND s.type NOT IN ('heading','list')
      AND (s.position<i.position OR (
        i.item_index=json_array_length(i.data,'$.items')-1 AND s.position>i.position
        AND NOT EXISTS(SELECT 1 FROM _gdr_reference_seed other
          WHERE other.document_key=i.document_key AND other.type='list'
            AND other.position>i.position AND other.position<s.position)))
    ORDER BY s.position,s.id) r),
  i.position*100+CAST(i.item_index AS INTEGER),i.created_by
FROM _gdr_power_items i;
INSERT INTO gdr_power_adventures SELECT power_id,adventure_id FROM _gdr_power_items;
INSERT INTO gdr_character_powers(character_id,power_id)
SELECT l.character_id,i.power_id FROM _gdr_power_items i JOIN gdr_workspace_story_links l
  ON l.adventure_id=i.adventure_id AND l.source_key='pg' WHERE l.character_id IS NOT NULL;

-- Conserva anche eventuali abilità personali già scritte, come voci assegnate al loro PG/PNG.
INSERT INTO gdr_powers(id,kind,name,description,created_by)
SELECT 'personal-'||id,'ability',substr('Abilità di '||name,1,160),
  json_extract(profile_json,'$.abilities'),created_by FROM gdr_workspace_characters
WHERE length(trim(coalesce(json_extract(profile_json,'$.abilities'),'')))>0;
INSERT INTO gdr_power_adventures SELECT 'personal-'||id,adventure_id FROM gdr_workspace_characters
WHERE length(trim(coalesce(json_extract(profile_json,'$.abilities'),'')))>0;
INSERT INTO gdr_character_powers SELECT id,'personal-'||id FROM gdr_workspace_characters
WHERE length(trim(coalesce(json_extract(profile_json,'$.abilities'),'')))>0;
DROP VIEW _gdr_power_items;
DROP VIEW _gdr_reference_seed;
