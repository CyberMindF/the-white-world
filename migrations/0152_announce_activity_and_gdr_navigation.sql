-- Changelog del rilascio: navigazione GDR e completamento del registro attività.
INSERT INTO world_updates
  (kind, emoji, title, body, route, cta_label, published_at, active, announce, safe, created_by, created_at, updated_at)
SELECT 'mondo', '🐉', 'Avventure nel menu e registro più completo',
       'Ora puoi aprire le avventure direttamente dal menu, sotto Tavolo da gioco → GDR. Ho completato anche il registro delle attività: quando il tracciamento è attivo, conserva i cambi della safe mode, l’avventura aperta e le azioni principali su personaggi, inventario, impostazioni e quiz. Anche la data di modifica del profilo viene aggiornata in modo coerente.',
       '/tavolo-da-gioco/gdr', 'Vai alle avventure',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 1, 1,
       (SELECT id FROM users WHERE role = 'admin' AND is_test = 0 ORDER BY id LIMIT 1),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM world_updates
  WHERE title = 'Avventure nel menu e registro più completo'
    AND route = '/tavolo-da-gioco/gdr'
);
