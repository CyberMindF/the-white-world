import { getAuthenticatedSession, json } from "../auth/_shared.js";
import { readBustineState, recordActiveMinute } from "./_shared.js";

// Il client chiama questo endpoint soltanto dopo un minuto completo con la pagina visibile.
// recordActiveMinute deduplica lato database, quindi piu schede non producono piu minuti.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const session = await getAuthenticatedSession(request, env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);

    const state = session.impersonation
      ? { ...(await readBustineState(env, session.user.id)), minutoRegistrato: false }
      : await recordActiveMinute(env, session.user.id);
    return json({
      quantitaDisponibile: state.quantitaDisponibile,
      minutiResidui: state.minutiResidui,
      minutoRegistrato: state.minutoRegistrato
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "carte_bustine_presenza_error", message: error.message }));
    return json({ error: "Non è stato possibile aggiornare il tempo nel Mondo Bianco." }, 500);
  }
}
