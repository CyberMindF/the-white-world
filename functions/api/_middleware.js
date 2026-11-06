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

// Guardare il sito impersonando un account non consuma letture e non ne registra l'attività.
// Le normali modifiche ai contenuti continuano invece fino ai controlli dei singoli endpoint.
const IMPERSONATION_PASSIVE_POSTS = [
  /^\/api\/telemetry\/(events|word-attempts)$/,
  /^\/api\/visits$/,
  /^\/api\/world-updates\/seen$/,
  /^\/api\/world-promos\/view$/,
  /^\/api\/ponti-chat\/read$/,
  /^\/api\/letters\/\d+$/,
];

export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return context.next();
  const path = new URL(context.request.url).pathname;
  if (path === "/api/diagnostics" && method === "POST") return context.next();
  const session = await getAuthenticatedSession(context.request, context.env);
  if (session?.impersonation && method === "POST" && IMPERSONATION_PASSIVE_POSTS.some(pattern => pattern.test(path))) {
    return json({ ok: true, saved: false, captured: false, readAt: null });
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
