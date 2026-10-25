/* Upgrade path: a library written by the previous build (audio inside the
 * track record, database version 1) must open, migrate and still play.
 * Run: node tests/page/db-migration.test.js
 */
"use strict";

const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { createServer, PREFIX } = require("../server");

const VIEWPORT = { width: 390, height: 844 };
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
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // Before any Lyra script runs: build the database exactly as the old build
  // left it — version 1, with the song's audio inside the track record.
  await page.addInitScript(() => {
    const build = new Promise((resolve, reject) => {
      const req = indexedDB.open("lyra", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("tracks", { keyPath: "id", autoIncrement: true });
        db.createObjectStore("playlists", { keyPath: "id", autoIncrement: true });
        db.createObjectStore("settings", { keyPath: "key" });
      };
      req.onsuccess = () => {
        const db = req.result;
        const sr = 8000;
        const frames = sr * 5;
        const buf = new ArrayBuffer(44 + frames * 2);
        const dv = new DataView(buf);
        const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
        ws(0, "RIFF"); dv.setUint32(4, 36 + frames * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
        dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
        dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
        dv.setUint16(34, 16, true); ws(36, "data"); dv.setUint32(40, frames * 2, true);
        for (let i = 0; i < frames; i++) dv.setInt16(44 + i * 2, Math.round(Math.sin(i / 12) * 200), true);
        const tx = db.transaction("tracks", "readwrite");
        tx.objectStore("tracks").put({
          title: "Legacy Song",
          artist: "Old Artist",
          album: "",
          duration: 5,
          audio: new Blob([buf], { type: "audio/wav" }),
          addedAt: Date.now(),
          plays: 3,
          liked: true,
          lyrics: "old words",
        });
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    window.__legacyReady = build;
  });

  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => window.__legacyReady);
  await page.waitForFunction(() => window.Lyra && Lyra.app && Lyra.app.tracks && Lyra.app.tracks.length === 1);
  await page.evaluate(() => navigator.serviceWorker?.getRegistrations().then((r) => r.forEach((x) => x.unregister())));

  console.log("\nUpgrading a version 1 library");

  await check("the old library opens with its song, tags and lyrics intact", async () => {
    const t = await page.evaluate(() => {
      const track = Lyra.app.tracks[0];
      return {
        title: track.title, artist: track.artist, lyrics: track.lyrics,
        plays: track.plays, liked: track.liked,
        hasAudio: !!track.audio, audioSize: track.audio ? track.audio.size : 0,
      };
    });
    assert.equal(t.title, "Legacy Song");
    assert.equal(t.artist, "Old Artist");
    assert.equal(t.lyrics, "old words");
    assert.equal(t.plays, 3);
    assert.equal(t.liked, true);
    assert.equal(t.hasAudio, true, "the song is still playable");
    assert.ok(t.audioSize > 1000);
  });

  await check("its audio is moved out of the record and the record is rewritten", async () => {
    const out = await page.evaluate(async () => {
      const id = Lyra.app.tracks[0].id;
      const openDb = () => new Promise((resolve, reject) => {
        const req = indexedDB.open("lyra");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const db = await openDb();
      const raw = await new Promise((resolve, reject) => {
        const g = db.transaction("tracks", "readonly").objectStore("tracks").get(id);
        g.onsuccess = () => resolve(g.result);
        g.onerror = () => reject(g.error);
      });
      const audioRow = await new Promise((resolve, reject) => {
        const g = db.transaction("audio", "readonly").objectStore("audio").get(id);
        g.onsuccess = () => resolve(g.result || null);
        g.onerror = () => reject(g.error);
      });
      db.close();
      return {
        version: (await new Promise((resolve, reject) => {
          const req = indexedDB.open("lyra");
          req.onsuccess = () => { const d = req.result; const v = d.version; d.close(); resolve(v); };
          req.onerror = () => reject(req.error);
        })),
        inline: Object.prototype.hasOwnProperty.call(raw, "audio"),
        audioBytes: audioRow && audioRow.blob ? audioRow.blob.size : 0,
        title: raw.title,
      };
    });
    assert.equal(out.version, 2, "the database is on the new version");
    assert.equal(out.inline, false, "the record no longer carries a Blob");
    assert.ok(out.audioBytes > 0, "the blob is in the audio store");
    assert.equal(out.title, "Legacy Song");
  });

  await check("the migrated song still plays and can be edited", async () => {
    const id = await page.evaluate(() => Lyra.app.tracks[0].id);
    await page.evaluate((id) => Lyra.player.playQueue([id], 0), id);
    const playing = await page.evaluate(() => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const a = Lyra.player.audio;
        if (!a.paused && a.currentTime > 0) return resolve(true);
        if (performance.now() - t0 > 6000) return resolve({ paused: a.paused, err: a.error && a.error.code, ready: a.readyState });
        requestAnimationFrame(tick);
      };
      tick();
    }));
    assert.equal(playing, true, "playback works after the migration: " + JSON.stringify(playing));

    const edited = await page.evaluate(async (id) => {
      await Lyra.db.saveMeta(id, { lyrics: "new words", artist: "New Artist" });
      const t = await Lyra.db.getTrack(id);
      return { lyrics: t.lyrics, artist: t.artist, audio: t.audio ? t.audio.size : 0 };
    }, id);
    assert.equal(edited.lyrics, "new words");
    assert.equal(edited.artist, "New Artist");
    assert.ok(edited.audio > 0, "and the audio survives the edit");
    await page.evaluate(() => Lyra.player.audio.pause());
  });

  await check("no page errors during the run", async () => {
    assert.deepEqual(pageErrors, [], pageErrors.join(" | "));
  });

  await browser.close();
  await new Promise((resolve) => server.close(resolve));

  const failed = results.filter((r) => r[1] === "FAIL");
  console.log("\n" + results.length + " checks, " + (results.length - failed.length) + " passed, " + failed.length + " failed\n");
  if (failed.length) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
