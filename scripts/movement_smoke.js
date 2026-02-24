// Deterministic movement smoke test:
// - Loads the local static play page (must be served on localhost:5173).
// - Connects to the deployed WS server.
// - Steps time with window.advanceTime (test=1 mode) while holding arrow keys.
// - Prints position deltas so we can verify forward/right/back/left are consistent.
//
// Usage:
//   node scripts/movement_smoke.js
//   URL_OVERRIDE="http://localhost:5173/play?..." node scripts/movement_smoke.js

const { chromium } = require("playwright");

const DEFAULT_URL =
  "http://localhost:5173/play?world=train_station_world" +
  "&ws=wss://arena-server-fresh-02240816.fly.dev/ws" +
  "&worldBase=https://arena-web-api-fresh-02240816.fly.dev" +
  "&test=1&name=MoveSmoke&walletId=wallet_test&clientId=client_test";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate, { timeoutMs = 15000, intervalMs = 250 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await predicate()) return true;
    } catch {
      // ignore
    }
    await sleep(intervalMs);
  }
  return false;
}

async function getState(page) {
  const raw = await page.evaluate(() => {
    if (typeof window.render_game_to_text !== "function") return null;
    return window.render_game_to_text();
  });
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function holdKeyFor(page, key, frames) {
  await page.keyboard.down(key);
  for (let i = 0; i < frames; i++) {
    await page.evaluate(async () => {
      if (typeof window.advanceTime === "function") {
        await window.advanceTime(1000 / 60);
      }
    });
  }
  await page.keyboard.up(key);
}

function delta(a, b) {
  const ax = a?.player?.x ?? a?.player?.displayX ?? 0;
  const az = a?.player?.z ?? a?.player?.displayZ ?? 0;
  const bx = b?.player?.x ?? b?.player?.displayX ?? 0;
  const bz = b?.player?.z ?? b?.player?.displayZ ?? 0;
  return { dx: +(bx - ax).toFixed(3), dz: +(bz - az).toFixed(3) };
}

async function main() {
  const url = process.env.URL_OVERRIDE || DEFAULT_URL;
  console.log(`[movement_smoke] url=${url}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // Some local static servers + heavy importmaps can make `domcontentloaded`
  // flaky in headless. Use `commit` and then proceed with our own readiness checks.
  await page.goto(url, { waitUntil: "commit", timeout: 30000 });
  console.log("[movement_smoke] navigated (commit)");
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    console.log("[movement_smoke] domcontentloaded");
  } catch {
    // best-effort; we use render_game_to_text readiness below anyway
    console.log("[movement_smoke] domcontentloaded timeout (continuing)");
  }

  // Wait for wsConnected + player to exist.
  const ok = await waitFor(async () => {
    const s = await getState(page);
    return Boolean(s && s.wsConnected && s.playerId && s.player);
  }, { timeoutMs: 20000, intervalMs: 250 });
  if (!ok) {
    const s = await getState(page);
    console.log(JSON.stringify({ ok: false, url, state: s, consoleErrors }, null, 2));
    await browser.close();
    process.exit(2);
  }
  console.log("[movement_smoke] ready (wsConnected + player)");

  const s0 = await getState(page);

  // Movement pattern: forward, right, backward, left.
  const desiredSamples = {};

  await page.keyboard.down("ArrowUp");
  await page.evaluate(() => JSON.parse(window.render_game_to_text()).desiredMove);
  desiredSamples.forward = await page.evaluate(() => JSON.parse(window.render_game_to_text()).desiredMove);
  await page.keyboard.up("ArrowUp");
  await holdKeyFor(page, "ArrowUp", 90);
  const s1 = await getState(page);

  await page.keyboard.down("ArrowRight");
  desiredSamples.right = await page.evaluate(() => JSON.parse(window.render_game_to_text()).desiredMove);
  await page.keyboard.up("ArrowRight");
  await holdKeyFor(page, "ArrowRight", 90);
  const s2 = await getState(page);

  await page.keyboard.down("ArrowDown");
  desiredSamples.backward = await page.evaluate(() => JSON.parse(window.render_game_to_text()).desiredMove);
  await page.keyboard.up("ArrowDown");
  await holdKeyFor(page, "ArrowDown", 90);
  const s3 = await getState(page);

  await page.keyboard.down("ArrowLeft");
  desiredSamples.left = await page.evaluate(() => JSON.parse(window.render_game_to_text()).desiredMove);
  await page.keyboard.up("ArrowLeft");
  await holdKeyFor(page, "ArrowLeft", 90);
  const s4 = await getState(page);

  const out = {
    ok: true,
    url,
    cameraYaw: s4?.cameraYaw,
    desiredSamples,
    deltas: {
      forward: delta(s0, s1),
      right: delta(s1, s2),
      backward: delta(s2, s3),
      left: delta(s3, s4),
      net: delta(s0, s4),
    },
    end: {
      x: s4?.player?.x ?? null,
      z: s4?.player?.z ?? null,
      yaw: s4?.player?.yaw ?? null,
    },
    consoleErrors,
  };

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
