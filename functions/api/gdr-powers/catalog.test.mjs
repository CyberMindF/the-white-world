import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fixture,
  mutate,
  apiHarness,
} from "../../../scripts/gdr-workspace-test-harness.mjs";
const source = (path) =>
  readFileSync(path, "utf8")
    .replace(/^import[\s\S]*?;\s*/gm, "")
    .replace(/export /g, "");
const json = (body, status = 200) => Response.json(body, { status });
const helpers = new Function(
  "json",
  "hasPermission",
  source("functions/api/gdr-workspace/_shared.js") +
    ";return {isMaster,validId,text,WorkspaceError,failure};",
)(json, (role) => role === "admin");
const normalize = new Function(
  source("functions/api/gdr-blocks/_shared.js") +
    ";return {normalizeType,normalizeData};",
)();
const master = { id: 1, role: "admin", isTest: false };
const adventure = "il-prezzo-della-verita",
  otherAdventure = "la-casa-che-trattiene-il-respiro";

function harness() {
  const h = apiHarness(),
    events = [];
  const session = async (request) => {
    const id = Number(request.headers.get("x-user") ?? 1);
    return id
      ? {
          user: {
            id,
            role: id === 1 ? "admin" : "member",
            isTest: request.headers.has("x-test"),
            safeMode: request.headers.has("x-safe"),
          },
          adminModeEnabled: !request.headers.has("x-no-admin"),
        }
      : null;
  };
  const catalog = new Function(
    "getAuthenticatedSession",
    "json",
    "readJson",
    ...Object.keys(helpers),
    ...Object.keys(normalize),
    "recordEvent",
    "notifyRealtime",
    source("functions/api/gdr-powers/index.js") +
      ";return {onRequestGet,onRequestPost,masterSession,referenceBlocks};",
  )(
    session,
    json,
    (request) => request.json(),
    ...Object.values(helpers),
    ...Object.values(normalize),
    async () => {},
    async (env, event) => events.push(event),
  );
  const rules = new Function(
    "json",
    "readJson",
    "masterSession",
    "referenceBlocks",
    ...Object.keys(helpers),
    "recordEvent",
    "notifyRealtime",
    source("functions/api/gdr-rules.js") + ";return onRequestPut;",
  )(
    json,
    (request) => request.json(),
    catalog.masterSession,
    catalog.referenceBlocks,
    ...Object.values(helpers),
    async () => {},
    async (env, event) => events.push(event),
  );
  const call = async (method, body, user = 1, headers = {}) => {
    const pending = [],
      response = await (
        method === "PUT"
          ? rules
          : method === "GET"
            ? catalog.onRequestGet
            : catalog.onRequestPost
      )({
        env: { DB: h.db },
        waitUntil(p) {
          pending.push(p);
        },
        request: new Request("https://test/api/gdr-powers", {
          method,
          headers: {
            "x-user": String(user),
            "Content-Type": "application/json",
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      });
    await Promise.all(pending);
    return response;
  };
  const character = (id, kind = "pg", adventureId = adventure) =>
    mutate(h.db, master, {
      action: "createCharacter",
      id,
      kind,
      adventureId,
      name: id,
    });
  return { ...h, events, catalog: call, character };
}
const power = (values = {}) => ({
  id: "shared-spell",
  revision: null,
  kind: "spell",
  name: "Scudo magico",
  description: "Blocca un colpo.",
  effects: [],
  adventureIds: [adventure],
  characterIds: [],
  ...values,
});

test("catalogo: solo master reale con Modalità admin, validazione e assegnazioni coerenti", async () => {
  const h = harness();
  try {
    assert.equal((await h.catalog("GET", undefined, 0)).status, 401);
    for (const [user, headers] of [
      [2, {}],
      [1, { "x-test": "1" }],
      [1, { "x-no-admin": "1" }],
      [1, { "x-safe": "1" }],
    ])
      assert.equal(
        (await h.catalog("POST", power(), user, headers)).status,
        403,
      );
    await h.character("npc", "png", otherAdventure);
    assert.equal(
      (await h.catalog("POST", power({ characterIds: ["npc"] }))).status,
      400,
    );
    assert.equal(
      (await h.catalog("POST", power({ adventureIds: ["missing"] }))).status,
      400,
    );
    assert.equal(
      (
        await h.catalog(
          "POST",
          power({ effects: [{ type: "script", data: { text: "No" } }] }),
        )
      ).status,
      400,
    );
    assert.equal(
      h.sqlite.prepare("SELECT count(*) n FROM gdr_powers").get().n,
      0,
    );
  } finally {
    h.sqlite.close();
  }
});

test("una voce appartiene a più avventure e a PG/PNG diversi; la descrizione resta unica e condivisa", async () => {
  const h = harness();
  try {
    await h.character("daisy");
    await h.character("npc", "png", otherAdventure);
    await h.character("hidden", "png");
    for (const id of ["daisy", "npc"])
      await mutate(h.db, master, {
        action: "grant",
        characterId: id,
        revision: 1,
        userId: 2,
        canSpeak: true,
        canEditSheet: false,
        canInventory: false,
      });
    assert.equal(
      (
        await h.catalog(
          "POST",
          power({
            adventureIds: [adventure, otherAdventure],
            characterIds: ["daisy", "npc"],
          }),
        )
      ).status,
      201,
    );
    const payload = power({
      revision: 1,
      description: "Descrizione aggiornata per tutti.",
      adventureIds: [adventure, otherAdventure],
      characterIds: ["daisy", "npc"],
    });
    assert.equal((await h.catalog("POST", payload)).status, 200);
    for (const id of [adventure, otherAdventure]) {
      const state = await (await h.call(2, "GET", undefined, id)).json();
      assert.equal(state.characters.length, 1);
      assert.equal(
        state.characters[0].powers[0].description,
        payload.description,
      );
      assert.equal(state.characters[0].powers[0].id, "shared-spell");
    }
    const catalog = await (await h.catalog("GET")).json();
    assert.equal(catalog.powers.length, 1);
    assert.deepEqual(catalog.powers[0].characterIds, ["daisy", "npc"]);
    assert.equal(
      h.sqlite.prepare("SELECT count(*) n FROM gdr_powers").get().n,
      1,
    );
    assert.equal(
      h.events.filter((e) => e.action === "powers_updated").length,
      4,
    );
  } finally {
    h.sqlite.close();
  }
});

test("revisioni obsolete e concorrenza non cancellano le assegnazioni correnti", async () => {
  const h = harness();
  try {
    await h.character("daisy");
    await h.catalog("POST", power({ characterIds: ["daisy"] }));
    assert.equal(
      (await h.catalog("POST", power({ revision: 0, name: "Obsoleto" })))
        .status,
      409,
    );
    const batch = h.db.batch.bind(h.db);
    h.db.batch = async (statements) => {
      h.sqlite.exec(
        "UPDATE gdr_powers SET revision=revision+1,name='Versione concorrente' WHERE id='shared-spell'",
      );
      return batch(statements);
    };
    assert.equal(
      (
        await h.catalog(
          "POST",
          power({ revision: 1, name: "Non sovrascrivere", characterIds: [] }),
        )
      ).status,
      409,
    );
    assert.equal(
      h.sqlite.prepare("SELECT name FROM gdr_powers").get().name,
      "Versione concorrente",
    );
    assert.equal(
      h.sqlite.prepare("SELECT character_id FROM gdr_character_powers").get()
        .character_id,
      "daisy",
    );
    assert.equal(
      h.sqlite.prepare("SELECT adventure_id FROM gdr_power_adventures").get()
        .adventure_id,
      adventure,
    );
  } finally {
    h.sqlite.close();
  }
});

test("importare le abilità personali crea una voce; ripetere la creazione non ripristina assegnazioni rimosse", async () => {
  const h = harness();
  try {
    const payload = {
      action: "createCharacter",
      id: "imported",
      kind: "pg",
      adventureId: adventure,
      name: "Importato",
      profile: { abilities: "Una capacità personale" },
    };
    await mutate(h.db, master, payload);
    let state = await (await h.call(1)).json();
    assert.equal(
      state.characters[0].powers[0].description,
      "Una capacità personale",
    );
    await h.catalog(
      "POST",
      power({
        id: "personal-imported",
        revision: 1,
        kind: "ability",
        name: "Abilità importate",
        characterIds: [],
      }),
    );
    await mutate(h.db, master, payload);
    state = await (await h.call(1)).json();
    assert.deepEqual(state.characters[0].powers, []);
    assert.equal(
      h.sqlite.prepare("SELECT count(*) n FROM gdr_powers").get().n,
      1,
    );
  } finally {
    h.sqlite.close();
  }
});

test("assegnazioni rimosse o revocate spariscono dal personaggio senza esporre poteri di PNG privati", async () => {
  const h = harness();
  try {
    await h.character("daisy");
    await h.character("hidden", "png");
    await mutate(h.db, master, {
      action: "grant",
      characterId: "daisy",
      revision: 1,
      userId: 2,
      canSpeak: true,
      canEditSheet: false,
      canInventory: false,
    });
    await h.catalog("POST", power({ characterIds: ["hidden"] }));
    let data = await (await h.call(2)).json();
    assert.deepEqual(data.characters[0].powers, []);
    assert.ok(!JSON.stringify(data).includes("Scudo magico"));
    await h.catalog("POST", power({ revision: 1, characterIds: ["daisy"] }));
    data = await (await h.call(2)).json();
    assert.equal(data.characters[0].powers.length, 1);
    await h.catalog(
      "POST",
      power({ revision: 2, characterIds: [], adventureIds: [] }),
    );
    data = await (await h.call(2)).json();
    assert.deepEqual(data.characters[0].powers, []);
  } finally {
    h.sqlite.close();
  }
});

test("le regole si modificano per avventura con controllo dei conflitti e restano consultabili alla giocatrice", async () => {
  const h = harness();
  try {
    const blocks = [
      { type: "heading", data: { level: 2, text: "Nuove regole" } },
      { type: "paragraph", data: { text: "Una regola condivisa." } },
    ];
    assert.equal(
      (
        await h.catalog(
          "PUT",
          { adventureId: adventure, revision: 1, blocks },
          2,
        )
      ).status,
      403,
    );
    const old = h.sqlite
      .prepare(
        "SELECT source,revision FROM gdr_workspace_adventures WHERE id=?",
      )
      .get(adventure);
    assert.equal(
      (await h.catalog("PUT", { adventureId: adventure, revision: 1, blocks }))
        .status,
      200,
    );
    assert.equal(
      (
        await h.catalog("PUT", {
          adventureId: adventure,
          revision: 1,
          blocks: [],
        })
      ).status,
      409,
    );
    const state = await (await h.call(2)).json(),
      rules = state.adventures.find((a) => a.id === adventure);
    assert.deepEqual(rules.rules, blocks);
    assert.equal(rules.rulesRevision, 2);
    assert.deepEqual(
      h.sqlite
        .prepare(
          "SELECT source,revision FROM gdr_workspace_adventures WHERE id=?",
        )
        .get(adventure),
      old,
    );
  } finally {
    h.sqlite.close();
  }
});

test("migrazione: conserva regole, tabelle e note; assegna abilità e magie solo al protagonista e mantiene gli originali", async () => {
  const h = fixture({ powerCatalog: false });
  try {
    await mutate(h.db, master, {
      action: "createCharacter",
      id: "daisy",
      kind: "pg",
      adventureId: adventure,
      name: "Daisy",
    });
    h.sqlite
      .prepare("INSERT INTO gdr_workspace_story_links VALUES(?,'pg',?)")
      .run(adventure, "daisy");
    const insert = h.sqlite.prepare(
      "INSERT INTO gdr_blocks(id,document_key,type,data,position) VALUES(?,?,?,?,?)",
    );
    const rows = [
      ["heading", { level: 2, text: "Regole" }],
      ["paragraph", { text: "Regola originale", emphasis: true }],
      ["heading", { level: 3, text: "Abilità speciali" }],
      ["paragraph", { text: "Una per scena." }],
      ["list", { items: ["Luce: illumina", "Magia selvaggia: tira un dado"] }],
      ["table", { header: ["Dado", "Effetto"], rows: [["1", "Esplosione"]] }],
      ["heading", { level: 3, text: "Incantesimi" }],
      ["list", { items: ["Dardo: attacca", "Scudo: protegge"] }],
    ];
    rows.forEach(([type, data], i) =>
      insert.run(i + 1, "maga-regole", type, JSON.stringify(data), i),
    );
    const original = h.sqlite.prepare("SELECT * FROM gdr_blocks").all();
    h.sqlite.exec(
      readFileSync("migrations/0160_add_gdr_power_catalog.sql", "utf8"),
    );
    assert.deepEqual(
      h.sqlite.prepare("SELECT * FROM gdr_blocks").all(),
      original,
    );
    const rules = JSON.parse(
      h.sqlite
        .prepare("SELECT rules_json FROM gdr_workspace_adventures WHERE id=?")
        .get(adventure).rules_json,
    );
    assert.deepEqual(
      rules,
      rows.slice(0, 2).map(([type, data]) => ({ type, data })),
    );
    assert.equal(
      h.sqlite.prepare("SELECT count(*) n FROM gdr_powers").get().n,
      4,
    );
    assert.equal(
      h.sqlite
        .prepare(
          "SELECT count(*) n FROM gdr_character_powers WHERE character_id=?",
        )
        .get("daisy").n,
      4,
    );
    const effects = JSON.parse(
      h.sqlite
        .prepare(
          "SELECT effects_json FROM gdr_powers WHERE name='Magia selvaggia'",
        )
        .get().effects_json,
    );
    assert.deepEqual(effects, [
      { type: "paragraph", data: { text: "Una per scena." } },
      {
        type: "table",
        data: { header: ["Dado", "Effetto"], rows: [["1", "Esplosione"]] },
      },
    ]);
  } finally {
    h.sqlite.close();
  }
});
