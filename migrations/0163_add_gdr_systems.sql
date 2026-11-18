-- Sistemi e blocchi condivisi. I documenti e i valori originali restano conservati.
CREATE TABLE gdr_systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '[]',
  stat_budget INTEGER NOT NULL DEFAULT 12 CHECK(stat_budget BETWEEN 4 AND 20),
  revision INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE gdr_rule_blocks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  type TEXT NOT NULL,
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE gdr_system_rules (
  system_id TEXT NOT NULL REFERENCES gdr_systems(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL REFERENCES gdr_rule_blocks(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  PRIMARY KEY(system_id,rule_id)
);
CREATE INDEX gdr_system_rules_rule ON gdr_system_rules(rule_id);
CREATE TABLE gdr_system_powers (
  system_id TEXT NOT NULL REFERENCES gdr_systems(id) ON DELETE CASCADE,
  power_id TEXT NOT NULL REFERENCES gdr_powers(id) ON DELETE CASCADE,
  PRIMARY KEY(system_id,power_id)
);
CREATE INDEX gdr_system_powers_power ON gdr_system_powers(power_id);
ALTER TABLE gdr_workspace_adventures ADD COLUMN system_id TEXT REFERENCES gdr_systems(id) ON DELETE RESTRICT;
ALTER TABLE gdr_workspace_characters ADD COLUMN stat_budget_override INTEGER NOT NULL DEFAULT 0 CHECK(stat_budget_override IN(0,1));
CREATE INDEX gdr_workspace_adventures_system ON gdr_workspace_adventures(system_id);

INSERT INTO gdr_systems(id,name,description,fields_json,created_by)
SELECT a.id,substr('Sistema · '||a.title,1,160),'Sistema iniziale ricavato dall’avventura '||a.title||'.',
  coalesce((SELECT json_group_array(json(json_set(j.value,'$.role',
    CASE WHEN json_extract(j.value,'$.key') IN ('statMente','statCuore','statCorpo','statMagia') THEN 'stat'
      WHEN json_extract(j.value,'$.key') IN ('stressCurrent','spellSlotsCurrent') THEN 'resource' ELSE 'field' END)))
    FROM gdr_character_schema cs,json_each(cs.fields_json) j WHERE cs.adventure=a.id AND json_extract(j.value,'$.key') NOT IN ('name','nome','surname','cognome','nome_personaggio','character_name','catName','inventory')),'[]'),a.created_by
FROM gdr_workspace_adventures a;
UPDATE gdr_workspace_adventures SET system_id=id;
UPDATE gdr_workspace_characters SET stat_budget_override=1
WHERE stats_budget<>(SELECT stat_budget FROM gdr_systems s JOIN gdr_workspace_adventures a ON a.system_id=s.id WHERE a.id=gdr_workspace_characters.adventure_id);

INSERT INTO gdr_rule_blocks(id,title,type,data_json,created_by)
SELECT 'initial-rule-'||a.id||'-'||j.key,
  substr(coalesce(nullif(json_extract(j.value,'$.data.text'),''),nullif(json_extract(j.value,'$.data.lead'),''),'Blocco '||(CAST(j.key AS INTEGER)+1)),1,160),
  json_extract(j.value,'$.type'),json_extract(j.value,'$.data'),a.created_by
FROM gdr_workspace_adventures a,json_each(a.rules_json) j;
INSERT INTO gdr_system_rules(system_id,rule_id,position)
SELECT a.system_id,'initial-rule-'||a.id||'-'||j.key,CAST(j.key AS INTEGER)
FROM gdr_workspace_adventures a,json_each(a.rules_json) j;
INSERT INTO gdr_system_powers(system_id,power_id)
SELECT DISTINCT a.system_id,pa.power_id FROM gdr_power_adventures pa JOIN gdr_workspace_adventures a ON a.id=pa.adventure_id;

-- Un solo percorso di lettura per dati ereditati e vecchi documenti ancora senza sistema.
CREATE VIEW gdr_adventure_schema AS
SELECT a.id AS adventure,coalesce(s.fields_json,c.fields_json,'[]') AS fields_json,
  coalesce(s.stat_budget,12) AS stat_budget,a.system_id,s.name AS system_name,s.revision AS system_revision
FROM gdr_workspace_adventures a LEFT JOIN gdr_systems s ON s.id=a.system_id
LEFT JOIN gdr_character_schema c ON c.adventure=a.id;
CREATE VIEW gdr_power_availability AS
SELECT sp.power_id,a.id AS adventure_id FROM gdr_system_powers sp JOIN gdr_workspace_adventures a ON a.system_id=sp.system_id
UNION
SELECT pa.power_id,pa.adventure_id FROM gdr_power_adventures pa JOIN gdr_workspace_adventures a ON a.id=pa.adventure_id WHERE a.system_id IS NULL;

-- Cambiare struttura o sistema invalida gli editor aperti senza toccare i valori salvati.
-- Creati dopo l'importazione: la migrazione conserva le revisioni originali.
CREATE TRIGGER gdr_system_schema_changed AFTER UPDATE OF fields_json,stat_budget ON gdr_systems
WHEN OLD.fields_json IS NOT NEW.fields_json OR OLD.stat_budget IS NOT NEW.stat_budget
BEGIN
  UPDATE gdr_workspace_characters SET revision=revision+1
  WHERE adventure_id IN(SELECT id FROM gdr_workspace_adventures WHERE system_id=NEW.id);
END;
CREATE TRIGGER gdr_adventure_system_changed AFTER UPDATE OF system_id ON gdr_workspace_adventures
WHEN OLD.system_id IS NOT NEW.system_id
BEGIN
  UPDATE gdr_workspace_characters SET revision=revision+1 WHERE adventure_id=NEW.id;
END;
