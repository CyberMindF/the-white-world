import { getAuthenticatedSession, json } from "./auth/_shared.js";

const ROOM_NAME = "world";

// Apre il solo canale di ascolto. Le scritture applicative continuano a usare le API REST.
export async function onRequestGet(context) {
  const { request, env } = context;

  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return json({ enabled: Boolean(env.REALTIME) });
  }

  if (!env.REALTIME) {
    return json({ error: "Canale realtime non ancora attivato." }, 503);
  }

  const session = await getAuthenticatedSession(request, env);
  if (!session) {
    return json({ error: "Sessione non valida o scaduta." }, 401);
  }

  const headers = new Headers(request.headers);
  headers.set("X-Realtime-User-Id", String(session.user.id));
  headers.set("X-Realtime-Identity", session.user.identity);
  headers.set("X-Realtime-Is-Test", session.user.isTest ? "true" : "false");

  const authenticatedRequest = new Request(request, { headers });
  const room = env.REALTIME.getByName(ROOM_NAME);
  return room.fetch(authenticatedRequest);
}
