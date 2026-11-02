import { getAuthenticatedSession, json, readJson } from "../auth/_shared.js";
import { hasPermission } from "../_shared/permissions.js";
import { recordEvent } from "../_shared/events.js";
import { notifyRealtime } from "../_shared/realtime.js";
import { normalizeData, normalizeDocumentKey, normalizeType } from "./_shared.js";

// Editor dedicato del GDR (documentazione/cms/planning-editor-contenuti.md, Fase 7; documentazione/cms/inventario-contenuti.md,
// decisione #4). Un'unica collezione per entrambi i documenti (avventura, maga-regole):
// `document_key` scoping la posizione, stesso pattern di category_id per i simboli del
// Linguaggio Segreto. Nessun comando "Sposta…" qui: i blocchi non si spostano da un documento
// all'altro (sono due pagine diverse), solo su/giù dentro lo stesso documento.
export async function onRequestGet(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);
    if (!hasPermission(session.user.role, "content.read")) {
      return json({ error: "Non autorizzato." }, 403);
    }

    const { results } = await context.env.DB
      .prepare("SELECT * FROM gdr_blocks ORDER BY document_key, position")
      .all();

    return json({ blocks: results.map(toBlockView) });
  } catch (error) {
    console.error(JSON.stringify({ event: "gdr_blocks_list_error", message: error.message }));
    return json({ error: "Errore interno del server." }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const session = await getAuthenticatedSession(request, env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);
    if (session.user.isTest || !hasPermission(session.user.role, "content.create")) {
      return json({ error: "Non autorizzato." }, 403);
    }

    const payload = await readJson(request);
    const documentKey = normalizeDocumentKey(payload?.documentKey);
    const type = normalizeType(payload?.type);
    const data = normalizeData(payload?.data);

    if (!documentKey) return json({ error: "Documento non valido." }, 400);
    if (!type) return json({ error: "Tipo di blocco non valido." }, 400);
    if (!data) return json({ error: "Contenuto del blocco non valido." }, 400);

    const maxId = await env.DB.prepare("SELECT MAX(id) AS max FROM gdr_blocks").first();
    const id = (maxId?.max ?? 0) + 1;
    const maxPosition = await env.DB
      .prepare("SELECT MAX(position) AS max FROM gdr_blocks WHERE document_key = ?")
      .bind(documentKey)
      .first();
    const position = (maxPosition?.max ?? -1) + 1;
    const now = new Date().toISOString();

    if(payload.beforeId!==undefined){
      const before=await env.DB.prepare('SELECT * FROM gdr_blocks WHERE id=? AND document_key=?').bind(payload.beforeId,documentKey).first();
      if(!before || before.updated_at!==payload.expectedBeforeUpdatedAt || JSON.stringify(JSON.parse(before.data))!==JSON.stringify(payload.expectedBeforeData))return json({error:'La storia è cambiata. Ricarica prima di aggiungere il blocco.'},409);
      const results=await env.DB.batch([
        env.DB.prepare('UPDATE gdr_blocks SET position=position+1 WHERE document_key=? AND position >= (SELECT position FROM gdr_blocks WHERE id=? AND document_key=?) AND EXISTS(SELECT 1 FROM gdr_blocks WHERE id=? AND data=? AND updated_at=?)').bind(documentKey,before.id,documentKey,before.id,before.data,before.updated_at),
        env.DB.prepare('INSERT INTO gdr_blocks(id,document_key,type,data,position,created_by,created_at,updated_at) SELECT ?,?,?,?,position-1,?,?,? FROM gdr_blocks WHERE id=? AND data=? AND updated_at=?').bind(id,documentKey,type,data,session.user.id,now,now,before.id,before.data,before.updated_at),
      ]);
      if(!results[1].meta.changes)return json({error:'La storia è cambiata. Ricarica prima di aggiungere il blocco.'},409);
    }else{
      await env.DB.prepare(`
        INSERT INTO gdr_blocks (id, document_key, type, data, position, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(id, documentKey, type, data, position, session.user.id, now, now)
      .run();
    }

    context.waitUntil(recordEvent(env, { userId: session.user.id, sessionId: session.sessionId }, {
      section: "gdr",
      eventType: "content_created",
      metadata: { blockId: id, documentKey }
    }));
    const adventure=documentKey==='avventura'?'il-prezzo-della-verita':documentKey==='casa-avventura'?'la-casa-che-trattiene-il-respiro':null;
    if(adventure)context.waitUntil(notifyRealtime(env,{type:'gdr-story:changed',action:'created',actorUserId:session.user.id,adventure,blockId:String(id)}));

    const created = await env.DB.prepare("SELECT * FROM gdr_blocks WHERE id = ?").bind(id).first();
    return json(toBlockView(created), 201);
  } catch (error) {
    console.error(JSON.stringify({ event: "gdr_blocks_create_error", message: error.message }));
    return json({ error: "Non è stato possibile creare il blocco." }, 500);
  }
}

export function toBlockView(row) {
  return {
    id: String(row.id),
    documentKey: row.document_key,
    type: row.type,
    data: JSON.parse(row.data),
    position: row.position,
    updatedAt: row.updated_at
  };
}
