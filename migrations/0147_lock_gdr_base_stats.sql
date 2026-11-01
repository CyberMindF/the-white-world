ALTER TABLE gdr_workspace_characters ADD COLUMN stats_editable INTEGER NOT NULL DEFAULT 1 CHECK(stats_editable IN(0,1));
ALTER TABLE gdr_workspace_characters ADD COLUMN stats_budget INTEGER NOT NULL DEFAULT 12 CHECK(stats_budget BETWEEN 4 AND 20);
-- Una distribuzione già completa non viene riaperta né modificata.
UPDATE gdr_workspace_characters SET stats_editable=0,revision=revision+1
WHERE kind='pg' AND adventure_id='il-prezzo-della-verita'
AND COALESCE(json_extract(fields_json,'$.statMente'),0)+COALESCE(json_extract(fields_json,'$.statCuore'),0)+COALESCE(json_extract(fields_json,'$.statCorpo'),0)+COALESCE(json_extract(fields_json,'$.statMagia'),0)=12;
