// Arrivi realtime e fumetto: solo API e WebSocket locali simulati, nessun invio reale.
// Eseguire dopo npm run build.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import assert from "node:assert/strict";

const root = resolve("web/dist/web/browser");
let messages = [],
  reads = 0;
const message = (id, body, senderUserId = 1) => ({
  id: String(id),
  body,
  senderUserId,
  senderIdentity: senderUserId === 1 ? "lui" : "lei",
  mediaKey: null,
  mediaType: null,
  readAt: null,
  createdAt: "2026-11-18T12:00:00Z",
});
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://test").pathname;
    if (path.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      if (path === "/api/ponti-chat/read") reads++;
      const body =
        path === "/api/auth/session"
          ? {
              authenticated: true,
              user: {
                id: 2,
                nickname: "Desy",
                identity: "lei",
                role: "member",
                isTest: false,
                safeMode: true,
              },
              adminModeEnabled: false,
            }
          : path === "/api/realtime"
            ? { enabled: true }
            : path === "/api/ponti-chat"
              ? {
                  messages,
                  unreadCount: messages.filter((m) => m.senderUserId !== 2)
                    .length,
                }
              : path === "/api/world-settings"
                ? { settings: {}, values: { theme: "white-world" } }
                : path === "/api/world-updates"
                  ? { updates: [] }
                  : path === "/api/gdr-workspace"
                    ? {
                        adventures: [],
                        characters: [],
                        users: [],
                        grants: [],
                        isMaster: false,
                      }
                    : {};
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
        ".html": "text/html",
        ".css": "text/css",
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
    messages = [message(1, "Messaggio vecchio non letto")];
    reads = 0;
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: width === 320 ? "reduce" : "no-preference",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(10000);
    let connected;
    const connection = new Promise((r) => (connected = r));
    await page.routeWebSocket(/\/api\/realtime/, (ws) => connected(ws));
    await page.addInitScript(() => {
      sessionStorage.setItem("noi-crossword-access-session-v1", "2");
      sessionStorage.setItem(
        "noi-crossword-access-session-touched-at-v1",
        String(Date.now()),
      );
    });
    await page.goto(base + "/tavolo-da-gioco/gdr");
    const socket = await connection;
    await page.locator(".global-chat-badge").waitFor();
    assert.equal(await page.locator(".global-chat-arrival").count(), 0);
    await page.clock.install();
    const event = async (action, id) => {
      const response = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/ponti-chat" &&
          r.request().method() === "GET",
      );
      socket.send(
        JSON.stringify({
          type: "ponti-chat:changed",
          occurredAt: new Date().toISOString(),
          action,
          messageId: id,
        }),
      );
      await response;
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    };
    messages.push(message(2, "Messaggio mio", 2));
    await event("created", 2);
    assert.equal(await page.locator(".global-chat-arrival").count(), 0);
    messages.push(message(3, "Ciao! Ti va una passeggiata dopo?"));
    await event("created", 3);
    await page
      .getByRole("button", { name: "Apri il messaggio di Rory", exact: true })
      .waitFor();
    const geometry = await page.evaluate(() => {
      const notice = document
          .querySelector(".global-chat-arrival")
          .getBoundingClientRect(),
        trigger = document
          .querySelector(".global-chat-trigger")
          .getBoundingClientRect();
      return {
        above: notice.bottom < trigger.top,
        fits: notice.x >= 0 && notice.y >= 0 && notice.right <= innerWidth,
      };
    });
    assert.equal(geometry.above, true);
    assert.equal(geometry.fits, true);
    assert.equal(reads, 0);
    await page.screenshot({
      path: `/tmp/chat-arrival-${width}.png`,
      animations: "disabled",
    });
    await event("created", 3);
    await page.clock.fastForward(4000);
    await page.locator(".global-chat-arrival.is-fading").waitFor();
    messages.push(message(4, "Un altro messaggio: ti aspetto qui 😊"));
    await event("created", 4);
    assert.equal(
      await page.locator(".global-chat-arrival.is-fading").count(),
      0,
    );
    await page.clock.fastForward(2000);
    assert.equal(await page.locator(".global-chat-arrival").count(), 1);
    await page.clock.fastForward(4000);
    await page.waitForFunction(
      () => !document.querySelector(".global-chat-arrival"),
    );
    assert.equal(reads, 0);
    assert.equal(await page.locator(".global-chat-badge").isVisible(), true);
    messages.push(message(5, "Apri pure la chat"));
    await event("created", 5);
    await page
      .getByRole("button", { name: "Apri il messaggio di Rory", exact: true })
      .click();
    await page.locator(".global-chat-panel").waitFor();
    assert.equal(await page.locator(".global-chat-arrival").count(), 0);
    messages.push(message(6, "Ti scrivo mentre leggi"));
    await event("created", 6);
    await page.getByText("Ti scrivo mentre leggi", { exact: true }).waitFor();
    assert.equal(await page.locator(".global-chat-arrival").count(), 0);
    await page
      .getByRole("button", { name: "Chiudi chat", exact: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector(".global-chat-panel"),
    );
    await event("edited", 3);
    assert.equal(await page.locator(".global-chat-arrival").count(), 0);
    messages.push(message(7, "Puoi chiudere questa anteprima"));
    await event("created", 7);
    const readsBefore = reads;
    await page
      .getByRole("button", {
        name: "Chiudi anteprima del messaggio",
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () => !document.querySelector(".global-chat-arrival"),
    );
    assert.equal(reads, readsBefore);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    messages.push(message(8, "Arrivato in background"));
    await event("created", 8);
    assert.equal(await page.locator(".global-chat-arrival").count(), 0);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await event("created", 8);
    assert.equal(await page.locator(".global-chat-arrival").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS ${width}px: nuovo arrivo, posizione, sfumatura, sostituzione, apertura, letture, background e nessun duplicato`,
    );
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
