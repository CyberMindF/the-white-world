import { getConnectionIp } from "../_shared/request-context.js";

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

// Crea risposte JSON uniformi e impedisce al browser di salvarle in cache.
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

// Prova a leggere il corpo JSON della richiesta senza generare eccezioni verso il chiamante.
export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// Uniforma l'email eliminando gli spazi esterni e convertendola in minuscolo.
export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// Gli spazi inseriti accidentalmente prima o dopo una password non ne fanno parte.
export function normalizePassword(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Controlla che l'email abbia una struttura minima valida prima di interrogare il database.
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Verifica la lunghezza minima richiesta per la password.
export function isValidPassword(value) {
  return typeof value === "string" && value.length >= 8;
}

// Uniforma il nickname eliminando gli spazi esterni e limitandone la lunghezza.
export function normalizeNickname(value) {
  return typeof value === "string" ? value.trim().slice(0, 40) : "";
}

// La chiave non distingue maiuscole e minuscole, come nella precedente schermata di accesso.
export function isWorldKeyValid(value, expectedValue) {
  if (typeof value !== "string" || typeof expectedValue !== "string") {
    return false;
  }

  return (
    value.trim().toLocaleLowerCase("it") ===
    expectedValue.trim().toLocaleLowerCase("it")
  );
}

// Genera una sessione, ne salva l'hash in D1 e restituisce il cookie con il token originale.
export async function createSession(request, env, userId) {
  const token = createRandomToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_SECONDS * 1000,
  ).toISOString();

  // Anche le sessioni scadute restano nello storico: qui inseriamo soltanto quella nuova.
  const result = await env.DB.prepare(
    "INSERT INTO sessions (user_id, token_hash, expires_at, last_seen_at) VALUES (?, ?, ?, ?)",
  )
    .bind(userId, tokenHash, expiresAt, new Date().toISOString())
    .run();

  const cookie = buildSessionCookie(request, token);

  return { id: result.meta.last_row_id, cookie, expiresAt };
}

// Prepara i metadati permanenti degli eventi auth senza duplicare user_id o session_id.
export function getAuthEventMetadata(request, extra = {}) {
  return {
    ip: getConnectionIp(request),
    userAgent: request.headers.get("User-Agent")?.slice(0, 512) || null,
    ...extra,
  };
}

// Revoca logicamente la sessione corrente tramite deleted_at e prepara la scadenza del cookie.
export async function revokeCurrentSession(request, env) {
  const token = readCookie(request.headers.get("Cookie"), "noi_session");
  if (token) {
    // deleted_at conserva la sessione nello storico ma impedisce di riutilizzarla.
    const tokenHash = await hashToken(token);
    await env.DB.prepare(
      "UPDATE sessions SET deleted_at = ? WHERE token_hash = ? AND deleted_at IS NULL",
    )
      .bind(new Date().toISOString(), tokenHash)
      .run();
  }

  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `noi_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

// Verifica la sessione e la rinnova solo quando il chiamante conferma un accesso completo.
export async function getAuthenticatedSession(request, env, options = {}) {
  const token = readCookie(request.headers.get("Cookie"), "noi_session");
  if (!token) {
    return null;
  }

  // Il token ricevuto viene trasformato nello stesso hash conservato nel database.
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();
  const session = await env.DB.prepare(
    `
      SELECT
        users.id, users.email, users.nickname, users.identity, users.role, users.is_test, users.safe_mode,
        sessions.id AS session_id, sessions.expires_at, sessions.admin_mode_enabled, sessions.impersonated_user_id, sessions.impersonation_active
      FROM sessions
      INNER JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
        AND sessions.expires_at > ?
        AND sessions.deleted_at IS NULL
        AND users.is_activated = 1
    `,
  )
    .bind(tokenHash, now)
    .first();

  if (!session) {
    return null;
  }

  let expiresAt = session.expires_at;
  let cookie = null;

  if (options.refresh) {
    expiresAt = new Date(
      Date.now() + SESSION_DURATION_SECONDS * 1000,
    ).toISOString();
    // Solo l'invio corretto della chiave aggiorna ultima attività e scadenza.
    await env.DB.prepare(
      "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?",
    )
      .bind(now, expiresAt, session.session_id)
      .run();
    cookie = buildSessionCookie(request, token);
  }

  const actor = {
    id: session.id,
    email: session.email,
    nickname: session.nickname,
    identity: session.identity,
    role: session.role,
    isTest: session.is_test === 1,
    safeMode: session.safe_mode === 1,
  };
  let user = actor,
    impersonation = null;
  if (!options.ignoreImpersonation && session.impersonation_active) {
    if (actor.role !== "admin" || actor.isTest || !session.impersonated_user_id)
      return null;
    const target = await env.DB.prepare(
      "SELECT id,email,nickname,identity,role,is_test,safe_mode FROM users WHERE id=? AND role='member' AND is_test=0 AND is_activated=1",
    )
      .bind(session.impersonated_user_id)
      .first();
    if (!target) return null;
    if (target) {
      user = {
        id: target.id,
        email: target.email,
        nickname: target.nickname,
        identity: target.identity,
        role: target.role,
        isTest: false,
        safeMode: target.safe_mode === 1,
      };
      impersonation = {
        actorId: actor.id,
        actorNickname: actor.nickname,
        readOnly: false,
      };
    }
  }
  return {
    user,
    impersonation,
    sessionId: session.session_id,
    adminModeEnabled:
      !impersonation && session.admin_mode_enabled === 1 && !actor.safeMode,
    cookie,
    expiresAt,
  };
}

// Costruisce il cookie della sessione con una durata di sette giorni dall'ultima verifica valida.
function buildSessionCookie(request, token) {
  // Secure viene omesso in locale, dove Wrangler usa normalmente HTTP.
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `noi_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION_SECONDS}${secure}`;
}

// Crea un token casuale crittograficamente sicuro per identificare una nuova sessione.
export function createRandomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
}

// Calcola l'hash SHA-256 del token prima del confronto o del salvataggio nel database.
export async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToBase64Url(new Uint8Array(hash));
}

// Converte una sequenza di byte nel formato Base64URL adatto ai cookie.
function bytesToBase64Url(bytes) {
  // Base64URL evita caratteri problematici all'interno del valore del cookie.
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

// Cerca un cookie per nome all'interno dell'header Cookie della richiesta.
function readCookie(header, name) {
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const [cookieName, ...valueParts] = part.trim().split("=");
    if (cookieName === name) {
      return valueParts.join("=");
    }
  }

  return null;
}
