import { recordEvent } from "../_shared/events.js";
import { getAuthenticatedSession, json, readJson } from "../auth/_shared.js";
import { hasPermission } from "../_shared/permissions.js";

const MAX_SCHEMA_LENGTH = 20000;

// Struttura della scheda del personaggio per avventura: quali campi esistono, se sono testo o
// numero, etichette, min/max — un JSON grezzo modificabile dall'admin, stesso principio
// "editor senza fronzoli" già usato per i blocchi GDR. Non richiede nuove migrazioni per
// aggiungere/rinominare un campo, solo modificare questo JSON dal pannello di gioco.
export async function onRequestGet(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);

    const url = new URL(context.request.url);
    const adventure = url.searchParams.get("adventure");
    if (!adventure) return json({ error: "Avventura mancante." }, 400);

    const row = await context.env.DB
      .prepare("SELECT fields_json FROM gdr_character_schema WHERE adventure = ?")
      .bind(adventure)
      .first();

    if (!row) return json({ fields: [] });

    return json({ fields: JSON.parse(row.fields_json) });
  } catch (error) {
    console.error(JSON.stringify({ event: "gdr_character_schema_get_error", message: error.message }));
    return json({ error: "Errore interno del server." }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);
    if (!hasPermission(session.user.role, "content.edit")) {
      return json({ error: "Non autorizzato." }, 403);
    }

    const payload = await readJson(context.request);
    const adventure = payload?.adventure;
    if (typeof adventure !== "string" || !adventure) return json({ error: "Avventura mancante." }, 400);

    const fields = payload?.fields;
    if (!validateFields(fields)) return json({ error: "Struttura non valida." }, 400);

    const fieldsJson = JSON.stringify(fields);
    if (fieldsJson.length > MAX_SCHEMA_LENGTH) return json({ error: "Struttura troppo lunga." }, 400);

    const updatedAt = new Date().toISOString();
    await context.env.DB
      .prepare(`
        INSERT INTO gdr_character_schema (adventure, fields_json, updated_by, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (adventure) DO UPDATE SET fields_json = excluded.fields_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      `)
      .bind(adventure, fieldsJson, session.user.id, updatedAt)
      .run();

    context.waitUntil(recordEvent(context.env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'gdr', eventType: 'content_updated', metadata: { adventure, resource: 'character_schema' } }));
    return json({ saved: true, fields });
  } catch (error) {
    console.error(JSON.stringify({ event: "gdr_character_schema_post_error", message: error.message }));
    return json({ error: "Non è stato possibile salvare la struttura." }, 500);
  }
}

function validateFields(fields) {
  if (!Array.isArray(fields)) return false;
  return fields.every((field) => {
    if (!field || typeof field !== "object") return false;
    if (typeof field.key !== "string" || !field.key) return false;
    if (typeof field.label !== "string" || !field.label) return false;
    if (field.type !== "text" && field.type !== "number") return false;
    if (field.type === "number") {
      if (typeof field.min !== "number" || typeof field.max !== "number") return false;
      if (field.min > field.max) return false;
    }
    return true;
  });
}
