import { getAuthenticatedSession, json, readJson } from "../auth/_shared.js";
import {
  isMaster,
  validId,
  text,
  WorkspaceError,
  failure,
} from "../gdr-workspace/_shared.js";
import { normalizeType, normalizeData } from "../gdr-blocks/_shared.js";
import { recordEvent } from "../_shared/events.js";
import { notifyRealtime } from "../_shared/realtime.js";

export function referenceBlocks(value) {
  if (
    !Array.isArray(value) ||
    value.length > 200 ||
    JSON.stringify(value).length > 200000 ||
    value.some(
      (block) =>
        !block || !normalizeType(block.type) || !normalizeData(block.data),
    )
  )
    throw new WorkspaceError("Controlla il contenuto e le tabelle.", 400);
  return value.map(({ type, data }) => ({ type, data }));
}

async function masterSession(context) {
  const session = await getAuthenticatedSession(context.request, context.env);
  if (!session) throw new WorkspaceError("Accesso richiesto.", 401);
  if (
    !isMaster(session.user) ||
    !session.adminModeEnabled ||
    session.user.safeMode
  )
    throw new WorkspaceError(
      "Attiva la Modalità admin per gestire questi contenuti.",
      403,
    );
  return session;
}

export async function onRequestGet(context) {
  try {
    await masterSession(context);
    const db = context.env.DB.withSession("first-primary");
    const powers = (
      await db
        .prepare(
          "SELECT * FROM gdr_powers ORDER BY kind,name COLLATE NOCASE,id",
        )
        .all()
    ).results;
    const adventures = (
      await db
        .prepare("SELECT id,title FROM gdr_workspace_adventures ORDER BY title")
        .all()
    ).results;
    const characters = (
      await db
        .prepare(
          "SELECT id,name,kind,adventure_id AS adventureId,archived FROM gdr_workspace_characters ORDER BY name",
        )
        .all()
    ).results;
    const availability = (
      await db.prepare("SELECT * FROM gdr_power_availability").all()
    ).results;
    const assignments = (
      await db.prepare("SELECT * FROM gdr_character_powers").all()
    ).results;
    const systems=(await db.prepare('SELECT id,name FROM gdr_systems ORDER BY name COLLATE NOCASE').all()).results;
    const systemLinks=(await db.prepare('SELECT * FROM gdr_system_powers').all()).results;
    return json({
      systems,
      adventures,
      characters,
      powers: powers.map((p) => ({
        id: p.id,
        kind: p.kind,
        name: p.name,
        description: p.description,
        effects: JSON.parse(p.effects_json),
        revision: p.revision,
        systemIds:systemLinks.filter(l=>l.power_id===p.id).map(l=>l.system_id),
        adventureIds: availability
          .filter((a) => a.power_id === p.id)
          .map((a) => a.adventure_id),
        characterIds: assignments
          .filter((a) => a.power_id === p.id)
          .map((a) => a.character_id),
      })),
    });
  } catch (error) {
    return failure(error, "gdr_powers_get_error");
  }
}

export async function onRequestPost(context) {
  try {
    const session = await masterSession(context),
      body = await readJson(context.request);
    if (!body || !validId(body.id) || !["ability", "spell"].includes(body.kind))
      throw new WorkspaceError("Abilità o magia non valida.", 400);
    const name = text(body.name, 160).trim(),
      description = text(body.description ?? "", 20000, true);
    const effects = referenceBlocks(body.effects ?? []);
    const ids = (value) => {
      if (
        !Array.isArray(value) ||
        value.length > 200 ||
        value.some((id) => !validId(id)) ||
        new Set(value).size !== value.length
      )
        throw new WorkspaceError("Assegnazioni non valide.", 400);
      return value;
    };
    let adventureIds = ids(body.adventureIds ?? []);
    const preserveAssignments = body.characterIds === undefined;
    const characterIds = preserveAssignments ? null : ids(body.characterIds);
    const db = context.env.DB.withSession("first-primary");
    const previous = await db
      .prepare("SELECT revision FROM gdr_powers WHERE id=?")
      .bind(body.id)
      .first();
    const creating = body.revision === null;
    if (
      (creating && previous) ||
      (!creating &&
        (!Number.isSafeInteger(body.revision) ||
          previous?.revision !== body.revision))
    )
      throw new WorkspaceError(
        "La voce è cambiata. Ricarica il catalogo prima di salvare; la bozza resta disponibile.",
        409,
      );
    const adventures = (
      await db.prepare("SELECT id,system_id FROM gdr_workspace_adventures").all()
    ).results;
    const usingSystems=body.systemIds!==undefined || adventureIds.some(id=>adventures.some(a=>a.id===id && a.system_id));
    const systemIds=usingSystems ? ids(body.systemIds ?? [...new Set(adventureIds.map(id=>adventures.find(a=>a.id===id)?.system_id))]) : [];
    if(usingSystems){
      const known=(await db.prepare('SELECT id FROM gdr_systems WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(systemIds)).all()).results;
      if(known.length!==systemIds.length)throw new WorkspaceError('Seleziona sistemi esistenti.',400);
      adventureIds=adventures.filter(a=>systemIds.includes(a.system_id)).map(a=>a.id);
    }
    const characters = (
      await db
        .prepare("SELECT id,adventure_id FROM gdr_workspace_characters")
        .all()
    ).results;
    if (
      adventureIds.some((id) => !adventures.some((a) => a.id === id)) ||
      (characterIds ?? []).some(
        (id) =>
          !characters.some(
            (c) => c.id === id && adventureIds.includes(c.adventure_id),
          ),
      )
    )
      throw new WorkspaceError(
        "Ogni personaggio selezionato deve appartenere a una delle avventure abilitate.",
        400,
      );
    const revision = creating ? 1 : body.revision,
      now = new Date().toISOString();
    const previousAdventures = (
      await db
        .prepare(
          "SELECT adventure_id FROM gdr_power_availability WHERE power_id=?",
        )
        .bind(body.id)
        .all()
    ).results.map((a) => a.adventure_id);
    const previousSystems=usingSystems ? (await db.prepare('SELECT system_id FROM gdr_system_powers WHERE power_id=?').bind(body.id).all()).results.map(s=>s.system_id) : [];
    const statements = [];
    if (creating)
      statements.push(
        db
          .prepare(
            `INSERT INTO gdr_powers(id,kind,name,description,effects_json,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`,
          )
          .bind(
            body.id,
            body.kind,
            name,
            description,
            JSON.stringify(effects),
            session.user.id,
            now,
            now,
          ),
      );
    // Tutti i collegamenti sono protetti dalla stessa revisione, incrementata per ultima.
    // La batch D1 è atomica: un editor obsoleto non cancella le assegnazioni più recenti.
    const assignedGuard=usingSystems
      ? " AND NOT EXISTS(SELECT 1 FROM gdr_character_powers cp JOIN gdr_workspace_characters c ON c.id=cp.character_id JOIN gdr_workspace_adventures a ON a.id=c.adventure_id WHERE cp.power_id=? AND (a.system_id IS NULL OR a.system_id NOT IN(SELECT value FROM json_each(?))))"
      : " AND NOT EXISTS(SELECT 1 FROM gdr_character_powers cp JOIN gdr_workspace_characters c ON c.id=cp.character_id WHERE cp.power_id=? AND c.adventure_id NOT IN(SELECT value FROM json_each(?)))";
    const guard="EXISTS(SELECT 1 FROM gdr_powers WHERE id=? AND revision=?)"+(preserveAssignments?assignedGuard:'');
    const guardBindings=[body.id,revision,...(preserveAssignments?[body.id,JSON.stringify(usingSystems?systemIds:adventureIds)]:[])];
    if (!preserveAssignments) statements.push(
      db
        .prepare(
          `DELETE FROM gdr_character_powers WHERE power_id=? AND ${guard}`,
        )
        .bind(body.id, ...guardBindings),
    );
    statements.push(
      db
        .prepare(
          `DELETE FROM ${usingSystems ? "gdr_system_powers" : "gdr_power_adventures"} WHERE power_id=? AND ${guard}`,
        )
        .bind(body.id, ...guardBindings),
    );
    for (const id of usingSystems ? systemIds : adventureIds)
      statements.push(db.prepare(`INSERT INTO ${usingSystems ? 'gdr_system_powers(power_id,system_id)' : 'gdr_power_adventures(power_id,adventure_id)'} SELECT ?,? WHERE ${guard}`).bind(body.id,id,...guardBindings));
    if(usingSystems)statements.push(db.prepare(`UPDATE gdr_systems SET revision=revision+1 WHERE id IN(SELECT value FROM json_each(?)) AND ${guard}`).bind(JSON.stringify([...new Set([...previousSystems,...systemIds])]),...guardBindings));
    for (const id of characterIds ?? [])
      statements.push(
        db
          .prepare(
            `INSERT INTO gdr_character_powers(character_id,power_id) SELECT ?,? WHERE ${guard}`,
          )
          .bind(id, body.id, ...guardBindings),
      );
    if (!creating)
      statements.push(
        db
          .prepare(
            `UPDATE gdr_powers SET kind=?,name=?,description=?,effects_json=?,revision=revision+1,updated_at=? WHERE id=? AND ${guard}`,
          )
          .bind(
            body.kind,
            name,
            description,
            JSON.stringify(effects),
            now,
            body.id,
            ...guardBindings,
          ),
      );
    const results = await db.batch(statements);
    if (!creating && !results.at(-1).meta.changes)
      throw new WorkspaceError(
        "La voce o le assegnazioni sono cambiate. Ricarica il catalogo; per rimuovere un sistema, togli prima la voce dai personaggi che lo usano.",
        409,
      );
    context.waitUntil(
      recordEvent(
        context.env,
        { userId: session.user.id, sessionId: session.sessionId },
        {
          section: "gdr",
          eventType: creating ? "content_created" : "content_updated",
          metadata: { powerId: body.id },
        },
      ),
    );
    const affected = new Set([...adventureIds, ...previousAdventures]);
    for (const adventure of affected)
      context.waitUntil(
        notifyRealtime(context.env, {
          type: "gdr-story:changed",
          action: "powers_updated",
          actorUserId: session.user.id,
          adventure,
        }),
      );
    return json(
      { saved: true, id: body.id, revision: creating ? 1 : revision + 1 },
      creating ? 201 : 200,
    );
  } catch (error) {
    return failure(error, "gdr_powers_save_error");
  }
}

export { masterSession };
