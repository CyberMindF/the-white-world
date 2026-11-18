import { json, readJson } from "./auth/_shared.js";
import { masterSession, referenceBlocks } from "./gdr-powers/index.js";
import { validId, WorkspaceError, failure } from "./gdr-workspace/_shared.js";
import { recordEvent } from "./_shared/events.js";
import { notifyRealtime } from "./_shared/realtime.js";

export async function onRequestPut(context) {
  try {
    const session = await masterSession(context),
      body = await readJson(context.request);
    if (!validId(body?.adventureId) || !Number.isSafeInteger(body?.revision))
      throw new WorkspaceError("Avventura non valida.", 400);
    const blocks = referenceBlocks(body.blocks),
      db = context.env.DB.withSession("first-primary");
    const adventure=await db.prepare('SELECT system_id FROM gdr_workspace_adventures WHERE id=?').bind(body.adventureId).first();
    if(adventure?.system_id)throw new WorkspaceError('Le regole appartengono al sistema: modificale da Gestione GDR → Sistemi di gioco.',409);
    const result = await db
      .prepare(
        `UPDATE gdr_workspace_adventures SET rules_json=?,rules_revision=rules_revision+1
      WHERE id=? AND rules_revision=?`,
      )
      .bind(JSON.stringify(blocks), body.adventureId, body.revision)
      .run();
    if (!result.meta.changes)
      throw new WorkspaceError(
        "Le regole sono cambiate. Ricarica prima di salvare; il testo in modifica resta disponibile.",
        409,
      );
    context.waitUntil(
      recordEvent(
        context.env,
        { userId: session.user.id, sessionId: session.sessionId },
        {
          section: "gdr",
          eventType: "content_updated",
          metadata: { adventure: body.adventureId, document: "rules" },
        },
      ),
    );
    context.waitUntil(
      notifyRealtime(context.env, {
        type: "gdr-story:changed",
        action: "rules_updated",
        actorUserId: session.user.id,
        adventure: body.adventureId,
      }),
    );
    return json({ saved: true, blocks, revision: body.revision + 1 });
  } catch (error) {
    return failure(error, "gdr_rules_save_error");
  }
}
