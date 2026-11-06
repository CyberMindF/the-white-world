-- Novità del tema leggero; evita duplicati se la migrazione viene rieseguita.
INSERT INTO world_updates
  (kind, emoji, title, body, route, cta_label, published_at, active, announce, safe, created_by, created_at, updated_at)
SELECT 'mondo', '🎨', 'Beige Flat: un tema leggerissimo',
       'Ho aggiunto Beige Flat: un tema chiaro sui toni del beige, con superfici piatte e senza ombre, sfocature o animazioni. Quando lo scegli, gli effetti decorativi del mondo non vengono caricati, così il sito richiede meno risorse al tuo dispositivo. Lo trovi nel selettore dei temi.',
       NULL, NULL,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 1, 0,
       (SELECT id FROM users WHERE role = 'admin' AND is_test = 0 ORDER BY id LIMIT 1),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM world_updates WHERE title = 'Beige Flat: un tema leggerissimo'
);
