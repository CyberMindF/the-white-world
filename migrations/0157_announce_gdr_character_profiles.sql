-- Un solo annuncio per i miglioramenti GDR, con notifica email nella nuova coda.
INSERT INTO world_updates
  (kind, emoji, title, body, route, cta_label, published_at, active, announce, safe, created_by, created_at, updated_at)
SELECT 'mondo', '🐉', 'I personaggi del GDR prendono vita',
       'Ora puoi aprire la scheda di un personaggio cliccando sul suo avatar o sul nome, anche nelle griglie dei PNG. Trovi l’immagine completa, il ritratto e le informazioni che il tuo personaggio conosce: razza, età, aspetto e “Ciò che sai”. Anche le immagini del racconto si possono ingrandire senza uscire dalla pagina. Gli appunti e le abilità riservate al master restano fuori dalla scheda pubblica.',
       '/tavolo-da-gioco/gdr', 'Apri le avventure',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 1, 1,
       (SELECT id FROM users WHERE role='admin' AND is_test=0 ORDER BY id LIMIT 1),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM world_updates WHERE title='I personaggi del GDR prendono vita' AND route='/tavolo-da-gioco/gdr');
