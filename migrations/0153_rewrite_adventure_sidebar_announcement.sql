-- Testo per Desy: conserva la voce e le letture, senza dettagli amministrativi.
UPDATE world_updates
SET title = 'Le avventure sono anche nel menu',
    body = 'Ho aggiunto le avventure al menu laterale: le trovi sotto Tavolo da gioco → GDR. Da lì puoi scegliere direttamente quella che vuoi continuare.',
    updated_at = CURRENT_TIMESTAMP
WHERE route = '/tavolo-da-gioco/gdr'
  AND title = 'Avventure nel menu e registro più completo';
