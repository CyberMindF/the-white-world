import { getAuthenticatedSession, json, readJson } from "../auth/_shared.js";
import { hasPermission } from "../_shared/permissions.js";
import { recordEvent } from "../_shared/events.js";
import { notifyRealtime } from "../_shared/realtime.js";
import { normalizeData, normalizeType } from "./_shared.js";
import { toBlockView } from "./index.js";

// Modifica tipo e contenuto del blocco (documento e posizione restano invariati: per
// spostarlo dentro il documento c'è move.js).
export async function onRequestPut(context) {
  const { request, env, params } = context;
  try {
    const session = await getAuthenticatedSession(request, env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);
    if (!hasPermission(session.user.role, "content.edit")) {
      return json({ error: "Non autorizzato." }, 403);
    }

    const existing = await env.DB.prepare("SELECT id FROM gdr_blocks WHERE id = ?").bind(params.id).first();
    if (!existing) {
      return json({ error: "Blocco non trovato." }, 404);
    }

    const payload = await readJson(request);
    const type = normalizeType(payload?.type);
    const data = normalizeData(payload?.data);

    if (!type) return json({ error: "Tipo di blocco non valido." }, 400);
    if (!data) return json({ error: "Contenuto del blocco non valido." }, 400);

    const now = new Date().toISOString();
    await env.DB
      .prepare("UPDATE gdr_blocks SET type = ?, data = ?, updated_at = ? WHERE id = ?")
      .bind(type, data, now, params.id)
      .run();

    context.waitUntil(recordEvent(env, { userId: session.user.id, sessionId: session.sessionId }, {
      section: "gdr",
      eventType: "content_updated",
      metadata: { blockId: params.id }
    }));

    const updated = await env.DB.prepare("SELECT * FROM gdr_blocks WHERE id = ?").bind(params.id).first();
    return json(toBlockView(updated));
  } catch (error) {
    console.error(JSON.stringify({ event: "gdr_blocks_update_error", message: error.message }));
    return json({ error: "Non è stato possibile salvare il blocco." }, 500);
  }
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  try {
    const session = await getAuthenticatedSession(context.request, env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);
    if (session.user.isTest || !hasPermission(session.user.role, "content.delete")) {
      return json({ error: "Non autorizzato." }, 403);
    }

    const existing = await env.DB.prepare("SELECT id,updated_at,document_key,type,data FROM gdr_blocks WHERE id = ?").bind(params.id).first();
    if (!existing) {
      return json({ error: "Blocco non trovato." }, 404);
    }

    const jsonBody=context.request.headers.get('Content-Type')?.includes('application/json');
    const payload=jsonBody ? await readJson(context.request) : null;
    if(jsonBody && (!payload || typeof payload!=='object' || Array.isArray(payload))) return json({error:'Richiesta non valida.'},400);
    const hasSnapshot=payload && ('expectedUpdatedAt' in payload || 'expectedType' in payload || 'expectedData' in payload);
    if(hasSnapshot && (typeof payload.expectedUpdatedAt!=='string' || payload.expectedUpdatedAt!==existing.updated_at)) return json({error:'Il blocco è cambiato. Ricarica prima di eliminarlo.'},409);
    if(hasSnapshot && (payload.expectedType!==existing.type || JSON.stringify(payload.expectedData)!==JSON.stringify(JSON.parse(existing.data)))) return json({error:'Il blocco è cambiato. Ricarica prima di eliminarlo.'},409);
    const result=await env.DB.prepare("DELETE FROM gdr_blocks WHERE id = ? AND updated_at = ? AND type = ? AND data = ?").bind(params.id,existing.updated_at,existing.type,existing.data).run();
    if(!result.meta.changes) return json({error:'Il blocco è cambiato. Ricarica prima di eliminarlo.'},409);

    context.waitUntil(recordEvent(env, { userId: session.user.id, sessionId: session.sessionId }, {
      section: "gdr",
      eventType: "content_deleted",
      metadata: { blockId: params.id }
    }));
    const adventure=existing.document_key==='avventura'?'il-prezzo-della-verita':existing.document_key==='casa-avventura'?'la-casa-che-trattiene-il-respiro':null;
    if(adventure) context.waitUntil(notifyRealtime(env,{type:'gdr-story:changed',action:'deleted',actorUserId:session.user.id,adventure,blockId:params.id}));

    return json({ id: params.id, deleted: true });
  } catch (error) {
    console.error(JSON.stringify({ event: "gdr_blocks_delete_error", message: error.message }));
    return json({ error: "Non è stato possibile eliminare il blocco." }, 500);
  }
}
