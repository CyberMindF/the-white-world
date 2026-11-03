import { getAuthenticatedSession, json } from "../auth/_shared.js";
import { findTradePartner } from "../carte-trade/_users.js";
import { checkStreak, ensureBustineState, readBustineState } from "./_shared.js";

// Stato bustine dell'utente della sessione. Questa lettura non matura tempo: le bustine
// passive arrivano soltanto dai tick di presenza del browser. Ogni visita in una data diversa
// dall'ultima registrata aggiorna invece la streak e il relativo bonus giornaliero.
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const session = await getAuthenticatedSession(request, env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);

    const partner = await findTradePartner(env, session.user);
    const [state, partnerState] = await Promise.all([
      session.impersonation ? readBustineState(env, session.user.id) : ensureBustineState(env, session.user.id),
      partner ? readBustineState(env, partner.id) : Promise.resolve(null)
    ]);
    const storedStreak = session.impersonation ? await env.DB.prepare('SELECT streak_corrente,streak_migliore FROM carte_streak WHERE user_id=?').bind(session.user.id).first() : null;
    const streak = session.impersonation
      ? { streakCorrente: storedStreak?.streak_corrente ?? 0, streakMigliore: storedStreak?.streak_migliore ?? 0, bustineBonus: 0, primaVisitaOggi: false }
      : await checkStreak(env, session.user.id);
    const quantitaDisponibile = state.quantitaDisponibile + streak.bustineBonus;
    return json({
      quantitaDisponibile,
      altroQuantitaDisponibile: partnerState?.quantitaDisponibile ?? null,
      altroNickname: partner?.nickname ?? null,
      minutiResidui: state.minutiResidui,
      evocazioniDisponibili: state.evocazioniDisponibili,
      bustineSenzaEvocazione: state.bustineSenzaEvocazione,
      streakCorrente: streak.streakCorrente,
      streakMigliore: streak.streakMigliore,
      streakBustineBonus: streak.bustineBonus,
      streakPrimaVisitaOggi: streak.primaVisitaOggi
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "carte_bustine_stato_error", message: error.message }));
    return json({ error: "Non è stato possibile leggere lo stato delle bustine." }, 500);
  }
}
