import { syncLegacy, validateCharacterFields } from "./legacy.js";
import { getAuthenticatedSession, json } from "../auth/_shared.js";
import {
  WorkspaceError,
  requireMaster,
  isMaster,
  validId,
  text,
  portrait,
  profile,
  readLimited,
  inventory,
  failure,
} from "./_shared.js";

// Un solo endpoint di scrittura del laboratorio; nessuna modifica alle tabelle storiche.
export async function mutate(db, user, payload) {
  if (user.isTest)
    throw new WorkspaceError(
      "Questa azione non è disponibile per gli account di prova.",
      403,
    );
  const p = payload;
  if (!p || typeof p !== "object")
    throw new WorkspaceError("Richiesta non valida.", 400);
  if (p.action === "syncLegacy") {
    requireMaster(user);
    await syncLegacy(db, user, p.adventureId);
    return { saved: true };
  }
  if (p.action === "createAdventure") {
    requireMaster(user);
    if (!validId(p.id))
      throw new WorkspaceError("Identificativo non valido.", 400);
    // UUID fornito dal client: un retry non crea una seconda avventura.
    await db
      .prepare(
        `INSERT INTO gdr_workspace_adventures (id,title,source,created_by,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        p.id,
        text(p.title, 160),
        text(p.source ?? "", 100000, true),
        user.id,
        new Date().toISOString(),
      )
      .run();
    return { saved: true, id: p.id };
  }
  if (p.action === "saveAdventure" || p.action === "publishAdventure") {
    requireMaster(user);
    const row = await db
      .prepare("SELECT legacy FROM gdr_workspace_adventures WHERE id=?")
      .bind(p.id ?? "")
      .first();
    if (!row) throw new WorkspaceError("Avventura non trovata.", 404);
    if (row.legacy)
      throw new WorkspaceError(
        "Le avventure esistenti si modificano solo nella copia locale del laboratorio.",
        403,
      );
    if (p.action === "publishAdventure") {
      if (typeof p.published !== "boolean")
        throw new WorkspaceError("Stato non valido.", 400);
      const result = await db
        .prepare(
          "UPDATE gdr_workspace_adventures SET published=?,revision=revision+1 WHERE id=? AND revision=?",
        )
        .bind(+p.published, p.id, p.revision ?? -1)
        .run();
      changed(result);
      return { saved: true };
    }
    const result = await db
      .prepare(
        "UPDATE gdr_workspace_adventures SET title=?,source=?,revision=revision+1 WHERE id=? AND revision=?",
      )
      .bind(
        text(p.title, 160),
        text(p.source, 100000, true),
        p.id,
        p.revision ?? -1,
      )
      .run();
    changed(result);
    return { saved: true };
  }
  if (p.action === "createCharacter") {
    requireMaster(user);
    if (
      !validId(p.id) ||
      !validId(p.adventureId) ||
      !["pg", "png"].includes(p.kind)
    )
      throw new WorkspaceError("Personaggio non valido.", 400);
    const adventure = await db
      .prepare("SELECT id FROM gdr_workspace_adventures WHERE id=?")
      .bind(p.adventureId)
      .first();
    if (!adventure) throw new WorkspaceError("Avventura non trovata.", 404);
    await db
      .prepare(
        `INSERT INTO gdr_workspace_characters (id,adventure_id,kind,name,portrait,sheet,profile_json,photo,inventory_json,created_by,created_at,fields_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        p.id,
        p.adventureId,
        p.kind,
        text(p.name, 160),
        portrait(p.portrait ?? ""),
        text(p.sheet ?? "", 20000, true),
        JSON.stringify(profile(p.profile)),
        portrait(p.photo ?? ""),
        JSON.stringify(inventory(p.items ?? [])),
        user.id,
        new Date().toISOString(),
        JSON.stringify(
          await validateCharacterFields(
            db,
            p.adventureId,
            p.characterFields ?? {},
          ),
        ),
      )
      .run();
    return { saved: true, id: p.id };
  }
  const character = await db
    .prepare("SELECT * FROM gdr_workspace_characters WHERE id=?")
    .bind(p.characterId ?? "")
    .first();
  if (!character) throw new WorkspaceError("Personaggio non trovato.", 404);
  if (!Number.isSafeInteger(p.revision))
    throw new WorkspaceError("Revisione mancante.", 400);
  const master = isMaster(user);
  if (p.action === "deleteCharacter") {
    requireMaster(user);
    const result = await db
      .prepare("DELETE FROM gdr_workspace_characters WHERE id=? AND revision=?")
      .bind(character.id, p.revision)
      .run();
    changed(result);
    return { saved: true };
  }
  if (p.action === "grant") {
    requireMaster(user);
    if (
      !Number.isSafeInteger(p.userId) ||
      ![p.canSpeak, p.canEditSheet, p.canInventory].every(
        (v) => typeof v === "boolean",
      )
    )
      throw new WorkspaceError("Permessi non validi.", 400);
    if (character.kind === "png" && p.canEditSheet)
      throw new WorkspaceError(
        "La scheda di un PNG può essere modificata soltanto dal master.",
        400,
      );
    const target = await db
      .prepare("SELECT id FROM users WHERE id=? AND is_test=0")
      .bind(p.userId)
      .first();
    if (!target) throw new WorkspaceError("Giocatore non trovato.", 404);
    // Il trigger della revisione rende atomica la verifica anche se due master assegnano insieme.
    const result = await db
      .prepare(
        `INSERT INTO gdr_workspace_grants (character_id,user_id,can_speak,can_edit_sheet,can_inventory)
      SELECT id,?,?,?,? FROM gdr_workspace_characters WHERE id=? AND revision=?
      ON CONFLICT(character_id,user_id) DO UPDATE SET can_speak=excluded.can_speak,can_edit_sheet=excluded.can_edit_sheet,can_inventory=excluded.can_inventory`,
      )
      .bind(
        p.userId,
        +p.canSpeak,
        +p.canEditSheet,
        +p.canInventory,
        character.id,
        p.revision,
      )
      .run();
    changed(result);
    return { saved: true };
  }
  if (p.action === "adjustResource") {
    if (
      character.kind !== "pg" ||
      !["stressCurrent", "spellSlotsCurrent"].includes(p.fieldKey) ||
      ![-1, 1].includes(p.delta)
    )
      throw new WorkspaceError("Risorsa non valida.", 400);
    const grant = master
      ? null
      : await db
          .prepare(
            "SELECT can_speak,can_edit_sheet FROM gdr_workspace_grants WHERE character_id=? AND user_id=?",
          )
          .bind(character.id, user.id)
          .first();
    if (
      !master &&
      (character.archived || !(grant?.can_speak || grant?.can_edit_sheet))
    )
      throw new WorkspaceError("Non puoi modificare questa risorsa.", 403);
    const schema = await db
      .prepare("SELECT fields_json FROM gdr_character_schema WHERE adventure=?")
      .bind(character.adventure_id)
      .first();
    const field = schema
      ? JSON.parse(schema.fields_json).find(
          (f) => f.key === p.fieldKey && f.type === "number",
        )
      : null;
    if (!field) throw new WorkspaceError("Risorsa non disponibile.", 400);
    const fields = JSON.parse(character.fields_json);
    const value =
      Number(fields[p.fieldKey] ?? field.default ?? field.min) + p.delta;
    if (!Number.isInteger(value) || value < field.min || value > field.max)
      throw new WorkspaceError(
        "Hai raggiunto il limite di questa risorsa.",
        400,
      );
    fields[p.fieldKey] = String(value);
    const result = await db
      .prepare(
        `UPDATE gdr_workspace_characters SET fields_json=?,revision=revision+1 WHERE id=? AND revision=? AND (?=1 OR (archived=0 AND EXISTS(SELECT 1 FROM gdr_workspace_grants g WHERE g.character_id=gdr_workspace_characters.id AND g.user_id=? AND (g.can_speak=1 OR g.can_edit_sheet=1))))`,
      )
      .bind(JSON.stringify(fields), character.id, p.revision, +master, user.id)
      .run();
    changed(result);
    return { saved: true };
  }
  const statKeys = ["statMente", "statCuore", "statCorpo", "statMagia"];
  if (p.action === "setStatAccess") {
    requireMaster(user);
    if (
      character.kind !== "pg" ||
      character.adventure_id !== "il-prezzo-della-verita" ||
      typeof p.editable !== "boolean" ||
      !Number.isInteger(p.budget) ||
      p.budget < 4 ||
      p.budget > 20
    )
      throw new WorkspaceError("Configurazione dei punti non valida.", 400);
    const result = await db
      .prepare(
        "UPDATE gdr_workspace_characters SET stats_editable=?,stats_budget=?,revision=revision+1 WHERE id=? AND revision=?",
      )
      .bind(+p.editable, p.budget, character.id, p.revision)
      .run();
    changed(result);
    return { saved: true };
  }
  if (p.action === "confirmStats") {
    if (
      character.kind !== "pg" ||
      character.adventure_id !== "il-prezzo-della-verita"
    )
      throw new WorkspaceError(
        "Queste caratteristiche non sono disponibili.",
        400,
      );
    const grant = master
      ? null
      : await db
          .prepare(
            "SELECT can_edit_sheet FROM gdr_workspace_grants WHERE character_id=? AND user_id=?",
          )
          .bind(character.id, user.id)
          .first();
    if (
      !master &&
      (character.archived ||
        !character.stats_editable ||
        !grant?.can_edit_sheet)
    )
      throw new WorkspaceError(
        "Le caratteristiche sono bloccate. Chiedi al master di riaprire la distribuzione.",
        403,
      );
    const values = statKeys.map((key) => Number(p.values?.[key]));
    if (
      values.some((n) => !Number.isInteger(n) || n < 1 || n > 5) ||
      values.reduce((a, b) => a + b, 0) !== character.stats_budget
    )
      throw new WorkspaceError(
        `Distribuisci esattamente ${character.stats_budget} punti, da 1 a 5 per caratteristica.`,
        400,
      );
    const fields = {
      ...JSON.parse(character.fields_json),
      ...Object.fromEntries(statKeys.map((key, i) => [key, String(values[i])])),
    };
    const result = await db
      .prepare(
        `UPDATE gdr_workspace_characters SET fields_json=?,stats_editable=0,revision=revision+1 WHERE id=? AND revision=? AND (?=1 OR (stats_editable=1 AND archived=0 AND EXISTS(SELECT 1 FROM gdr_workspace_grants g WHERE g.character_id=gdr_workspace_characters.id AND g.user_id=? AND g.can_edit_sheet=1)))`,
      )
      .bind(JSON.stringify(fields), character.id, p.revision, +master, user.id)
      .run();
    changed(result);
    return { saved: true };
  }
  if (p.action === "saveCharacter") {
    if (
      !master &&
      character.adventure_id === "il-prezzo-della-verita" &&
      p.characterFields
    ) {
      const current = JSON.parse(character.fields_json);
      if (
        statKeys.some(
          (key) =>
            p.characterFields[key] !== undefined &&
            String(p.characterFields[key]) !== String(current[key] ?? "1"),
        )
      )
        throw new WorkspaceError(
          "Usa Conferma caratteristiche per distribuire i punti. Il normale salvataggio non modifica le caratteristiche di base.",
          403,
        );
    }

    const result = await db
      .prepare(
        `UPDATE gdr_workspace_characters SET name=?,portrait=?,sheet=?,profile_json=?,photo=?,fields_json=?,revision=revision+1
      WHERE id=? AND revision=? AND (?=1 OR (kind='pg' AND archived=0 AND EXISTS(SELECT 1 FROM gdr_workspace_grants g WHERE g.character_id=gdr_workspace_characters.id AND g.user_id=? AND g.can_edit_sheet=1)))`,
      )
      .bind(
        text(p.name, 160),
        portrait(p.portrait ?? ""),
        master ? text(p.sheet, 20000, true) : character.sheet,
        JSON.stringify(
          profile({
            ...JSON.parse(character.profile_json),
            ...p.profile,
            ...(!master
              ? {
                  abilities: JSON.parse(character.profile_json).abilities ?? "",
                }
              : {}),
          }),
        ),
        portrait(p.photo ?? character.photo),
        JSON.stringify(
          await validateCharacterFields(
            db,
            character.adventure_id,
            !master && character.adventure_id === "il-prezzo-della-verita"
              ? {
                  ...(p.characterFields ?? JSON.parse(character.fields_json)),
                  ...Object.fromEntries(
                    statKeys.map((k) => [
                      k,
                      JSON.parse(character.fields_json)[k] ?? "1",
                    ]),
                  ),
                }
              : (p.characterFields ?? JSON.parse(character.fields_json)),
          ),
        ),
        character.id,
        p.revision,
        master ? 1 : 0,
        user.id,
      )
      .run();
    await permittedChange(db, user, character, p, result, "can_edit_sheet");
    return { saved: true };
  }
  if (p.action === "inventory") {
    const data = JSON.stringify(inventory(p.items));
    const result = await db
      .prepare(
        `UPDATE gdr_workspace_characters SET inventory_json=?,revision=revision+1
      WHERE id=? AND revision=? AND (?=1 OR (archived=0 AND EXISTS(SELECT 1 FROM gdr_workspace_grants g WHERE g.character_id=gdr_workspace_characters.id AND g.user_id=? AND g.can_inventory=1)))`,
      )
      .bind(data, character.id, p.revision, master ? 1 : 0, user.id)
      .run();
    await permittedChange(db, user, character, p, result, "can_inventory");
    return { saved: true };
  }
  if (p.action === "archive") {
    requireMaster(user);
    if (typeof p.archived !== "boolean")
      throw new WorkspaceError("Stato non valido.", 400);
    const result = await db
      .prepare(
        "UPDATE gdr_workspace_characters SET archived=?,revision=revision+1 WHERE id=? AND revision=?",
      )
      .bind(+p.archived, character.id, p.revision)
      .run();
    changed(result);
    return { saved: true };
  }
  throw new WorkspaceError("Operazione non valida.", 400);
}
function changed(result) {
  if (!result.meta.changes)
    throw new WorkspaceError(
      "I dati sono cambiati in un’altra scheda. Ricarica prima di salvare; il testo che stai scrivendo resta disponibile.",
      409,
    );
}
async function permittedChange(db, user, character, p, result, permission) {
  if (result.meta.changes) return;
  const grant = await db
    .prepare(
      "SELECT can_edit_sheet,can_inventory FROM gdr_workspace_grants WHERE character_id=? AND user_id=?",
    )
    .bind(character.id, user.id)
    .first();
  if (
    !isMaster(user) &&
    (character.archived ||
      !grant?.[permission] ||
      (permission === "can_edit_sheet" && character.kind === "png"))
  )
    throw new WorkspaceError(
      "Non hai il permesso di modificare questi dati.",
      403,
    );
  changed(result);
}
export async function onRequestPost(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);
    const data = await readLimited(context.request, 500000);
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(data));
    } catch {
      throw new WorkspaceError("Richiesta non valida.", 400);
    }
    return json(
      await mutate(
        context.env.DB.withSession("first-primary"),
        session.user,
        payload,
      ),
    );
  } catch (error) {
    return failure(error, "gdr_workspace_mutation_error");
  }
}
