import { json } from "../auth/_shared.js";
import { hasPermission } from "../_shared/permissions.js";
export const isMaster = (user) =>
  hasPermission(user.role, "content.create") && !user.isTest;
export const validId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(value);
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
    name: row.name,
    portrait: row.portrait,
    sheet: row.sheet,
    characterFields: JSON.parse(row.fields_json ?? '{}'),
    photo: row.photo ?? "",
    profile: JSON.parse(row.profile_json ?? "{}"),
    inventory: JSON.parse(row.inventory_json),
    archived: row.archived === 1,
    revision: row.revision,
    canSpeak: !row.archived && (master || row.can_speak === 1),
    canEditSheet: master || (row.kind === "pg" && row.can_edit_sheet === 1),
    canInventory: master || row.can_inventory === 1,
    canAdjustResources: row.kind==='pg' && !row.archived && (master || row.can_speak===1 || row.can_edit_sheet===1),
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
