import assert from "node:assert/strict";
import test from "node:test";

import { installFavorites } from "../web/js/media_feed/favorites.js";

function createContext({ favorited = false } = {}) {
  const item = { id: "media-1", key: "output/image.png", filename: "image.png", subfolder: "", type: "output" };
  const buttons = Array.from({ length: 3 }, () => ({
    setAttribute(name, value) { this[name] = value; },
  }));
  const notifications = [];
  let saves = 0;
  const context = {
    app: { extensionManager: { toast: {
      error(title, options) { notifications.push({ title, ...options }); },
    } } },
    state: {
      items: [item],
      views: [{ cards: new Map([[item.id, { favoriteButton: buttons[0] }]]) }],
      favoriteFiles: new Map(favorited ? [[item.key, "image_1.png"]] : []),
      favoritingKeys: new Set(),
    },
    runtime: { viewer: {
      item, favoriteButton: buttons[1],
      reference: { item, favoriteButton: buttons[2] },
    } },
    actions: {
      apiUrl: (path) => path,
      saveFavoriteFiles() { saves++; },
    },
  };
  installFavorites(context);
  return { context, item, buttons, notifications, saves: () => saves };
}

for (const favorited of [false, true]) {
  test(`failed favorite ${favorited ? "removal" : "addition"} reports the reason and allows a retry`, async (t) => {
    const { context, item, buttons, notifications, saves } = createContext({ favorited });
    const reason = favorited ? "Could not remove favorite media" : "Media file was not found";
    let fail = true;
    t.mock.method(globalThis, "fetch", async (url, options) => {
      assert.equal(url, "/media-feed/favorite");
      assert.equal(options.method, favorited ? "DELETE" : "POST");
      assert.deepEqual(JSON.parse(options.body), favorited
        ? { filename: "image_1.png" }
        : { filename: "image.png", subfolder: "", type: "output" });
      assert.ok(buttons.every((button) => button.disabled));
      return fail
        ? new Response(JSON.stringify({ error: reason }), { status: favorited ? 500 : 404 })
        : new Response(JSON.stringify(favorited ? { removed: true } : { filename: "image_2.png" }));
    });

    await context.actions.toggleFavorite(item);

    assert.equal(context.state.favoriteFiles.has(item.key), favorited);
    if (favorited) assert.equal(context.state.favoriteFiles.get(item.key), "image_1.png");
    assert.equal(saves(), 0);
    assert.equal(context.state.favoritingKeys.size, 0);
    assert.ok(buttons.every((button) => !button.disabled && button["aria-pressed"] === String(favorited)));
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].title, favorited
      ? "Media Feed: Could not remove from favorites"
      : "Media Feed: Could not add to favorites");
    assert.equal(notifications[0].description, `image.png\n${reason}`);

    fail = false;
    await context.actions.toggleFavorite(item);

    assert.equal(context.state.favoriteFiles.has(item.key), !favorited);
    if (!favorited) assert.equal(context.state.favoriteFiles.get(item.key), "image_2.png");
    assert.equal(saves(), 1);
    assert.ok(buttons.every((button) => !button.disabled && button["aria-pressed"] === String(!favorited)));
    assert.equal(notifications.length, 1);
  });
}

for (const scenario of [
  {
    name: "insufficient disk space",
    fetch: async () => new Response(JSON.stringify({
      error: "Not enough disk space for favorites. Free up space and try again.",
    }), { status: 507 }),
    reason: "Not enough disk space for favorites. Free up space and try again.",
  },
  {
    name: "a permission error",
    fetch: async () => new Response(JSON.stringify({
      error: "Permission denied when accessing favorite media. Check file and folder permissions.",
    }), { status: 403 }),
    reason: "Permission denied when accessing favorite media. Check file and folder permissions.",
  },
  {
    name: "a non-JSON HTTP error",
    fetch: async () => new Response("Bad gateway", { status: 502 }),
    reason: "Request failed (HTTP 502).",
  },
  {
    name: "an unusable server error",
    fetch: async () => new Response(JSON.stringify({ error: { message: "failure" } }), { status: 500 }),
    reason: "Request failed (HTTP 500).",
  },
  {
    name: "a network failure",
    fetch: async () => { throw new TypeError("Failed to fetch"); },
    reason: "Failed to fetch",
  },
  {
    name: "an invalid success response",
    fetch: async () => new Response(JSON.stringify({ filename: "../image.png" })),
    reason: "Invalid favorite response",
  },
]) {
  test(`favorite feedback handles ${scenario.name}`, async (t) => {
    const { context, item, buttons, notifications, saves } = createContext();
    t.mock.method(globalThis, "fetch", scenario.fetch);

    await context.actions.toggleFavorite(item);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].description, `image.png\n${scenario.reason}`);
    assert.equal(context.state.favoriteFiles.size, 0);
    assert.equal(context.state.favoritingKeys.size, 0);
    assert.equal(saves(), 0);
    assert.ok(buttons.every((button) => !button.disabled));
  });
}

test("favorite errors use the legacy ComfyUI toast API when available", async (t) => {
  const { context, item, notifications } = createContext();
  context.app.extensionManager.toast = { add(message) { notifications.push(message); } };
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 503 }));

  await context.actions.toggleFavorite(item);

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].severity, "error");
  assert.equal(notifications[0].summary, "Media Feed: Could not add to favorites");
  assert.match(notifications[0].detail, /HTTP 503/);
});

test("favorite errors remain visible without ComfyUI's toast API", async (t) => {
  const { context, item, notifications, buttons } = createContext();
  delete context.app.extensionManager;
  const previousWindow = globalThis.window;
  globalThis.window = { alert(message) { notifications.push(message); } };
  t.after(() => { globalThis.window = previousWindow; });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Offline"); });

  await context.actions.toggleFavorite(item);

  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /Could not add to favorites\nimage\.png\nOffline/);
  assert.ok(buttons.every((button) => !button.disabled));
});
