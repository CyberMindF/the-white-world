-- Nelle Novità non usare il cuore bianco.
UPDATE world_updates
SET emoji = '🎨', updated_at = CURRENT_TIMESTAMP
WHERE emoji = '🤍';
