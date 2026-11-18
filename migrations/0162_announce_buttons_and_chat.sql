-- Due Novità del rilascio, pubblicate una sola volta con la normale coda email.
INSERT INTO world_updates
  (kind, emoji, title, body, route, cta_label, published_at, active, announce, safe, created_by, created_at, updated_at)
SELECT 'mondo', '🖱️', 'Niente più false attese sui pulsanti',
       'I pulsanti disabilitati non mostrano più il cursore di caricamento. Per esempio, quando la chat è vuota, «Invia» resta disabilitato senza far sembrare che ci sia qualcosa da aspettare.',
       NULL, NULL,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 1, 1,
       (SELECT id FROM users WHERE id=1 AND role='admin' AND is_test=0),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM world_updates WHERE title='Niente più false attese sui pulsanti');

INSERT INTO world_updates
  (kind, emoji, title, body, route, cta_label, published_at, active, announce, safe, created_by, created_at, updated_at)
SELECT 'mondo', '💬', 'La Chat si aggiorna',
       'La pagina Chat riprende l’aspetto della chat piccola, con bolle, colori, intestazione e comandi coordinati. Sui tuoi messaggi trovi un menu con tre punti verticali: puoi modificare il testo o eliminare il messaggio. Le modifiche compaiono anche nella chat piccola e sono indicate con «modificato».',
       '/ponti-chat', 'Apri la Chat',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 1, 1,
       (SELECT id FROM users WHERE id=1 AND role='admin' AND is_test=0),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM world_updates WHERE title='La Chat si aggiorna');
