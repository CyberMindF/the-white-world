import { recordEvent } from "../_shared/events.js";
import { isMaster } from "../gdr-workspace/_shared.js";
import { getAuthenticatedSession, json } from "../auth/_shared.js";

const MAX_VALUE_LENGTH = 4000;

// Valori della scheda del personaggio: condivisi tra i due account (non una riga per utente),
// come world_settings — chi la guarda, master o giocatrice, vede sempre la stessa scheda.
// Il tipo di ogni campo (testo o numero) e i suoi limiti vivono nello schema
// (gdr_character_schema / character-schema.js), qui c'è solo il valore grezzo.
export async function onRequestGet(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);

    const url = new URL(context.request.url);
    const adventure = url.searchParams.get("adventure");
    if (!adventure) return json({ error: "Avventura mancante." }, 400);

    const schemaRow = await context.env.DB.prepare(
      "SELECT fields_json FROM gdr_character_schema WHERE adventure = ?",
    )
      .bind(adventure)
      .first();
    if (!schemaRow) return json({ error: "Avventura sconosciuta." }, 400);
    const schema = JSON.parse(schemaRow.fields_json);

    const linked = await canonical(context.env.DB, adventure, session.user.id);
    if (linked) {
      if (!linked.id)
        return json({ error: "Personaggio non disponibile." }, 404);
      if (
        !isMaster(session.user) &&
        ((!linked.can_edit_sheet &&
          !linked.can_speak &&
          !linked.can_inventory) ||
          linked.archived)
      )
        return json({ error: "Scheda non disponibile." }, 403);
      const data = JSON.parse(linked.fields_json);
      return json({
        values: Object.fromEntries(
          schema.map((f) => [
            f.key,
            isName(f.key)
              ? linked.name
              : (data[f.key] ?? String(f.default ?? "")),
          ]),
        ),
      });
    }
    const { results } = await context.env.DB.prepare(
      "SELECT field_key, value FROM gdr_character_fields WHERE adventure = ?",
    )
      .bind(adventure)
      .all();

    const stored = new Map(
      (results || []).map((row) => [row.field_key, row.value]),
    );
    const values = {};
    for (const field of schema) {
      values[field.key] = stored.has(field.key)
        ? stored.get(field.key)
        : String(field.default ?? "");
    }

    return json({ values });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "gdr_character_fields_get_error",
        message: error.message,
      }),
    );
    return json({ error: "Errore interno del server." }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);

    const form = await context.request.formData();
    const adventure = form.get("adventure");
    const fieldKey = form.get("fieldKey");
    if (typeof adventure !== "string" || typeof fieldKey !== "string") {
      return json({ error: "Richiesta non valida." }, 400);
    }

    const schemaRow = await context.env.DB.prepare(
      "SELECT fields_json FROM gdr_character_schema WHERE adventure = ?",
    )
      .bind(adventure)
      .first();
    if (!schemaRow) return json({ error: "Avventura sconosciuta." }, 400);
    const field = JSON.parse(schemaRow.fields_json).find(
      (f) => f.key === fieldKey,
    );
    if (!field) return json({ error: "Campo sconosciuto." }, 400);

    const value = normalizeValue(form.get("value"), field);
    const updatedAt = new Date().toISOString();

    const linked = await canonical(context.env.DB, adventure, session.user.id);
    if (linked) {
      if (!linked.id)
        return json({ error: "Personaggio non disponibile." }, 404);
      if (
        !isMaster(session.user) &&
        (!linked.can_edit_sheet || linked.archived)
      )
        return json({ error: "Non puoi modificare questa scheda." }, 403);
      if(!isMaster(session.user) && ['statMente','statCuore','statCorpo','statMagia'].includes(fieldKey)) return json({error:'Distribuisci e conferma i punti dal pannello del personaggio.'},403);
      const result = isName(fieldKey)
        ? await context.env.DB.prepare(
            "UPDATE gdr_workspace_characters SET name=?,revision=revision+1 WHERE id=? AND revision=?",
          )
            .bind(
              value.trim() || "Personaggio da completare",
              linked.id,
              linked.revision,
            )
            .run()
        : await context.env.DB.prepare(
            "UPDATE gdr_workspace_characters SET fields_json=json_set(fields_json,?,?),revision=revision+1 WHERE id=? AND revision=?",
          )
            .bind("$." + fieldKey, value, linked.id, linked.revision)
            .run();
      if (!result.meta.changes)
        return json(
          { error: "La scheda è cambiata. Ricarica prima di riprovare." },
          409,
        );
      context.waitUntil(recordEvent(context.env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'gdr', eventType: 'gdr_character_saved', metadata: { adventure, fieldKey } }));
    return json({ saved: true, value, updatedAt });
    }
    await context.env.DB.prepare(
      `
        INSERT INTO gdr_character_fields (adventure, field_key, value, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (adventure, field_key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      `,
    )
      .bind(adventure, fieldKey, value, session.user.id, updatedAt)
      .run();

    context.waitUntil(recordEvent(context.env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'gdr', eventType: 'gdr_character_saved', metadata: { adventure, fieldKey } }));
    return json({ saved: true, value, updatedAt });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "gdr_character_fields_post_error",
        message: error.message,
      }),
    );
    return json({ error: "Non è stato possibile salvare il campo." }, 500);
  }
}

function normalizeValue(raw, field) {
  if (field.type === "number") {
    const num = Number.parseInt(raw, 10);
    const fallback =
      typeof field.default === "number" ? field.default : field.min;
    if (!Number.isFinite(num)) return String(fallback);
    return String(Math.min(field.max, Math.max(field.min, num)));
  }
  const text = typeof raw === "string" ? raw : "";
  return text.length <= MAX_VALUE_LENGTH
    ? text
    : text.slice(0, MAX_VALUE_LENGTH);
}

const isName = (key) =>
  /^(name|nome|nome_personaggio|character_name)$/i.test(key);
async function canonical(db, adventure, userId) {
  return db
    .prepare(
      "SELECT c.*,g.can_edit_sheet,g.can_speak,g.can_inventory FROM gdr_workspace_story_links l LEFT JOIN gdr_workspace_characters c ON c.id=l.character_id LEFT JOIN gdr_workspace_grants g ON g.character_id=c.id AND g.user_id=? WHERE l.adventure_id=? AND l.source_key='pg'",
    )
    .bind(userId, adventure)
    .first();
}
