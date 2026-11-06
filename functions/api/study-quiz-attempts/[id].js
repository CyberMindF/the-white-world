import { recordEvent } from "../_shared/events.js";
import { getAuthenticatedSession, json, readJson } from "../auth/_shared.js";
import {
  emptyAttemptAnswers,
  normalizeAttemptAnswers,
  parseAttemptJson,
  publicAttempt,
  scoreAttempt,
} from "../study-quizzes/_shared.js";

export async function onRequestGet({ request, env, params }) {
  try {
    const session = await getAuthenticatedSession(request, env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);
    const row = await loadAttempt(env, params.id);
    if (!row) return json({ error: "Tentativo non trovato." }, 404);
    if (row.user_id !== session.user.id && session.user.role !== "admin")
      return json({ error: "Non autorizzato." }, 403);
    return json({ attempt: publicAttempt(row) });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "study_quiz_attempt_get_error",
        message: error.message,
      }),
    );
    return json({ error: "Non è stato possibile caricare il tentativo." }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  try {
    const session = await getAuthenticatedSession(request, env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);
    const row = await loadAttempt(env, params.id);
    if (!row) return json({ error: "Tentativo non trovato." }, 404);
    if (row.user_id !== session.user.id)
      return json({ error: "Non autorizzato." }, 403);
    if (row.status !== "in_progress")
      return json({ error: "Il tentativo è già concluso." }, 409);
    const payload = await readJson(request);
    const snapshot = parseAttemptJson(row.snapshot_json, null);
    const previous = parseAttemptJson(row.answers_json, emptyAttemptAnswers());
    const answers = normalizeAttemptAnswers(
      snapshot,
      payload?.answers,
      previous,
    );
    const action = payload?.action ?? "save";
    if (
      ![
        "save",
        "correctQuestion",
        "correctQuiz",
        "revealOpen",
        "assessOpen",
        "complete",
      ].includes(action)
    ) {
      return json({ error: "Azione non valida." }, 400);
    }
    const questionId = Number(payload?.questionId);
    const question = snapshot.questions.find((item) => item.id === questionId);
    if (action === "correctQuestion") {
      if (
        snapshot.correctionMode !== "immediate" ||
        !question ||
        question.type === "open" ||
        answers.byQuestion[questionId].selectedOptionIds.length === 0
      )
        return json(
          { error: "Questa domanda non può essere corretta ora." },
          400,
        );
      answers.byQuestion[questionId].corrected = true;
    } else if (action === "correctQuiz") {
      if (snapshot.correctionMode !== "final") {
        return json({ error: "Il quiz usa la correzione immediata." }, 400);
      }
      for (const item of snapshot.questions)
        if (item.type !== "open") answers.byQuestion[item.id].corrected = true;
      answers.finalCorrectionShown = true;
    } else if (action === "revealOpen") {
      if (
        !question ||
        question.type !== "open" ||
        (snapshot.correctionMode === "final" && !answers.finalCorrectionShown)
      )
        return json(
          { error: "Questa risposta non può essere rivelata ora." },
          400,
        );
      answers.byQuestion[questionId].revealed = true;
    } else if (action === "assessOpen") {
      if (
        !question ||
        question.type !== "open" ||
        answers.byQuestion[questionId].revealed !== true ||
        !["correct", "incorrect"].includes(payload?.assessment)
      )
        return json({ error: "Valutazione non valida." }, 400);
      answers.byQuestion[questionId].assessment = payload.assessment;
    }
    const score = scoreAttempt(snapshot, answers);
    const canComplete = score.assessedCount === score.totalCount;
    const completed = action === "complete" && canComplete;
    if (action === "complete" && !canComplete)
      return json(
        { error: "Correggi tutte le domande prima di concludere." },
        409,
      );
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE study_quiz_attempts SET answers_json = ?, correct_count = ?, assessed_count = ?,
      status = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
    )
      .bind(
        JSON.stringify(answers),
        score.correctCount,
        score.assessedCount,
        completed ? "completed" : "in_progress",
        now,
        completed ? now : null,
        row.id,
      )
      .run();
    if (action !== 'save') context.waitUntil(recordEvent(env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'aula-studio', eventType: completed ? 'quiz_completed' : 'quiz_progressed', metadata: { attemptId: row.id, mixed: false, action, correctCount: score.correctCount, assessedCount: score.assessedCount } }));
    return json({
      attempt: publicAttempt({
        ...row,
        answers_json: JSON.stringify(answers),
        correct_count: score.correctCount,
        assessed_count: score.assessedCount,
        status: completed ? "completed" : "in_progress",
        updated_at: now,
        completed_at: completed ? now : null,
      }),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "study_quiz_attempt_update_error",
        message: error.message,
      }),
    );
    return json({ error: "Non è stato possibile salvare il tentativo." }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  try {
    const session = await getAuthenticatedSession(request, env);
    if (!session) return json({ error: "Sessione non valida o scaduta." }, 401);
    const result = await env.DB.prepare(
      "DELETE FROM study_quiz_attempts WHERE id = ? AND user_id = ? AND status = 'in_progress'",
    )
      .bind(params.id, session.user.id)
      .run();
    if (!Number(result.meta.changes || 0))
      return json({ error: "Bozza non trovata." }, 404);
    context.waitUntil(recordEvent(env, { userId: session.user.id, sessionId: session.sessionId }, { section: 'aula-studio', eventType: 'content_deleted', metadata: { resource: 'quiz_attempt', attemptId: params.id, mixed: false } }));
    return json({ deleted: true });
  } catch (error) {
    return json({ error: "Non è stato possibile eliminare la bozza." }, 500);
  }
}

function loadAttempt(env, id) {
  return env.DB.prepare(
    "SELECT attempt.*, users.nickname FROM study_quiz_attempts attempt INNER JOIN users ON users.id = attempt.user_id WHERE attempt.id = ?",
  )
    .bind(id)
    .first();
}
