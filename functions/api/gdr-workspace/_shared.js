import { json } from "../auth/_shared.js";
import { hasPermission } from "../_shared/permissions.js";
export const isMaster = (user) =>
  hasPermission(user.role, "content.create") && !user.isTest;
export const validId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(value);
// Permessi effettivi: le deleghe esplicite si sommano a quelle del PG assegnatario.
// Nessuna copia persistente: revoca, riassegnazione e archiviazione valgono subito,
// anche nelle condizioni SQL delle scritture da editor già aperti.
export const effectiveGrantsSql = `
  SELECT character_id,user_id,MAX(can_speak) AS can_speak,
    MAX(can_edit_sheet) AS can_edit_sheet,MAX(can_inventory) AS can_inventory
  FROM (
    SELECT g.character_id,g.user_id,g.can_speak,
      CASE WHEN c.kind='pg' THEN g.can_edit_sheet ELSE 0 END AS can_edit_sheet,g.can_inventory
    FROM gdr_workspace_grants g JOIN gdr_workspace_characters c ON c.id=g.character_id
    UNION ALL
    SELECT pet.id,g.user_id,g.can_speak,g.can_edit_sheet,g.can_inventory
    FROM gdr_workspace_characters pet
    JOIN gdr_workspace_characters pg ON pg.id=pet.pet_owner_id
      AND pg.kind='pg' AND pg.adventure_id=pet.adventure_id AND pg.archived=0
    JOIN gdr_workspace_grants g ON g.character_id=pg.id
    WHERE pet.kind='png' AND pet.is_pet=1 AND pet.archived=0
  ) GROUP BY character_id,user_id`;
export function text(value, max, empty = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim())
  )
    throw new WorkspaceError("Testo mancante o troppo lungo.", 400);
  return value;
}
export class WorkspaceError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export function requireMaster(user) {
  if (!isMaster(user))
    throw new WorkspaceError(
      "Solo il master può eseguire questa operazione.",
      403,
    );
}
export function portrait(value) {
  if (value === "") return "";
  if (
    typeof value !== "string" ||
    value.length > 500 ||
    !/^\/(?:assets|api\/media)\/[a-zA-Z0-9/_%.\-]+\.(?:webp|png|jpe?g|gif)$/i.test(
      value,
    ) ||
    /%2e|%2f|%5c|\.\./i.test(value)
  )
    throw new WorkspaceError("Usa il percorso di un ritratto del sito.", 400);
  return value;
}
export function inventory(value) {
  if (!Array.isArray(value) || value.length > 100)
    throw new WorkspaceError(
      "Lo zaino può contenere al massimo 100 voci.",
      400,
    );
  const ids = new Set();
  return value.map((item) => {
    if (
      !item ||
      !validId(item.id) ||
      ids.has(item.id) ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 0 ||
      item.quantity > 99999
    )
      throw new WorkspaceError("Oggetto o quantità non validi.", 400);
    ids.add(item.id);
    return {
      id: item.id,
      name: text(item.name, 160),
      quantity: item.quantity,
      notes: text(item.notes ?? "", 2000, true),
    };
  });
}
export function profile(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WorkspaceError("Profilo non valido.", 400);
  const result = {};
  for (const key of [
    "surname",
    "race",
    "age",
    "appearance",
    "personality",
    "history",
    "goal",
    "abilities",
  ])
    result[key] = text(value[key] ?? "", key === "surname" ? 160 : 6000, true);
  return result;
}
export async function readLimited(request, max) {
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceError("Richiesta vuota.", 400);
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new WorkspaceError("File o richiesta troppo grande.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export function characterView(row, user) {
  const master = isMaster(user);
  return {
    id: row.id,
    adventureId: row.adventure_id,
    kind: row.kind,
    isPet: row.is_pet === 1,
    petOwnerId: row.pet_owner_id ?? null,
    name: row.name,
    portrait: row.portrait,
    sheet: row.sheet,
    characterFields: JSON.parse(row.fields_json ?? '{}'),
    legacyProtagonist: row.legacy_protagonist === 1,
    photo: row.photo ?? "",
    profile: JSON.parse(row.profile_json ?? "{}"),
    inventory: JSON.parse(row.inventory_json),
    archived: row.archived === 1,
    revision: row.revision,
    canSpeak: !row.archived && (master || row.can_speak === 1),
    canEditSheet: master || (!row.archived && (row.kind === "pg" || row.is_pet === 1) && row.can_edit_sheet === 1),
    canInventory: master || row.can_inventory === 1,
    canAdjustResources: !row.archived && (master || ((row.kind==='pg' || row.is_pet===1) && (row.can_speak===1 || row.can_edit_sheet===1))),
    statsEditable: row.stats_editable === 1,
    statsBudget: row.stats_budget ?? 12,
    canEditStats: row.kind === 'pg' && row.adventure_id === 'il-prezzo-della-verita' && !row.archived && row.stats_editable === 1 && (master || row.can_edit_sheet === 1),
  };
}
export function failure(error, event) {
  if (error instanceof WorkspaceError)
    return json({ error: error.message }, error.status);
  // Un ambiente non ancora migrato resta utilizzabile per leggere le vecchie avventure.
  if (
    /(?:no such table.*gdr_workspace|no such column.*(?:photo|profile_json))/.test(
      error.message ?? "",
    )
  )
    return json(
      {
        error:
          "La gestione delle nuove avventure richiede l’aggiornamento del database del laboratorio.",
      },
      503,
    );
  console.error(JSON.stringify({ event, message: error.message }));
  return json(
    { error: "Non è stato possibile completare l’operazione. Riprova." },
    500,
  );
}
