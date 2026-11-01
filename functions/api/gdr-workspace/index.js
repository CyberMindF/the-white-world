import { getAuthenticatedSession, json } from "../auth/_shared.js";
import { isMaster, characterView, failure, validId } from "./_shared.js";

export async function onRequestGet(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);
    const user = session.user,
      db = context.env.DB.withSession("first-primary");
    const adventure = new URL(context.request.url).searchParams.get(
      "adventure",
    );
    if (adventure && !validId(adventure))
      return json({ error: "Avventura non valida." }, 400);
    const adventures = await db
      .prepare(
        "SELECT id,title,source,legacy,published,revision FROM gdr_workspace_adventures WHERE ?=1 OR published=1 ORDER BY legacy DESC,created_at,id",
      )
      .bind(isMaster(user) ? 1 : 0)
      .all();
    let characters = [],
      grants = [];
    if (adventure) {
      if (!adventures.results.some((a) => a.id === adventure))
        return json({ error: "Avventura non trovata." }, 404);
      const result = await db
        .prepare(
          `SELECT c.*, g.can_speak,g.can_edit_sheet,g.can_inventory,
        EXISTS(SELECT 1 FROM gdr_workspace_story_links l WHERE l.adventure_id=c.adventure_id AND l.source_key='pg' AND l.character_id=c.id) AS legacy_protagonist
        FROM gdr_workspace_characters c LEFT JOIN gdr_workspace_grants g ON g.character_id=c.id AND g.user_id=?
        WHERE c.adventure_id=? AND (?=1 OR (g.user_id IS NOT NULL AND c.archived=0 AND (g.can_speak=1 OR g.can_edit_sheet=1 OR g.can_inventory=1))) ORDER BY c.created_at,c.id`,
        )
        .bind(user.id, adventure, isMaster(user) ? 1 : 0)
        .all();
      characters = result.results.map((row) => characterView(row, user));
      if (isMaster(user))
        grants = (
          await db
            .prepare(
              "SELECT g.* FROM gdr_workspace_grants g INNER JOIN gdr_workspace_characters c ON c.id=g.character_id WHERE c.adventure_id=?",
            )
            .bind(adventure)
            .all()
        ).results;
    }
    const users = isMaster(user)
      ? (
          await db
            .prepare(
              "SELECT id,nickname FROM users WHERE is_test=0 ORDER BY id",
            )
            .all()
        ).results
      : [];
    const storyCharacters = adventure
      ? (
          await db
            .prepare(
              `SELECT l.source_key,c.name,c.portrait,c.profile_json,l.character_id FROM gdr_workspace_story_links l LEFT JOIN gdr_workspace_characters c ON c.id=l.character_id WHERE l.adventure_id=? AND l.source_key LIKE 'npc:%'`,
            )
            .bind(adventure)
            .all()
        ).results.map((r) => ({
          sourceKey: r.source_key,
          deleted: !r.character_id,
          name: r.name,
          portrait: r.portrait,
          description: r.profile_json
            ? (JSON.parse(r.profile_json).appearance ?? "")
            : "",
        }))
      : [];
    return json({
      storyCharacters,
      adventures: adventures.results.map((a) => ({
        ...a,
        legacy: a.legacy === 1,
        published: a.published === 1,
      })),
      characters,
      grants: grants
        .filter((g) => g.can_speak || g.can_edit_sheet || g.can_inventory)
        .map((g) => ({
          characterId: g.character_id,
          userId: g.user_id,
          canSpeak: g.can_speak === 1,
          canEditSheet: g.can_edit_sheet === 1,
          canInventory: g.can_inventory === 1,
        })),
      users,
      isMaster: isMaster(user),
    });
  } catch (error) {
    return failure(error, "gdr_workspace_get_error");
  }
}
