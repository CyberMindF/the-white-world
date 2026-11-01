import { WorkspaceError } from "./_shared.js";
// Importazione idempotente delle sole fonti non ancora collegate. Nessun aggiornamento
// dei dati già unificati: le modifiche successive appartengono al personaggio canonico.
export async function syncLegacy(db, user, adventureId) {
  const documents = {
    "il-prezzo-della-verita": "avventura",
    "la-casa-che-trattiene-il-respiro": "casa-avventura",
  };
  if (!documents[adventureId]) return;
  const schemaRow = await db
    .prepare("SELECT fields_json FROM gdr_character_schema WHERE adventure=?")
    .bind(adventureId)
    .first();
  if (!schemaRow) return;
  const schema = JSON.parse(schemaRow.fields_json);
  const stored = (
    await db
      .prepare(
        "SELECT field_key,value FROM gdr_character_fields WHERE adventure=?",
      )
      .bind(adventureId)
      .all()
  ).results;
  const values = Object.fromEntries(
    schema.map((f) => [
      f.key,
      String(
        stored.find((v) => v.field_key === f.key)?.value ?? f.default ?? "",
      ),
    ]),
  );
  const link = await db
    .prepare(
      "SELECT character_id FROM gdr_workspace_story_links WHERE adventure_id=? AND source_key='pg'",
    )
    .bind(adventureId)
    .first();
  if (!link) {
    const existing = (
      await db
        .prepare(
          "SELECT * FROM gdr_workspace_characters WHERE adventure_id=? AND kind='pg' ORDER BY created_at,id",
        )
        .bind(adventureId)
        .all()
    ).results;
    if (existing.length > 1)
      throw new WorkspaceError(
        "Ci sono più PG: il collegamento della scheda precedente richiede una scelta esplicita. Nessun dato è stato modificato.",
        409,
      );
    const c = existing[0];
    const id = c?.id ?? "story-pg-" + adventureId;
    const nameField = schema.find((f) =>
      /^(name|nome|nome_personaggio|character_name)$/i.test(f.key),
    );
    const oldName = nameField ? values[nameField.key] : "";
    const name =
      c && !["Il mio personaggio", "Personaggio da completare"].includes(c.name)
        ? c.name
        : oldName || c?.name || "Personaggio da completare";
    if (
      c &&
      oldName &&
      c.name !== oldName &&
      !["Il mio personaggio", "Personaggio da completare"].includes(c.name)
    )
      throw new WorkspaceError(
        "Il nome nella vecchia scheda differisce da quello del PG. Nessun dato è stato sovrascritto.",
        409,
      );
    const copiedSheet = schema
      .map((f) => `${f.label}: ${values[f.key] ?? ""}`)
      .join("\n\n");
    if (nameField) delete values[nameField.key];
    const items=JSON.parse(c?.inventory_json ?? '[]');
    if(values.inventory) for(const line of values.inventory.split('\n').map(v=>v.trim()).filter(Boolean)) {
      if(!items.some(item=>item.name===line)) items.push({id:crypto.randomUUID(),name:line.slice(0,160),quantity:1,notes:line.length>160 ? line.slice(0,2000) : ''});
    }
    delete values.inventory;
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          "INSERT INTO gdr_workspace_characters(id,adventure_id,kind,name,created_by,created_at) VALUES(?,?,'pg',?,?,?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(id, adventureId, name, user.id, now),
      db
        .prepare(
          "UPDATE gdr_workspace_characters SET name=?,fields_json=?,inventory_json=?,sheet=CASE WHEN sheet=? THEN '' ELSE sheet END,revision=revision+1 WHERE id=? AND NOT EXISTS(SELECT 1 FROM gdr_workspace_story_links WHERE adventure_id=? AND source_key='pg')",
        )
        .bind(name, JSON.stringify(values), JSON.stringify(items), copiedSheet, id, adventureId),
      db
        .prepare(
          "INSERT INTO gdr_workspace_story_links(adventure_id,source_key,character_id) VALUES(?,'pg',?) ON CONFLICT DO NOTHING",
        )
        .bind(adventureId, id),
      ...(!c
        ? [
            db
              .prepare(
                "INSERT INTO gdr_workspace_grants(character_id,user_id,can_speak,can_edit_sheet,can_inventory) SELECT ?,id,1,1,1 FROM users WHERE role='member' AND is_test=0 ON CONFLICT DO NOTHING",
              )
              .bind(id),
          ]
        : []),
    ]);
  }
  const blocks = (
    await db
      .prepare(
        "SELECT id,data FROM gdr_blocks WHERE document_key=? AND type='npc_grid' ORDER BY position,id",
      )
      .bind(documents[adventureId])
      .all()
  ).results;
  for (const block of blocks) {
    const entries = JSON.parse(block.data).entries ?? [];
    for (let i = 0; i < entries.length; i++) {
      const npc = entries[i],
        key = `npc:${block.id}:${i}`;
      if (
        await db
          .prepare(
            "SELECT source_key FROM gdr_workspace_story_links WHERE adventure_id=? AND source_key=?",
          )
          .bind(adventureId, key)
          .first()
      )
        continue;
      const existing = await db
        .prepare(
          "SELECT id FROM gdr_workspace_characters WHERE adventure_id=? AND kind='png' AND name=? ORDER BY created_at,id LIMIT 1",
        )
        .bind(adventureId, npc.name)
        .first();
      const id = existing?.id ?? `story-npc-${block.id}-${i}`;
      await db.batch([
        db
          .prepare(
            "INSERT INTO gdr_workspace_characters(id,adventure_id,kind,name,portrait,photo,profile_json,created_by,created_at) VALUES(?,?,'png',?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
          )
          .bind(
            id,
            adventureId,
            npc.name,
            npc.image ?? "",
            npc.image ?? "",
            JSON.stringify({ appearance: npc.description ?? "" }),
            user.id,
            new Date().toISOString(),
          ),
        db
          .prepare(
            "INSERT INTO gdr_workspace_story_links(adventure_id,source_key,character_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",
          )
          .bind(adventureId, key, id),
      ]);
    }
  }
}
export function characterFields(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 100
  )
    throw new WorkspaceError("Campi della scheda non validi.", 400);
  const result = {};
  for (const [key, field] of Object.entries(value)) {
    if (
      !/^[a-zA-Z0-9_-]{1,100}$/.test(key) ||
      typeof field !== "string" ||
      field.length > 4000
    )
      throw new WorkspaceError("Campo della scheda non valido.", 400);
    result[key] = field;
  }
  return result;
}

export async function validateCharacterFields(db, adventureId, value) {
  const result = characterFields(value);
  const row = await db
    .prepare("SELECT fields_json FROM gdr_character_schema WHERE adventure=?")
    .bind(adventureId)
    .first();
  for (const field of row ? JSON.parse(row.fields_json) : []) {
    if(result[field.key] === undefined && field.key !== 'inventory') result[field.key]=String(field.default ?? (field.type === 'number' ? field.min : '') ?? '');
    if (field.type === "number" && result[field.key] !== undefined) {
      const number = Number(result[field.key]);
      if (
        !result[field.key].trim() ||
        !Number.isInteger(number) ||
        number < field.min ||
        number > field.max
      )
        throw new WorkspaceError(`Valore non valido per ${field.label}.`, 400);
    }
  }
  for (const key of Object.keys(result))
    if (
      /^(name|nome|surname|cognome|nome_personaggio|character_name)$/i.test(key)
    )
      delete result[key];
  return result;
}
