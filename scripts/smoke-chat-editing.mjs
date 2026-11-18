// Dati e API locali simulate: nessun messaggio inviato agli account reali.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import assert from "node:assert/strict";
const root = resolve("web/dist/web/browser");
let messages,
  writes = [],
  edits = [],
  rejectSend = false,
  rejectEdit = false;
const photo = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGQAAAABJRU5ErkJggg==",
  "base64",
);
const make = (id, senderUserId, body) => ({
  id: String(id),
  senderUserId,
  senderIdentity: senderUserId === 1 ? "lui" : "lei",
  body,
  mediaKey: null,
  mediaType: null,
  editedAt: null,
  revision: 1,
  readAt: senderUserId === 1 ? "2026-11-18T11:12:00Z" : null,
  createdAt: "2026-11-18T11:10:00Z",
});
const reset = () => {
  messages = [
    make(1, 2, "Ciao! Come sta andando la giornata?"),
    make(2, 1, "Bene! Dopo ci sentiamo con calma 😊"),
    make(3, 2, "Certo, ti scrivo appena torno a casa."),
    make(
      4,
      1,
      "Ti lascio anche questo promemoria:\nfoto, una passeggiata e poi cena insieme.",
    ),
  ];
  writes = [];
  edits = [];
  rejectSend = false;
  rejectEdit = false;
};
reset();
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://test").pathname;
    if (path === "/api/media/test-photo") {
      res.setHeader("Content-Type", "image/png");
      res.end(photo);
      return;
    }
    if (path.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      let body = {};
      if (path === "/api/auth/session")
        body = {
          authenticated: true,
          user: {
            id: 1,
            nickname: "Rory",
            identity: "lui",
            role: "admin",
            isTest: false,
            safeMode: false,
          },
          adminModeEnabled: false,
        };
      else if (path === "/api/world-settings")
        body = {
          settings: { hearts: false },
          values: { theme: "white-world" },
        };
      else if (path === "/api/realtime") body = { enabled: false };
      else if (path === "/api/world-updates") body = { updates: [] };
      else if (path === "/api/gdr-workspace")
        body = {
          adventures: [],
          characters: [],
          grants: [],
          users: [],
          isMaster: false,
        };
      else if (path === "/api/ponti-chat" && req.method === "GET")
        body = { messages, unreadCount: 0 };
      else if (path === "/api/ponti-chat" && req.method === "POST") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        if (rejectSend) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: "Invio non riuscito." }));
          return;
        }
        const payload = JSON.parse(raw);
        writes.push(payload);
        body = {
          ...make(messages.length + 1, 1, payload.body ?? null),
          mediaKey: payload.mediaKey ?? null,
          mediaType: payload.mediaType ?? null,
        };
        messages.push(body);
      } else if (
        path.startsWith("/api/ponti-chat/") &&
        req.method === "PATCH"
      ) {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const payload = JSON.parse(raw);
        edits.push(payload);
        const message = messages.find((m) => m.id === path.split("/").at(-1));
        if (rejectEdit || message.revision !== payload.revision) {
          res.writeHead(409);
          res.end(JSON.stringify({ error: "Il messaggio è cambiato." }));
          return;
        }
        body = {
          ...message,
          body: payload.body,
          revision: message.revision + 1,
          editedAt: new Date().toISOString(),
        };
        messages = messages.map((m) => (m.id === message.id ? body : m));
      } else if (path === "/api/ponti-chat/media") body = { key: "test-photo" };
      else if (path.startsWith("/api/ponti-chat/") && req.method === "DELETE") {
        messages = messages.filter((m) => m.id !== path.split("/").at(-1));
        body = { deleted: true };
      } else body = { saved: true };
      res.end(JSON.stringify(body));
      return;
    }
    let file = join(root, path),
      data;
    try {
      data = await readFile(file);
    } catch {
      file = join(root, "index.html");
      data = await readFile(file);
    }
    res.setHeader(
      "Content-Type",
      {
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
        ".svg": "image/svg+xml",
      }[extname(file)] || "application/octet-stream",
    );
    res.end(data);
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  for (const width of [1280, 390, 320]) {
    reset();
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => {
      sessionStorage.setItem("noi-crossword-access-session-v1", "1");
      sessionStorage.setItem(
        "noi-crossword-access-session-touched-at-v1",
        String(Date.now()),
      );
    });
    await page.goto(base + "/ponti-chat");
    await page.getByText(messages[3].body, { exact: true }).waitFor();
    assert.equal(
      await page
        .locator(".chat-bubble:not(.chat-bubble--own) .chat-options-btn")
        .count(),
      0,
    );
    const target = page
        .locator(".chat-bubble")
        .filter({ hasText: "Bene! Dopo ci sentiamo" }),
      trigger = target.getByRole("button", {
        name: "Opzioni messaggio",
        exact: true,
      });
    await trigger.click();
    await page
      .getByRole("group", { name: "Azioni del messaggio", exact: true })
      .waitFor();
    const geometry = await page.evaluate(() => {
      const menu = document
          .querySelector(".chat-message-menu")
          .getBoundingClientRect(),
        log = document.querySelector(".chat-log").getBoundingClientRect();
      return {
        fits:
          menu.top >= log.top &&
          menu.bottom <= log.bottom &&
          menu.left >= 0 &&
          menu.right <= innerWidth,
      };
    });
    assert.equal(
      geometry.fits,
      true,
      "Menu accessibile senza tagli sul bordo della chat",
    );
    await page.screenshot({
      path: `/tmp/chat-actions-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => !document.querySelector(".chat-message-menu"),
    );
    assert.equal(
      await trigger.evaluate((el) => el === document.activeElement),
      true,
    );
    await trigger.click();
    await page.getByRole("heading", { name: "Chat", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector(".chat-message-menu"),
    );
    await page
      .getByRole("textbox", { name: "Messaggio", exact: true })
      .fill("Nuovo messaggio in bozza");
    await trigger.click();
    await page
      .getByRole("button", { name: "Modifica messaggio", exact: true })
      .click();
    const editor = page.getByRole("textbox", {
      name: "Testo del messaggio da modificare",
      exact: true,
    });
    await editor.waitFor();
    assert.equal(await editor.inputValue(), messages[1].body);
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("name") === "editMessage",
    );
    await editor.fill("Questa modifica si annulla");
    await editor.press("Escape");
    await page.waitForFunction(
      () => !document.querySelector(".chat-edit-compose"),
    );
    assert.equal(edits.length, 0);
    assert.equal(
      await page
        .getByRole("textbox", { name: "Messaggio", exact: true })
        .inputValue(),
      "Nuovo messaggio in bozza",
    );
    await trigger.click();
    await page
      .getByRole("button", { name: "Modifica messaggio", exact: true })
      .click();
    await editor.fill("Testo corretto, stesso messaggio.");
    rejectEdit = true;
    await page
      .getByRole("button", { name: "Salva modifica", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Il messaggio è cambiato." })
      .waitFor();
    assert.equal(
      await editor.inputValue(),
      "Testo corretto, stesso messaggio.",
    );
    await page.screenshot({
      path: `/tmp/chat-editing-${width}.png`,
      fullPage: true,
    });
    rejectEdit = false;
    await page
      .getByRole("button", { name: "Salva modifica", exact: true })
      .click();
    await page
      .getByText("Testo corretto, stesso messaggio.", { exact: true })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector(".chat-edit-compose"),
    );
    assert.equal(messages.length, 4);
    assert.equal(messages[1].id, "2");
    assert.equal(messages[1].revision, 2);
    assert.ok(messages[1].editedAt);
    assert.equal(
      await page
        .getByRole("textbox", { name: "Messaggio", exact: true })
        .inputValue(),
      "Nuovo messaggio in bozza",
    );
    assert.equal(await page.locator(".chat-edited").count(), 1);
    await page
      .getByRole("textbox", { name: "Messaggio", exact: true })
      .fill("");
    await page.waitForFunction(
      () => document.querySelector(".chat-send").disabled,
    );
    assert.equal(
      await page
        .locator(".chat-send")
        .evaluate((el) => getComputedStyle(el).cursor),
      "default",
    );
    const edited = page
      .locator(".chat-bubble")
      .filter({ hasText: "Testo corretto, stesso messaggio." });
    await edited
      .getByRole("button", { name: "Opzioni messaggio", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Elimina messaggio", exact: true })
      .click();
    await page.getByRole("button", { name: "Annulla", exact: true }).click();
    assert.equal(messages.length, 4);
    await page.goto(base + "/tavolo-da-gioco/gdr");
    await page
      .getByRole("button", { name: "Apri la chat globale", exact: true })
      .click();
    await page.locator(".global-chat-edited").waitFor();
    assert.equal(
      await page
        .getByText("Testo corretto, stesso messaggio.", { exact: true })
        .count(),
      1,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS ${width}px: menu, Esc e click esterno, annulla, modifica, conflitto, bozza conservata e aggiornamento nel widget`,
    );
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
