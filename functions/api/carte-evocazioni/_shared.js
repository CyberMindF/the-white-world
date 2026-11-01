const FINITURA_WEIGHTS = [
  ["flat", 600],
  ["argento", 200],
  ["oro", 100],
  ["onice", 50],
  ["smeraldo", 25],
  ["rubino", 12],
  ["zaffiro", 8],
  ["diamante", 5]
];

const TOTAL_WEIGHT = FINITURA_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);

// Le finiture degli Arcani sono piu generose di quelle normali: l'evocazione stessa e gia
// rara e propone soltanto una carta da conservare. Diamante resta circa una su 200 proposte.
export function rollArcanoFinitura() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const [finitura, weight] of FINITURA_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return finitura;
  }
  return "flat";
}

export async function readOpenOffer(env, userId, {readOnly=false} = {}) {
  const offer = await env.DB
    .prepare("SELECT id, created_at FROM carte_evocazioni_offerte WHERE user_id = ? AND stato = 'aperta'")
    .bind(userId)
    .first();
  if (!offer) return null;

  const { results } = await env.DB
    .prepare(
      `SELECT c.id AS candidato_id, c.finitura, c.position,
              d.id AS design_id, d.nome AS design_nome, d.immagine_key,
              d.categoria_tarocco, d.numero_tarocco, s.nome AS set_nome
       FROM carte_evocazioni_candidati c
       JOIN carte_designs d ON d.id = c.design_id
       JOIN carte_sets s ON s.id = d.set_id
       WHERE c.offerta_id = ? AND COALESCE(s.tipo, 'normale') = 'tarocchi'
       ORDER BY c.position`
    )
    .bind(offer.id)
    .all();

  if (results.length === 0) {
    if(readOnly) return null;
    // Un admin puo aver eliminato gli Arcani mentre l'offerta era aperta. In tal caso non
    // lasciamo l'utente bloccato: restituiamo l'evocazione e rimuoviamo l'offerta vuota.
    await env.DB.batch([
      env.DB
        .prepare("UPDATE carte_bustine SET evocazioni_disponibili = evocazioni_disponibili + 1 WHERE user_id = ?")
        .bind(userId),
      env.DB.prepare("DELETE FROM carte_evocazioni_offerte WHERE id = ?").bind(offer.id)
    ]);
    return null;
  }

  return {
    id: offer.id,
    createdAt: offer.created_at,
    candidati: results.map((row) => ({
      id: String(row.candidato_id),
      designId: String(row.design_id),
      designNome: row.design_nome,
      immagineKey: row.immagine_key,
      finitura: row.finitura,
      categoriaTarocco: row.categoria_tarocco,
      numeroTarocco: row.numero_tarocco,
      setNome: row.set_nome
    }))
  };
}
