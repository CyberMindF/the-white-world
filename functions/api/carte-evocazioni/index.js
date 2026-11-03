import { getAuthenticatedSession, json } from "../auth/_shared.js";
import { ensureBustineState } from "../carte-bustine/_shared.js";
import { readOpenOffer } from "./_shared.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const session = await getAuthenticatedSession(request, env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);

    const [state, offerta] = await Promise.all([
      ensureBustineState(env, session.user.id),
      readOpenOffer(env, session.user.id)
    ]);
    return json({
      evocazioniDisponibili: state.evocazioniDisponibili,
      bustineSenzaEvocazione: state.bustineSenzaEvocazione,
      offerta
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "carte_evocazioni_stato_error", message: error.message }));
    return json({ error: "Non è stato possibile leggere le evocazioni." }, 500);
  }
}
