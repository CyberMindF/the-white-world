import { getAuthenticatedSession, json } from "../auth/_shared.js";
import {
  effectiveGrantsSql,
  WorkspaceError,
  isMaster,
  validId,
  readLimited,
  failure,
} from "./_shared.js";

/** Riceve solo WebP generati dal client: foto e avatar conservati nei media privati. */
export async function uploadCharacterMedia(db, media, user, request) {
  if (user.isTest)
    throw new WorkspaceError(
      "Caricamento disattivato per gli account di prova.",
      403,
    );
  const url = new URL(request.url);
  const id = url.searchParams.get("character");
  const slot = url.searchParams.get("slot");
  if (!validId(id) || !["photo", "avatar"].includes(slot))
    throw new WorkspaceError("Personaggio o immagine non validi.", 400);
  const c = await db
    .prepare(
      `SELECT c.*,g.can_edit_sheet FROM gdr_workspace_characters c LEFT JOIN (${effectiveGrantsSql}) g ON g.character_id=c.id AND g.user_id=? WHERE c.id=?`,
    )
    .bind(user.id, id)
    .first();
  if (!c) throw new WorkspaceError("Personaggio non trovato.", 404);
  if (
    !isMaster(user) &&
    ((c.kind !== "pg" && !c.is_pet) || c.archived || c.can_edit_sheet !== 1)
  )
    throw new WorkspaceError(
      "Non puoi modificare le immagini di questo personaggio.",
      403,
    );
  if (request.headers.get("Content-Type") !== "image/webp")
    throw new WorkspaceError("Formato immagine non valido.", 415);
  const data = await readLimited(request, 2 * 1024 * 1024);
  const header = new TextDecoder().decode(data.subarray(0, 16));
  if (
    data.length < 16 ||
    !header.startsWith("RIFF") ||
    header.slice(8, 12) !== "WEBP"
  )
    throw new WorkspaceError("Il file non è un’immagine WebP valida.", 415);
  const key = `gdr-workspace/${id}/${slot}/${crypto.randomUUID()}.webp`;
  await media.put(key, data, {
    httpMetadata: {
      contentType: "image/webp",
      cacheControl: "private, max-age=300",
    },
  });
  return { path: "/api/media/" + key };
}
export async function onRequestPost(context) {
  try {
    const session = await getAuthenticatedSession(context.request, context.env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);
    return json(
      await uploadCharacterMedia(
        context.env.DB.withSession("first-primary"),
        context.env.MEDIA,
        session.user,
        context.request,
      ),
      201,
    );
  } catch (error) {
    return failure(error, "gdr_workspace_media_error");
  }
}
