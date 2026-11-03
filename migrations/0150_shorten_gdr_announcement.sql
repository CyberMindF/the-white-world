-- Una sola novità breve, mantenendo data e letture della voce principale.
UPDATE world_updates
SET title = 'Il GDR è più semplice da giocare',
    emoji = '🐉',
    body = 'Scrivere i turni è più semplice: puoi rileggerli in anteprima e modificarli anche dopo la pubblicazione. La scheda è collegata al tuo personaggio, con foto, abilità, incantesimi e pet; stress e slot si aggiornano al volo. Ho riordinato anche gli strumenti per continuare il racconto.',
    updated_at = CURRENT_TIMESTAMP
WHERE route = '/tavolo-da-gioco/gdr'
  AND title = 'Scrivere nel GDR è più semplice';

DELETE FROM world_updates
WHERE route = '/tavolo-da-gioco/gdr'
  AND title IN ('La scheda del PG segue l’avventura', 'Più strumenti per il racconto e i personaggi')
  AND EXISTS (
    SELECT 1 FROM world_updates unified
    WHERE unified.route = '/tavolo-da-gioco/gdr'
      AND unified.title = 'Il GDR è più semplice da giocare'
  );
