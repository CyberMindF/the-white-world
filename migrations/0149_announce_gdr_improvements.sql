-- Riepilogo delle funzioni GDR già pubblicate, consultabile anche in safe mode.
-- Non include gli strumenti amministrativi di accesso agli account.
WITH updates(emoji, title, body) AS (
  VALUES
    ('✍️', 'Scrivere nel GDR è più semplice',
     'Dialoghi, azioni e note si aggiungono con i pulsanti dell’editor. Prima di pubblicare passi dall’anteprima per rileggere il turno e, dopo l’invio, puoi ancora modificarlo. Racconto e risposte sono condivisi e separati con più chiarezza. Nella vista «Testo e anteprima» lo scorrimento è sincronizzato, anche quando il testo diventa lungo.'),
    ('📜', 'La scheda del PG segue l’avventura',
     'Il personaggio assegnato e la scheda nell’avventura sono collegati. Puoi scegliere il nome completo, caricare una foto e ricavarne il ritratto. Mente, Cuore, Corpo e Magia si distribuiscono all’inizio; poi si modificano quando il master lo permette. Stress e slot degli incantesimi si aggiornano subito, senza aprire la modifica della scheda. Incantesimi, abilità, appunti personali e pet assegnati si consultano accanto alla storia.'),
    ('🐉', 'Più strumenti per il racconto e i personaggi',
     'Per il master, PG e PNG hanno una gestione più chiara: assegnazioni visibili, eliminazione e pet collegati al loro personaggio. Nel racconto si possono usare titoli, dialoghi con avatar e PNG a tutta pagina; la foto completa resta distinta dal ritratto. Per aggiungere un pezzo alla storia basta aprire «Modifica» su un blocco e scegliere «Aggiungi sopra» o «Aggiungi sotto», senza pulsanti in mezzo alla lettura.')
)
INSERT INTO world_updates
  (kind, emoji, title, body, route, cta_label, published_at, active, announce, safe, created_by, created_at, updated_at)
SELECT 'mondo', updates.emoji, updates.title, updates.body,
       '/tavolo-da-gioco/gdr', 'Vai alle avventure',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 1, 1,
       (SELECT id FROM users WHERE role = 'admin' AND is_test = 0 ORDER BY id LIMIT 1),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM updates
WHERE NOT EXISTS (
  SELECT 1 FROM world_updates existing
  WHERE existing.title = updates.title AND existing.route = '/tavolo-da-gioco/gdr'
);
