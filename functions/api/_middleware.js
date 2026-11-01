import { getAuthenticatedSession, json } from "./auth/_shared.js";

// Gli account di prova possono scrivere solo dati additivi o strettamente personali, tutti
// eliminabili dal rollback. Le letture restano libere come per gli account principali.
const SAFE_TEST_MUTATIONS = [
  { method: "POST", pattern: /^\/api\/ponti-chat$/ },
  { method: "POST", pattern: /^\/api\/ponti-chat\/media$/ },
  { method: "POST", pattern: /^\/api\/ponti-chat\/read$/ },
  { method: "DELETE", pattern: /^\/api\/ponti-chat\/\d+$/ },
  { method: "POST", pattern: /^\/api\/stranger-chat$/ },
  { method: "POST", pattern: /^\/api\/letters$/ },
  { method: "PUT", pattern: /^\/api\/letters\/draft$/ },
  { method: "PUT", pattern: /^\/api\/letters\/\d+$/ },
  { method: "POST", pattern: /^\/api\/gdr\/turns$/ },
  { method: "POST", pattern: /^\/api\/gdr\/notes$/ },
  { method: "POST", pattern: /^\/api\/suggestions$/ },
  { method: "POST", pattern: /^\/api\/stories\/suggestions$/ },
  { method: "POST", pattern: /^\/api\/carte-bustine\/apri$/ },
  { method: "POST", pattern: /^\/api\/carte-bustine\/presenza$/ },
  { method: "POST", pattern: /^\/api\/telemetry\/(events|word-attempts)$/ },
  { method: "PUT", pattern: /^\/api\/crossword\/answers\/[^/]+$/ },
];

export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return context.next();
  const path = new URL(context.request.url).pathname;
  const session = await getAuthenticatedSession(context.request, context.env);
  if (
    session?.impersonation &&
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    path !== "/api/auth/impersonation" &&
    !(path === "/api/auth/session" && method === "DELETE")
  ) {
    return json(
      {
        error:
          "Stai impersonando un account in sola lettura. Torna al tuo account per salvare modifiche.",
      },
      403,
    );
  }
  if (path.startsWith("/api/auth/")) return context.next();
  if (!session?.user.isTest) return context.next();

  const allowed = SAFE_TEST_MUTATIONS.some(
    (entry) => entry.method === method && entry.pattern.test(path),
  );
  if (!allowed) {
    return json(
      {
        error:
          "Questa azione è disattivata per gli account di prova, così il rollback resta completo.",
      },
      403,
    );
  }

  return context.next();
}
