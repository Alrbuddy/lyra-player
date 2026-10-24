/* The service worker must precache the build that is actually deployed.
 * Reusing the browser HTTP cache during install is how a phone ends up running
 * a new VERSION with the previous app.js — this checks the cache contents.
 * Run: node tests/page/sw-update.test.js
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { createServer, PREFIX, ROOT } = require("../server");

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push([name, "PASS", ""]);
    console.log("  PASS  " + name);
  } catch (err) {
    const msg = (err && err.message ? err.message : String(err)).split("\n")[0];
    results.push([name, "FAIL", msg]);
    console.log("  FAIL  " + name + "\n        " + msg);
  }
}

(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}${PREFIX}/`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => window.Lyra && Lyra.app);

  const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const swVersion = (swSource.match(/const VERSION = "([^"]+)"/) || [])[1];
  const appVersion = (fs.readFileSync(path.join(ROOT, "app.js"), "utf8").match(/APP_VERSION = "([^"]+)"/) || [])[1];

  await check("the worker activates and creates one versioned cache", async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(async () => (await caches.keys()).some((k) => k.indexOf("lyra-") === 0), null, { timeout: 20000 });
    const keys = await page.evaluate(async () => (await caches.keys()).filter((k) => k.indexOf("lyra-") === 0));
    assert.deepEqual(keys, ["lyra-" + swVersion], "only the current cache remains: " + keys.join(", "));
  });

  await check("every asset is precached", async () => {
    const files = await page.evaluate(async (version) => {
      const cache = await caches.open("lyra-" + version);
      const reqs = await cache.keys();
      return reqs.map((r) => new URL(r.url).pathname.split("/").pop()).sort();
    }, swVersion);
    for (const needed of ["index.html", "app.js", "styles.css", "lyrics-sync.js", "player.js", "db.js", "manifest.webmanifest"]) {
      assert.ok(files.includes(needed), "missing " + needed + " in " + files.join(", "));
    }
  });

  await check("the cached app.js is this build, not an older HTTP-cached copy", async () => {
    const cached = await page.evaluate(async (version) => {
      const cache = await caches.open("lyra-" + version);
      const res = await cache.match("app.js");
      if (!res) return null;
      const text = await res.text();
      return {
        version: (text.match(/APP_VERSION = "([^"]+)"/) || [])[1],
        hasViewportSync: text.includes("syncViewport"),
        bytes: text.length,
      };
    }, swVersion);
    assert.ok(cached, "app.js is in the cache");
    assert.equal(cached.version, appVersion, "cached app.js matches the source build");
    assert.equal(cached.hasViewportSync, true, "it contains current code, not the previous release");
    assert.ok(cached.bytes > 1000);
  });

  await check("no page errors during the run", async () => {
    assert.deepEqual(pageErrors, [], pageErrors.join(" | "));
  });

  await browser.close();
  await new Promise((resolve) => server.close(resolve));

  const failed = results.filter((r) => r[1] === "FAIL");
  console.log("\n" + results.length + " checks, " + (results.length - failed.length) + " passed, " + failed.length + " failed\n");
  if (failed.length) {
    for (const [name, , msg] of failed) console.log("  ✗ " + name + " — " + msg);
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
