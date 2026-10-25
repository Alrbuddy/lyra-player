/* Headless page tests for artist / album grouping and the "Artist & album" sheet.
 * iPhone viewport 390x844, app served from a /Lyra/ subfolder like GitHub Pages.
 * Run: node tests/page/library-artist.test.js
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

async function seed(page, specs) {
  return page.evaluate(async (specs) => {
    await Lyra.db.clearAll();
    const blob = new Blob(["not really audio"], { type: "audio/mpeg" });
    const ids = {};
    let i = 0;
    for (const s of specs) {
      ids[s.title] = await Lyra.db.addTrack({
        title: s.title,
        artist: s.artist === undefined ? "Unknown Artist" : s.artist,
        album: s.album === undefined ? "Unknown Album" : s.album,
        duration: 120,
        addedAt: Date.now() + i++,
        plays: 0,
        liked: false,
        lyrics: "",
        audio: blob,
      });
    }
    await Lyra.app.refreshData();
    Lyra.app.go("library");
    return ids;
  }, specs);
}

async function tab(page, name) {
  await page.click(`[data-libfilter="${name}"]`);
  await page.waitForTimeout(120);
}

async function libText(page) {
  return page.evaluate(() => document.querySelector("#lib-body").innerText);
}

async function libHTML(page) {
  return page.evaluate(() => document.querySelector("#lib-body").innerHTML);
}

async function openEdit(page, id) {
  // Always start from the Songs tab: earlier checks may leave Artists/Albums open.
  await page.evaluate(() => Lyra.app.go("library"));
  await tab(page, "songs");
  await page.click(`#lib-body [data-dots="${id}"]`);
  await page.waitForTimeout(150);
  await page.click('#sheet [data-act="info"]');
  await page.waitForTimeout(200);
}

async function saveEdit(page, { artist, album }) {
  if (artist !== undefined) await page.fill("#ef-artist", artist);
  if (album !== undefined) await page.fill("#ef-album", album);
  await page.click("#ef-save");
  await page.waitForTimeout(300);
}

async function track(page, title) {
  return page.evaluate((title) => {
    const t = Lyra.app.tracks.find((x) => x.title === title);
    return t ? { id: t.id, artist: t.artist, album: t.album, artistManual: !!t.artistManual, albumManual: !!t.albumManual } : null;
  }, title);
}

async function subtitle(page, id) {
  return page.evaluate((id) => {
    const dots = document.querySelector(`#lib-body [data-dots="${id}"]`);
    const row = dots && dots.closest(".song-row");
    return row ? row.querySelector(".song-sub").textContent : null;
  }, id);
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
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => window.Lyra && Lyra.app && Lyra.app.tracks);
  await page.evaluate(() => navigator.serviceWorker?.getRegistrations().then((r) => r.forEach((x) => x.unregister())));

  console.log("\nArtist grouping");
  await check("songs sharing an artist (any casing or padding) group into one artist", async () => {
    await seed(page, [
      { title: "A", artist: "Unknown Artist" },
      { title: "B", artist: "Unknown Artist" },
      { title: "C", artist: "YFG Fatso" },
      { title: "D", artist: "yfg fatso" },
      { title: "E", artist: "  YFG Fatso  " },
    ]);
    await tab(page, "artists");
    const text = await libText(page);
    assert.match(text, /YFG Fatso/, "keeps a readable spelling");
    assert.match(text, /YFG Fatso[^\n]*\n?[^\n]*3 songs/, "three songs under one artist:\n" + text);
    assert.equal((text.match(/yfg fatso/gi) || []).length, 1, "no duplicate rows for other spellings");
    assert.match(text, /Unknown Artist[^\n]*\n?[^\n]*2 songs/);
  });

  await check("artist detail page includes every spelling of the name", async () => {
    const n = await page.evaluate(() => {
      Lyra.app.go("detail", { kind: "artist", name: "yfg fatso" }, false);
      return document.querySelectorAll("#detail-rows .song-row").length;
    });
    assert.equal(n, 3);
  });

  await check("typing an artist on one song joins the existing artist", async () => {
    const a = await track(page, "A");
    await openEdit(page, a.id);
    await saveEdit(page, { artist: "YFG Fatso" });
    const saved = await track(page, "A");
    assert.equal(saved.artist, "YFG Fatso");
    assert.equal(saved.artistManual, true);
    assert.equal(await subtitle(page, a.id), "YFG Fatso");
    await tab(page, "artists");
    const text = await libText(page);
    assert.match(text, /YFG Fatso[^\n]*\n?[^\n]*4 songs/, "four songs now:\n" + text);
  });

  console.log("\nAlbums");
  await check("no album is invented for single songs, and Unknown Album never appears", async () => {
    await seed(page, [
      { title: "A", artist: "YFG Fatso", album: "Unknown Album" },
      { title: "B", artist: "YFG Fatso", album: "B-Side Only" },
      { title: "C", artist: "Other", album: "Another One-Off" },
    ]);
    await tab(page, "albums");
    const html = await libHTML(page);
    assert.equal((html.match(/browse-tile/g) || []).length, 0, "no one-song albums: " + html.slice(0, 200));
    await tab(page, "songs");
    const a = await track(page, "A");
    const b = await track(page, "B");
    assert.equal(await subtitle(page, a.id), "YFG Fatso", "no album junk in the row");
    assert.equal(await subtitle(page, b.id), "YFG Fatso", "single-song album hidden from rows too");
  });

  await check("two songs sharing an album show one album with both songs", async () => {
    await seed(page, [
      { title: "A", artist: "YFG Fatso", album: "Mixtape" },
      { title: "B", artist: "YFG Fatso", album: "Mixtape" },
      { title: "C", artist: "Other", album: "Solo Record" },
    ]);
    await tab(page, "albums");
    const text = await libText(page);
    assert.match(text, /Mixtape/);
    assert.doesNotMatch(text, /Solo Record/);
    const n = await page.evaluate(() => {
      Lyra.app.go("detail", { kind: "album", name: "Mixtape" }, false);
      return document.querySelectorAll("#detail-rows .song-row").length;
    });
    assert.equal(n, 2);
    await page.evaluate(() => Lyra.app.go("library"));
    await tab(page, "songs");
    const b = await track(page, "B");
    assert.equal(await subtitle(page, b.id), "YFG Fatso • Mixtape");
  });

  await check("an album you name on one song stays hidden until a second song shares it", async () => {
    await seed(page, [
      { title: "A", artist: "YFG Fatso", album: "" },
      { title: "B", artist: "YFG Fatso", album: "" },
    ]);
    const a = await track(page, "A");
    await openEdit(page, a.id);
    await saveEdit(page, { album: "One-Off EP" });
    assert.equal((await track(page, "A")).album, "One-Off EP", "the tag is still saved");
    await tab(page, "albums");
    assert.doesNotMatch(await libText(page), /One-Off EP/, "one song is not an album");
    await tab(page, "songs");
    assert.equal(await subtitle(page, a.id), "YFG Fatso", "and the row carries no album");

    const b = await track(page, "B");
    await openEdit(page, b.id);
    await saveEdit(page, { album: "One-Off EP" });
    await tab(page, "albums");
    assert.match(await libText(page), /One-Off EP/, "two songs make it an album");
    await tab(page, "songs");
    assert.equal(await subtitle(page, a.id), "YFG Fatso • One-Off EP");
    assert.equal(await subtitle(page, b.id), "YFG Fatso • One-Off EP");

    // Back to one song: the album disappears again, the remaining tag stays stored.
    await openEdit(page, a.id);
    await saveEdit(page, { album: "" });
    assert.equal((await track(page, "A")).album, "");
    assert.equal((await track(page, "B")).album, "One-Off EP");
    await tab(page, "albums");
    assert.doesNotMatch(await libText(page), /One-Off EP/, "no album for a single song again");
    await tab(page, "songs");
    assert.equal(await subtitle(page, b.id), "YFG Fatso", "row clean again too");
  });

  console.log("\nArtist shelf");
  await check("a single-song artist has no row until a second song joins", async () => {
    await seed(page, [
      { title: "A", artist: "YFG Fatso", album: "" },
      { title: "B", artist: "YFG Fatso", album: "" },
      { title: "C", artist: "One Hit", album: "" },
      { title: "D", artist: "Two Songs", album: "" },
      { title: "E", artist: "Two Songs", album: "" },
    ]);
    await tab(page, "artists");
    const text = await libText(page);
    assert.match(text, /YFG Fatso[\s\S]*2 songs/);
    assert.match(text, /Two Songs[\s\S]*2 songs/);
    assert.doesNotMatch(text, /One Hit/, "one song is not an artist row:\n" + text);
    await tab(page, "songs");
    const c = await track(page, "C");
    assert.equal(await subtitle(page, c.id), "One Hit", "the song keeps its artist name");

    await page.evaluate(async () => {
      const base = Lyra.app.tracks.find((t) => t.title === "C");
      await Lyra.db.addTrack({
        title: "C Two", artist: "One Hit", album: "", duration: 100,
        addedAt: Date.now() + 9, plays: 0, liked: false, lyrics: "", audio: base.audio,
      });
      await Lyra.app.refreshData();
      Lyra.app.go("library");
    });
    await tab(page, "artists");
    assert.match(await libText(page), /One Hit[\s\S]*2 songs/, "joins the shelf once there are two");
  });

  console.log("\nEditing keeps your place");
  await check("saving an album does not jump the list back to the top", async () => {
    const specs = [];
    for (let i = 0; i < 24; i++) specs.push({ title: "Row " + i, artist: "YFG Fatso", album: "" });
    await seed(page, specs);
    await tab(page, "songs");
    const before = await page.evaluate(async () => {
      const shell = document.getElementById("view");
      shell.scrollTop = 600;
      await new Promise((r) => setTimeout(r, 120));
      return shell.scrollTop;
    });
    assert.ok(before > 300, "the list actually scrolled (" + before + ")");
    await page.evaluate(() => Lyra.app._test.editInfoSheet([Lyra.app.tracks[0]]));
    await page.waitForTimeout(200);
    await page.fill("#ef-album", "Tape 2020");
    await page.click("#ef-save");
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => document.getElementById("view").scrollTop);
    assert.ok(after > before - 40, "stayed at " + after + " (was " + before + ")");
    const closed = await page.evaluate(() => document.getElementById("sheet").classList.contains("hidden"));
    assert.equal(closed, true, "the sheet closed");
  });

  console.log("\nEdge cases");
  await check("clearing the artist falls back to Unknown Artist", async () => {
    await seed(page, [{ title: "A", artist: "YFG Fatso", album: "" }]);
    const a = await track(page, "A");
    await openEdit(page, a.id);
    await saveEdit(page, { artist: "   " });
    const saved = await track(page, "A");
    assert.equal(saved.artist, "Unknown Artist");
    assert.equal(saved.artistManual, false);
    assert.equal(await subtitle(page, a.id), "Unknown Artist");
  });

  await check("editing the playing song updates the mini player and Now Playing text", async () => {
    await seed(page, [{ title: "A", artist: "Unknown Artist", album: "" }]);
    await page.evaluate(async () => {
      const id = Lyra.app.tracks[0].id;
      await Lyra.player.playQueue([id], 0);
    });
    await page.waitForTimeout(400);
    const a = await track(page, "A");
    await openEdit(page, a.id);
    await saveEdit(page, { artist: "YFG Fatso" });
    const labels = await page.evaluate(() => ({
      mini: document.getElementById("mini-artist").textContent,
      np: document.getElementById("np-artist").textContent,
      media: navigator.mediaSession && navigator.mediaSession.metadata ? navigator.mediaSession.metadata.artist : null,
    }));
    assert.equal(labels.mini, "YFG Fatso");
    assert.equal(labels.np, "YFG Fatso");
    if (labels.media !== null) assert.equal(labels.media, "YFG Fatso");
  });

  await check("sheet has both fields, prefilled, and Cancel changes nothing", async () => {
    await seed(page, [{ title: "A", artist: "YFG Fatso", album: "Mixtape" }]);
    const a = await track(page, "A");
    await openEdit(page, a.id);
    const vals = await page.evaluate(() => ({
      artist: document.getElementById("ef-artist").value,
      album: document.getElementById("ef-album").value,
      artists: [...document.querySelectorAll("#ef-artists option")].map((o) => o.value),
    }));
    assert.equal(vals.artist, "YFG Fatso");
    assert.equal(vals.album, "Mixtape");
    assert.ok(vals.artists.includes("YFG Fatso"), "existing artists offered as suggestions");
    await page.fill("#ef-artist", "Nope");
    await page.click("#ef-cancel");
    await page.waitForTimeout(150);
    assert.equal((await track(page, "A")).artist, "YFG Fatso");
  });

  await check("the sheet fits the screen with tappable fields and both buttons", async () => {
    await seed(page, [{ title: "A", artist: "Unknown Artist", album: "" }]);
    const a = await track(page, "A");
    await openEdit(page, a.id);
    const box = await page.evaluate(() => {
      const r = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, width: b.width, height: b.height };
      };
      return {
        vh: window.innerHeight,
        sheet: r("#sheet"),
        artist: r("#ef-artist"),
        album: r("#ef-album"),
        save: r("#ef-save"),
        note: r(".edit-note"),
      };
    });
    assert.ok(box.sheet.bottom <= box.vh, "sheet stays on screen");
    assert.ok(box.artist.height >= 44, "artist field is a 44px+ touch target");
    assert.ok(box.album.height >= 44, "album field is a 44px+ touch target");
    assert.ok(box.artist.width > 240, "fields span the sheet width");
    assert.ok(box.note.bottom <= box.vh, "explanatory note is not clipped");
    assert.ok(box.save.height >= 38 && box.save.bottom <= box.vh, "Save is reachable");
    // Leave the sheet closed so later checks are not clicking through the backdrop.
    await page.click("#ef-cancel");
    await page.waitForTimeout(120);
  });

  console.log("\nSettings version");
  await check("the version label reports the installed build and flags a newer one", async () => {
    const labels = await page.evaluate(() => ({
      app: Lyra.app._test.appVersion,
      same: Lyra.app._test.versionLabel("v7", "v7"),
      stale: Lyra.app._test.versionLabel("v2", "v7"),
      none: Lyra.app._test.versionLabel("", ""),
      offline: Lyra.app._test.versionLabel("v7", ""),
      newest: Lyra.app._test.newestVersion(["v9", "v10", "v2"]),
    }));
    const v = labels.app;
    assert.match(v, /^\d+\.\d+\.\d+$/, "app version looks like a release");
    assert.equal(labels.same, `Lyra ${v} · build v7`);
    assert.equal(labels.stale, `Lyra ${v} · build v2 · v7 available`, "a stale phone must show both builds");
    assert.equal(labels.none, `Lyra ${v}`);
    assert.equal(labels.offline, `Lyra ${v} · build v7`);
    assert.equal(labels.newest, "v10", "numeric, not string, ordering");
  });

  await check("Settings shows the version, the live build state and an update row", async () => {
    await page.evaluate(() => Lyra.app.go("settings"));
    await page.waitForTimeout(700);
    const info = await page.evaluate(() => ({
      version: document.getElementById("set-version").textContent,
      sub: document.getElementById("set-update-sub").textContent,
      hasUpdateRow: !!document.getElementById("set-update"),
    }));
    assert.ok(info.hasUpdateRow);
    assert.match(info.version, /^Lyra \d+\.\d+\.\d+ · build v\d+/, "version text: " + info.version);
    assert.match(info.version, /build v\d+/, "includes the installed build: " + info.version);
    assert.match(info.sub, /latest build|newer build|offline/i, "status text: " + info.sub);
  });

  await check("Check for updates reloads into a working app", async () => {
    await page.evaluate(() => Lyra.app.go("settings"));
    await page.waitForTimeout(200);
    // Bring the row out from under the floating bars before tapping it.
    await page.evaluate(() => {
      document.getElementById("set-update").scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(150);
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
      page.click("#set-update"),
    ]);
    await page.waitForFunction(() => window.Lyra && Lyra.app && Lyra.app.tracks, null, { timeout: 10000 });
    const ok = await page.evaluate(() => !!document.querySelector(".nav-btn"));
    assert.equal(ok, true);
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
