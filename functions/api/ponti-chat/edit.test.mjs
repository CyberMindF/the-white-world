import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const source = (file) =>
  readFileSync(file, "utf8")
    .replace(/^import[\s\S]*?;\s*/gm, "")
    .replace(/export /g, "");
const shared = new Function(
  source("functions/api/ponti-chat/_shared.js") +
    ";return {normalizeBody,toMessageView};",
)();
const json = (body, status = 200) => Response.json(body, { status });
const handler = new Function(
  "getAuthenticatedSession",
  "json",
  "readJson",
  "normalizeBody",
  "toMessageView",
  "recordEvent",
  "notifyRealtime",
  source("functions/api/ponti-chat/[id].js") + ";return onRequestPatch;",
)(
  async (request) => {
    const id = Number(request.headers.get("x-user") ?? 1);
    return id ? { user: { id, identity: "lui" }, sessionId: 4 } : null;
  },
  json,
  async (request) => request.json().catch(() => null),
  shared.normalizeBody,
  shared.toMessageView,
  async (env, actor, event) => env.events.push({ actor, ...event }),
  async (env, event) => env.notifications.push(event),
);

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2),(3);",
  );
  sqlite.exec(readFileSync("migrations/0088_add_ponti_chat.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0113_global_chat_unread.sql", "utf8"));
  const insert = sqlite.prepare(
    "INSERT INTO ponti_chat_messages(id,sender_identity,sender_user_id,body,media_key,media_type,media_expires_at,read_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
  );
  insert.run(
    1,
    "lui",
    1,
    "Originale",
    null,
    null,
    null,
    "2026-11-18T09:00:00Z",
    1,
    "2026-11-18T08:00:00Z",
  );
  insert.run(
    2,
    "lei",
    2,
    "Altro autore",
    null,
    null,
    null,
    null,
    2,
    "2026-11-18T08:01:00Z",
  );
  insert.run(
    3,
    "lui",
    1,
    "Didascalia",
    "ponti-chat/uploads/foto.png",
    "photo",
    "2099-01-01T00:00:00Z",
    null,
    1,
    "2026-11-18T08:02:00Z",
  );
  insert.run(
    4,
    "lui",
    1,
    "Allegato scaduto",
    "ponti-chat/uploads/scaduta.png",
    "photo",
    "2000-01-01T00:00:00Z",
    null,
    1,
    "2026-11-18T08:03:00Z",
  );
  const original = sqlite
    .prepare("SELECT * FROM ponti_chat_messages ORDER BY id")
    .all()
    .map((row) => ({ ...row }));
  sqlite.exec(
    readFileSync("migrations/0161_add_chat_message_edits.sql", "utf8"),
  );
  const env = { events: [], notifications: [] };
  env.DB = {
    withSession() {
      return this;
    },
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              return sqlite.prepare(sql).get(...values) ?? null;
            },
            async run() {
              if (env.beforeUpdate) env.beforeUpdate();
              const r = sqlite.prepare(sql).run(...values);
              return { meta: { changes: Number(r.changes) } };
            },
          };
        },
      };
    },
  };
  const call = async (
    body = { body: "Modificato", revision: 1 },
    user = 1,
    id = "1",
  ) => {
    const pending = [];
    const response = await handler({
      env,
      params: { id },
      waitUntil(p) {
        pending.push(p);
      },
      request: new Request("https://test/api/ponti-chat/" + id, {
        method: "PATCH",
        headers: { "x-user": String(user), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
    await Promise.all(pending);
    return response;
  };
  return {
    sqlite,
    env,
    call,
    original,
    row(id = 1) {
      return sqlite
        .prepare("SELECT * FROM ponti_chat_messages WHERE id=?")
        .get(id);
    },
  };
}

test("migrazione additiva: messaggi, allegati e letture restano intatti", () => {
  const h = fixture();
  try {
    const rows = h.sqlite
      .prepare("SELECT * FROM ponti_chat_messages ORDER BY id")
      .all();
    assert.deepEqual(
      rows.map(({ edited_at, edit_revision, ...row }) => row),
      h.original,
    );
    assert.ok(
      rows.every((row) => row.edited_at === null && row.edit_revision === 1),
    );
    assert.deepEqual(h.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    h.sqlite.close();
  }
});

test("autenticazione e proprietà dipendono dall’account, anche con identità narrativa uguale", async () => {
  const h = fixture();
  try {
    assert.equal((await h.call(undefined, 0)).status, 401);
    assert.equal((await h.call(undefined, 2)).status, 403);
    assert.equal((await h.call(undefined, 3)).status, 403);
    assert.equal((await h.call(undefined, 1, "999")).status, 404);
    assert.equal((await h.call(undefined, 1, "1.5")).status, 400);
    assert.equal(h.row().body, "Originale");
    assert.equal(h.env.events.length, 0);
  } finally {
    h.sqlite.close();
  }
});

test("la modifica conserva ID, data, autore, allegati e lettura e annuncia solo ID e azione", async () => {
  const h = fixture();
  try {
    const before = h.row(3),
      response = await h.call(
        {
          body: "  Nuova didascalia  ",
          revision: 1,
          senderUserId: 2,
          mediaKey: "sostituzione",
        },
        1,
        "3",
      );
    assert.equal(response.status, 200);
    const message = await response.json(),
      after = h.row(3);
    assert.equal(message.body, "Nuova didascalia");
    assert.equal(message.revision, 2);
    assert.ok(message.editedAt);
    const { body, edited_at, edit_revision, ...unchanged } = after;
    const {
      body: oldBody,
      edited_at: oldEdited,
      edit_revision: oldRevision,
      ...oldUnchanged
    } = before;
    assert.deepEqual(unchanged, oldUnchanged);
    assert.deepEqual(h.env.notifications, [
      {
        type: "ponti-chat:changed",
        action: "edited",
        actorUserId: 1,
        messageId: 3,
      },
    ]);
    assert.deepEqual(h.env.events[0].metadata, { messageId: 3 });
    assert.equal(
      h.sqlite.prepare("SELECT count(*) n FROM ponti_chat_messages").get().n,
      4,
    );
  } finally {
    h.sqlite.close();
  }
});

test("testo non valido o vuoto viene rifiutato; si può svuotare solo la didascalia di un allegato disponibile", async () => {
  const h = fixture();
  try {
    for (const payload of [
      { body: "", revision: 1 },
      { body: " ".repeat(3), revision: 1 },
      { body: "x".repeat(2001), revision: 1 },
      { body: 3, revision: 1 },
      { revision: 1 },
      { body: "Testo" },
      { body: "Testo", revision: 0 },
    ])
      assert.equal((await h.call(payload)).status, 400);
    assert.equal((await h.call({ body: "", revision: 1 }, 1, "4")).status, 400);
    assert.equal((await h.call({ body: "", revision: 1 }, 1, "3")).status, 200);
    assert.equal(h.row(3).body, null);
    assert.ok(h.row(3).media_key);
    assert.equal(h.row().body, "Originale");
  } finally {
    h.sqlite.close();
  }
});

test("revisioni obsolete e modifiche concorrenti non sovrascrivono il testo più recente", async () => {
  const h = fixture();
  try {
    assert.equal((await h.call()).status, 200);
    assert.equal(
      (await h.call({ body: "Vecchia scheda", revision: 1 })).status,
      409,
    );
    assert.equal(h.row().body, "Modificato");
    h.env.beforeUpdate = () =>
      h.sqlite.exec(
        "UPDATE ponti_chat_messages SET body='Modifica concorrente',edit_revision=3 WHERE id=1",
      );
    assert.equal(
      (await h.call({ body: "Non sovrascrivere", revision: 2 })).status,
      409,
    );
    assert.equal(h.row().body, "Modifica concorrente");
    assert.equal(h.env.events.length, 1);
  } finally {
    h.sqlite.close();
  }
});

test("salvare lo stesso testo non marca il messaggio come modificato", async () => {
  const h = fixture();
  try {
    assert.equal(
      (await h.call({ body: "Originale", revision: 1 })).status,
      200,
    );
    assert.equal(h.row().edited_at, null);
    assert.equal(h.row().edit_revision, 1);
    assert.deepEqual(h.env.events, []);
  } finally {
    h.sqlite.close();
  }
});

test("la scadenza concorrente di un allegato non lascia un messaggio vuoto", async () => {
  const h = fixture();
  try {
    h.env.beforeUpdate = () =>
      h.sqlite.exec(
        "UPDATE ponti_chat_messages SET media_key=NULL,media_type=NULL,media_expires_at=NULL WHERE id=3",
      );
    assert.equal((await h.call({ body: "", revision: 1 }, 1, "3")).status, 409);
    assert.equal(h.row(3).body, "Didascalia");
    assert.equal(h.env.events.length, 0);
  } finally {
    h.sqlite.close();
  }
});

test("gli account di prova possono modificare i propri messaggi attraverso il middleware", async () => {
  const middleware = new Function(
    "getAuthenticatedSession",
    "json",
    source("functions/api/_middleware.js") + ";return onRequest;",
  )(async () => ({ user: { id: 3, isTest: true } }), json);
  let forwarded = false;
  const response = await middleware({
    request: new Request("https://test/api/ponti-chat/3", { method: "PATCH" }),
    next() {
      forwarded = true;
      return json({ next: true });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(forwarded, true);
  const denied = await middleware({
    request: new Request("https://test/api/ponti-chat/3", { method: "PUT" }),
    next() {
      throw new Error("Metodo non previsto");
    },
  });
  assert.equal(denied.status, 403);
});
