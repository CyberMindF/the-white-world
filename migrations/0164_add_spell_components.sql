-- Le componenti appartengono alla magia e restano facoltative in ogni sistema.
ALTER TABLE gdr_powers ADD COLUMN components TEXT NOT NULL DEFAULT ''
  CHECK(components IN ('','V','S','M','VS','VM','SM','VSM') AND (kind='spell' OR components=''));

-- Compila soltanto le voci originali concordate. Passo felpato e M restano vuoti.
UPDATE gdr_powers
SET components=CASE lower(trim(name)) WHEN 'amicizia' THEN 'S' WHEN 'illusione minore' THEN 'S' ELSE 'VS' END,
  revision=revision+1,updated_at=CURRENT_TIMESTAMP
WHERE kind='spell' AND id LIKE 'legacy-power-%'
  AND lower(trim(name)) IN ('dardo magico','scudo magico','individuazione del magico',
    'amicizia','illusione minore','individuazione dei pensieri');
