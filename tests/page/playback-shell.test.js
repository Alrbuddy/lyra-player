/* Headless page tests for the app shell: swipe-to-dismiss, trim band,
 * tab switching, zoom/pan locks and the upload body prepared for Groq.
 * iPhone viewport 390x844, served from a /Lyra/ subfolder.
 * Run: node tests/page/playback-shell.test.js
 */
"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
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

async function seed(page, extra) {
  return page.evaluate(async (extra) => {
    await Lyra.db.clearAll();
    const sr = 8000, frames = sr * 100;
    const buf = new ArrayBuffer(44 + frames * 2);
    const dv = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); dv.setUint32(4, 36 + frames * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true); ws(36, "data"); dv.setUint32(40, frames * 2, true);
    const blob = new Blob([buf], { type: "audio/wav" });
    const id = await Lyra.db.addTrack(Object.assign({
      title: "Shell Fixture Song With A Very Long Title To Check Nothing Overflows The Screen",
      artist: "Fixture Artist",
      album: "",
      duration: 100,
      audio: blob,
      addedAt: Date.now(),
      plays: 0,
      liked: false,
      lyrics: "",
    }, extra || {}));
    await Lyra.app.refreshData();
    Lyra.app.go("library");
    return id;
  }, extra);
}

async function closeNp(page) {
  await page.evaluate(() => document.getElementById("np").classList.add("hidden"));
  await page.waitForTimeout(120);
}

async function openNp(page) {
  await closeNp(page);
  await page.evaluate(async () => {
    const id = Lyra.app.tracks[0].id;
    await Lyra.player.playQueue([id], 0);
  });
  await page.waitForTimeout(400);
  await page.click("#mini");
  await page.waitForTimeout(350);
}

async function npHidden(page) {
  return page.evaluate(() => document.getElementById("np").classList.contains("hidden"));
}

async function dragMouse(page, fromY, toY) {
  await page.mouse.move(195, fromY);
  await page.mouse.down();
  await page.mouse.move(195, toY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(420);
}

async function dragTouch(page, fromY, toY) {
  await page.evaluate(async ({ fromY, toY }) => {
    const el = document.getElementById("np-drag");
    const mk = (y) => new Touch({ identifier: 7, target: el, clientX: 195, clientY: y });
    const fire = (type, y, list) => el.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: (list || []).map(mk), targetTouches: (list || []).map(mk),
      changedTouches: [mk(y)],
    }));
    fire("touchstart", fromY, [fromY]);
    for (let i = 1; i <= 6; i++) {
      fire("touchmove", fromY + ((toY - fromY) * i) / 6, [fromY + ((toY - fromY) * i) / 6]);
      await new Promise((r) => setTimeout(r, 12));
    }
    fire("touchend", toY, []);
  }, { fromY, toY });
  await page.waitForTimeout(420);
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

  console.log("\nNow Playing dismissal");
  await check("dragging down from the top of Now Playing closes it", async () => {
    await seed(page, null);
    await openNp(page);
    assert.equal(await npHidden(page), false, "sheet starts open");
    await dragMouse(page, 300, 520);
    assert.equal(await npHidden(page), true, "closed after a downward drag");
  });

  await check("a small drag springs back instead of closing", async () => {
    await openNp(page);
    await dragMouse(page, 300, 340);
    assert.equal(await npHidden(page), false, "still open after 40px");
    const transform = await page.evaluate(() => document.getElementById("np").style.transform);
    assert.equal(transform, "", "transform reset after release");
  });

  await check("dragging up scrolls the sheet instead of dismissing it", async () => {
    await dragMouse(page, 500, 250);
    assert.equal(await npHidden(page), false);
  });

  await check("a touch swipe down closes it too", async () => {
    await page.evaluate(() => document.getElementById("np").classList.remove("hidden"));
    await page.waitForTimeout(200);
    await dragTouch(page, 260, 520);
    assert.equal(await npHidden(page), true, "touch swipe closed the sheet");
  });

  console.log("\nTrim indicator");
  await check("a trimmed song marks the scissors button instead of striping the progress bar", async () => {
    await seed(page, { startAt: 20, endAt: 80 });
    await openNp(page);
    const info = await page.evaluate(() => {
      const fill = document.getElementById("np-seek-fill");
      const cs = getComputedStyle(fill);
      const seek = document.querySelector("#np-seek");
      const bar = seek.getBoundingClientRect();
      return {
        active: document.getElementById("np-trim").classList.contains("active"),
        aria: document.getElementById("np-trim").getAttribute("aria-label"),
        zoneExists: !!document.getElementById("np-seek-zone"),
        seekChildren: seek.children.length,
        fillHeight: cs.height,
        fillRadius: cs.borderRadius,
        bar: { top: bar.top, bottom: bar.bottom },
        extraLine: document.elementsFromPoint(150, Math.round(bar.bottom - 1))
          .filter((el) => el.closest("#np-seek") && !el.closest("#np-seek-fill")).length,
      };
    });
    assert.equal(info.active, true, "scissors button is highlighted");
    assert.match(info.aria, /trimmed/i);
    assert.equal(info.zoneExists, false, "no extra stripe element on the bar");
    assert.equal(info.seekChildren, 1, "the seek row holds only the bar");
    assert.equal(info.fillHeight, "5px");
    assert.equal(info.fillRadius, "999px");
    assert.ok(info.bar.bottom - info.bar.top === 34, "seek row is a 34px touch target");
  });

  await check("an untrimmed song leaves the scissors button plain", async () => {
    await seed(page, null);
    await openNp(page);
    const info = await page.evaluate(() => ({
      active: document.getElementById("np-trim").classList.contains("active"),
      mini: getComputedStyle(document.querySelector(".mini-progress")).height,
    }));
    assert.equal(info.active, false);
    assert.equal(info.mini, "3px", "mini player progress is a clean 3px bar");
  });

  console.log("\nTab switching");
  await check("tabs switch without View Transitions", async () => {
    await closeNp(page);
    await page.evaluate(() => {
      window.__vt = 0;
      const orig = document.startViewTransition;
      document.startViewTransition = function (...a) { window.__vt++; return orig.apply(document, a); };
    });
    for (const t of ["search", "library", "import", "settings", "home"]) {
      await page.click(`.nav-btn[data-tab="${t}"]`);
      await page.waitForTimeout(140);
      const view = await page.evaluate(() => document.querySelector("#view").innerHTML.length);
      assert.ok(view > 100, t + " rendered");
    }
    assert.equal(await page.evaluate(() => window.__vt), 0, "no view-transition snapshots");
  });

  await check("tab switches reuse the screen they already built", async () => {
    await seed(page, null);
    await page.waitForTimeout(250);
    const built = await page.evaluate(() => {
      const host = document.querySelector('.screen-host[data-screen="library"]');
      window.__libHost = host;
      window.__libRow = host.querySelector(".song-row");
      return !!host && !!window.__libRow;
    });
    assert.equal(built, true, "the library screen was built once");
    for (const t of ["home", "search", "settings", "home"]) {
      await page.click(`.nav-btn[data-tab="${t}"]`);
      await page.waitForTimeout(140);
    }
    await page.click('.nav-btn[data-tab="library"]');
    await page.waitForTimeout(160);
    const after = await page.evaluate(() => {
      const host = document.querySelector('.screen-host[data-screen="library"]');
      return {
        sameHost: host === window.__libHost,
        sameRow: host.querySelector(".song-row") === window.__libRow,
        visible: !host.hidden,
        shown: [...document.querySelectorAll(".screen-host")].filter((h) => !h.hidden).map((h) => h.dataset.screen),
        navOn: document.querySelector('.nav-btn[data-tab="library"]').classList.contains("on"),
      };
    });
    assert.equal(after.sameHost, true, "the library host survives tab switches");
    assert.equal(after.sameRow, true, "its rows were never rebuilt");
    assert.equal(after.visible, true, "library is shown again");
    assert.deepEqual(after.shown, ["library"], "exactly one screen is visible");
    assert.equal(after.navOn, true, "the tab pill follows");
  });

  await check("each tab keeps its own scroll position", async () => {
    await page.evaluate(async () => {
      await Lyra.db.clearAll();
      const tiny = new Blob([new Uint8Array(64)], { type: "audio/wav" });
      for (let i = 0; i < 30; i++) {
        await Lyra.db.addTrack({
          title: "Scroll Row " + i, artist: "Scroll Artist", album: "", duration: 100,
          audio: tiny, addedAt: Date.now() - i, plays: 0, liked: false, lyrics: "",
        });
      }
      await Lyra.app.refreshData();
      Lyra.app.go("library");
    });
    await page.waitForTimeout(320);
    const parked = await page.evaluate(() => {
      const shell = document.getElementById("view");
      shell.scrollTop = 260;
      return shell.scrollTop;
    });
    assert.ok(parked > 200, "the library scrolled, got " + parked);
    await page.click('.nav-btn[data-tab="home"]');
    await page.waitForTimeout(220);
    const homeTop = await page.evaluate(() => document.getElementById("view").scrollTop);
    assert.ok(homeTop < 5, "Home opens at its own top, got " + homeTop);
    await page.click('.nav-btn[data-tab="library"]');
    await page.waitForTimeout(220);
    const back = await page.evaluate(() => document.getElementById("view").scrollTop);
    assert.ok(Math.abs(back - parked) < 8, "the library came back where it was, got " + back);
  });

  await check("a library change still shows up the next time the tab is opened", async () => {
    const gone = await page.evaluate(async () => {
      const t = Lyra.app.tracks[0];
      await Lyra.db.deleteTrack(t.id);
      await Lyra.app.refreshData();
      return { id: t.id, title: t.title };
    });
    await page.click('.nav-btn[data-tab="home"]');
    await page.waitForTimeout(180);
    await page.click('.nav-btn[data-tab="library"]');
    await page.waitForTimeout(220);
    const state = await page.evaluate((info) => ({
      row: !!document.querySelector(`[data-screen="library"] [data-play-track="${info.id}"]`),
      rows: document.querySelectorAll('[data-screen="library"] .song-row').length,
    }), gone);
    assert.equal(state.row, false, "the deleted song is gone");
    assert.ok(state.rows > 5, "the rest of the list rebuilt, got " + state.rows);
  });

  await check("a finished spin is counted without re-reading the library", async () => {
    await seed(page, null);
    await page.evaluate(() => Lyra.app.go("home"));
    await page.waitForTimeout(250);
    const spin = await page.evaluate(async () => {
      let reads = 0;
      const orig = Lyra.db.getAllTracks.bind(Lyra.db);
      Lyra.db.getAllTracks = () => { reads++; return orig(); };
      const id = Lyra.app.tracks[0].id;
      await Lyra.player.playQueue([id], 0);
      await new Promise((r) => setTimeout(r, 450));
      Lyra.player.seek(5);
      await new Promise((r) => setTimeout(r, 260));
      Lyra.player.seek(40);
      Lyra.player.audio.dispatchEvent(new Event("timeupdate"));
      await new Promise((r) => setTimeout(r, 700));
      const plays = Lyra.app.tracks[0].plays;
      Lyra.db.getAllTracks = orig;
      return { reads, plays };
    });
    assert.equal(spin.plays, 1, "the play was counted");
    assert.equal(spin.reads, 0, "no full library read during playback, got " + spin.reads);
    await page.click('.nav-btn[data-tab="library"]');
    await page.waitForTimeout(300);
    const text = await page.evaluate(() => document.getElementById("view").textContent);
    assert.match(text, /1 plays/, "the new count is on the rebuilt list");
  });

  await check("play/pause no longer rebuilds the library list", async () => {
    await seed(page, null);
    await page.evaluate(async () => {
      const id = Lyra.app.tracks[0].id;
      await Lyra.player.playQueue([id], 0);
      Lyra.app.go("library");
    });
    await page.waitForTimeout(350);
    const kept = await page.evaluate(async () => {
      window.__row = document.querySelector("#lib-body .song-row");
      await Lyra.player.toggle();
      await new Promise((r) => setTimeout(r, 260));
      return document.querySelector("#lib-body .song-row") === window.__row;
    });
    assert.equal(kept, true, "same DOM node before and after pause");
  });

  await check("tapping the tab you are on jumps back to the top", async () => {
    await page.evaluate(async () => {
      const tiny = new Blob([new Uint8Array(64)], { type: "audio/wav" });
      for (let i = 0; i < 30; i++) {
        await Lyra.db.addTrack({
          title: "Tap Row " + i, artist: "Tap Artist", album: "", duration: 100,
          audio: tiny, addedAt: Date.now() - i, plays: 0, liked: false, lyrics: "",
        });
      }
      await Lyra.app.refreshData();
      Lyra.app.go("library");
    });
    await page.waitForTimeout(320);
    const parked = await page.evaluate(() => {
      const shell = document.getElementById("view");
      shell.scrollTop = 400;
      return shell.scrollTop;
    });
    assert.ok(parked > 200, "the library really scrolled, got " + parked);
    await page.click('.nav-btn[data-tab="library"]');
    await page.waitForTimeout(700);
    const top = await page.evaluate(() => document.getElementById("view").scrollTop);
    assert.ok(top < 5, "scrolled back to the top, got " + top);
  });

  console.log("\nSwitching songs");
  await check("switching songs resets the clock to the new track", async () => {
    await seed(page, null);
    const pair = await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      await Lyra.db.addTrack({
        title: "Second Song", artist: base.artist, album: "", duration: 100,
        audio: base.audio, addedAt: Date.now() + 5, plays: 0, liked: false, lyrics: "",
      });
      await Lyra.app.refreshData();
      Lyra.app.go("library");
      return Lyra.app.tracks.map((t) => ({ id: t.id, title: t.title }));
    });
    const a = pair.find((t) => t.title.indexOf("Shell Fixture") === 0);
    const b = pair.find((t) => t.title === "Second Song");

    await page.click(`#lib-body [data-play-track="${a.id}"]`);
    await page.waitForTimeout(500);
    await page.evaluate(() => Lyra.player.seek(30));
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.getElementById("np-elapsed").textContent), "0:30");

    await page.click(`#lib-body [data-play-track="${b.id}"]`);
    await page.waitForTimeout(260);
    const now = await page.evaluate(() => ({
      elapsed: document.getElementById("np-elapsed").textContent,
      remain: document.getElementById("np-remain").textContent,
      playing: Lyra.player.state().playing,
      id: Lyra.player.state().track.id,
    }));
    assert.equal(now.id, b.id, "new song is loaded");
    assert.equal(now.elapsed, "0:00", "starts from zero, not the old position");
    assert.equal(now.remain, "-1:40", "shows the new song's length");
    assert.equal(now.playing, true, "and it is actually playing");
  });

  await check("tapping the song that is already playing keeps it playing", async () => {
    const before = await page.evaluate(() => ({
      id: Lyra.player.state().track.id,
      t: Lyra.player.state().currentTime,
    }));
    await page.evaluate((id) => document.querySelector(`#lib-body [data-play-track="${id}"]`).click(), before.id);
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => ({
      id: Lyra.player.state().track.id,
      t: Lyra.player.state().currentTime,
      playing: Lyra.player.state().playing,
    }));
    assert.equal(after.id, before.id);
    assert.equal(after.playing, true, "repeated taps do not stall playback");
    assert.ok(after.t >= before.t - 1, "it continued instead of restarting");
  });

  await check("tapping a paused song resumes it", async () => {
    await page.evaluate(() => Lyra.player.toggle());
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => Lyra.player.state().playing), false);
    const id = await page.evaluate(() => Lyra.player.state().track.id);
    await page.evaluate((id) => document.querySelector(`#lib-body [data-play-track="${id}"]`).click(), id);
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => Lyra.player.state().playing), true);
  });

  console.log("\nPlayback handoff");
  await check("tapping songs in quick succession still leaves sound playing", async () => {
    await seed(page, null);
    const ids = await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      const second = await Lyra.db.addTrack({
        title: "Second Song", artist: base.artist, album: "", duration: 100,
        audio: base.audio, addedAt: Date.now() + 5, plays: 0, liked: false, lyrics: "",
      });
      await Lyra.app.refreshData();
      return [base.id, second];
    });

    // A, then B before A has finished starting, then A again.
    await page.evaluate((ids) => Lyra.player.playQueue(ids, 0), ids);
    await page.evaluate((ids) => Lyra.player.playQueue(ids, 1), ids);
    await page.waitForTimeout(120);
    await page.evaluate((ids) => Lyra.player.playQueue(ids, 0), ids);
    await page.waitForTimeout(900);
    const a = await page.evaluate(() => ({
      id: Lyra.player.state().track.id,
      t: Lyra.player.audio.currentTime,
      paused: Lyra.player.audio.paused,
      err: Lyra.player.audio.error ? Lyra.player.audio.error.code : 0,
    }));
    await page.waitForTimeout(700);
    const b = await page.evaluate(() => ({ t: Lyra.player.audio.currentTime, paused: Lyra.player.audio.paused }));
    assert.equal(a.id, ids[0], "the last song tapped is the one loaded");
    assert.equal(a.err, 0, "no media error on the element");
    assert.equal(a.paused, false, "the element is playing");
    assert.equal(b.paused, false, "and it is still playing a moment later");
    assert.ok(b.t > a.t, "the clock is advancing (" + a.t + " → " + b.t + ")");
  });

  await check("tapping A, B, A, B, A always leaves the last tap playing", async () => {
    await seed(page, null);
    const ids = await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      const second = await Lyra.db.addTrack({
        title: "Second Song", artist: base.artist, album: "", duration: 100,
        audio: base.audio, addedAt: Date.now() + 5, plays: 0, liked: false, lyrics: "",
      });
      await Lyra.app.refreshData();
      return [base.id, second];
    });
    for (const i of [0, 1, 0, 1, 0]) {
      await page.evaluate(({ ids, i }) => Lyra.player.playQueue(ids, i), { ids, i });
      await page.waitForTimeout(90);
    }
    const ok = await page.evaluate((ids) => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const st = Lyra.player.state();
        const a = Lyra.player.audio;
        if (st.track && st.track.id === ids[0] && !a.paused && a.currentTime > 0) return resolve(true);
        if (performance.now() - t0 > 8000) {
          return resolve({ ok: false, id: st.track && st.track.id, paused: a.paused, err: a.error ? a.error.code : 0, ready: a.readyState });
        }
        requestAnimationFrame(tick);
      };
      tick();
    }), ids);
    assert.equal(ok, true, "the song that was tapped last recovered: " + JSON.stringify(ok));
    const still = await page.evaluate(() => ({ paused: Lyra.player.audio.paused, t: Lyra.player.audio.currentTime }));
    assert.equal(still.paused, false, "and it keeps playing");
    assert.ok(still.t > 0, "the clock is moving");
  });

  await check("a song whose element went silent starts again from one tap", async () => {
    // What iOS leaves behind after a failed swap: an element with no source and
    // no metadata, while the app still thinks a song is loaded.
    const wedged = await page.evaluate(async () => {
      const a = Lyra.player.audio;
      a.pause();
      a.removeAttribute("src");
      a.load();
      await new Promise((r) => setTimeout(r, 200));
      return { ready: a.readyState, src: a.currentSrc, track: Lyra.player.state().track.id };
    });
    assert.equal(wedged.ready, 0, "no loaded metadata is left behind, like a wedged element");

    await page.evaluate(() => Lyra.player.toggle());
    const recovered = await page.evaluate((id) => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const a = Lyra.player.audio;
        if (!a.paused && a.currentTime > 0 && a.currentSrc) return resolve(true);
        if (performance.now() - t0 > 9000) return resolve({ ok: false, paused: a.paused, src: a.currentSrc, err: a.error && a.error.code });
        requestAnimationFrame(tick);
      };
      tick();
    }), wedged.track);
    assert.equal(recovered, true, "the tap rebuilt the source instead of staying silent: " + JSON.stringify(recovered));
    assert.equal(await page.evaluate(() => Lyra.player.state().track.id), wedged.track, "same song, now playing");
  });

  await check("a finished song moves on to the next one", async () => {
    const ids = await page.evaluate(() => {
      const st = Lyra.player.state();
      return st.queue.length >= 2 ? [st.queue[0], st.queue[1]] : [];
    });
    assert.equal(ids.length, 2, "two songs in the queue");
    await page.evaluate((ids) => Lyra.player.playQueue(ids, 0), ids);
    await page.waitForTimeout(500);
    await page.evaluate(() => Lyra.player.seek(Lyra.player.state().duration - 0.35));
    const advanced = await page.evaluate((ids) => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (Lyra.player.state().track.id === ids[1]) return resolve(true);
        if (performance.now() - t0 > 6000) return resolve(false);
        requestAnimationFrame(tick);
      };
      tick();
    }), ids);
    assert.equal(advanced, true, "the player moved to the next track by itself");
    const after = await page.evaluate(() => ({ playing: Lyra.player.state().playing, paused: Lyra.player.audio.paused }));
    assert.equal(after.playing, true, "and it started the next song");
  });

  await check("the last song in a list continues from the top instead of stopping", async () => {
    await seed(page, null);
    const ids = await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      const second = await Lyra.db.addTrack({
        title: "Wrap Song", artist: base.artist, album: "", duration: 100,
        audio: base.audio, addedAt: Date.now() + 5, plays: 0, liked: false, lyrics: "",
      });
      await Lyra.app.refreshData();
      return [base.id, second];
    });
    await page.evaluate((ids) => Lyra.player.playQueue(ids, 1), ids);
    await page.waitForTimeout(500);
    await page.evaluate(() => Lyra.player.seek(Lyra.player.state().duration - 0.35));
    const out = await page.evaluate((ids) => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const st = Lyra.player.state();
        if (st.track.id === ids[0]) return resolve({ advanced: true, playing: st.playing, repeat: st.repeat });
        if (performance.now() - t0 > 7000) return resolve({ advanced: false, playing: st.playing, repeat: st.repeat });
        requestAnimationFrame(tick);
      };
      tick();
    }), ids);
    assert.equal(out.repeat, "all", "a fresh player loops its queue");
    assert.equal(out.advanced, true, "the end of the list wrapped to the first song");
    assert.equal(out.playing, true, "and it is playing, not paused at the end");
  });

  await check("a single-song queue starts over instead of going quiet", async () => {
    const id = await page.evaluate(async () => {
      const id = Lyra.app.tracks[0].id;
      await Lyra.player.playQueue([id], 0);
      return id;
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => Lyra.player.seek(Lyra.player.state().duration - 0.35));
    await page.waitForTimeout(3000);
    const out = await page.evaluate((id) => ({
      same: Lyra.player.state().track.id === id,
      playing: Lyra.player.state().playing,
      t: Lyra.player.audio.currentTime,
    }), id);
    assert.equal(out.same, true, "it is still the same song");
    assert.equal(out.playing, true, "and playing again rather than paused at the end");
    assert.ok(out.t < 5, "from the top, at " + Math.round(out.t) + "s");
  });

  await check("the repeat button only loops the list or the song, and the end never stops", async () => {
    const states = await page.evaluate(() => {
      const seen = [];
      for (let i = 0; i < 4; i++) seen.push(Lyra.player.cycleRepeat());
      while (Lyra.player.state().repeat !== "all") Lyra.player.cycleRepeat();
      return seen;
    });
    assert.equal(states.includes("off"), false, "there is no 'off' state to stop playback: " + states);
    assert.deepEqual([...new Set(states)].sort(), ["all", "one"], "just loop and loop-one");

    const ids = await page.evaluate(() => Lyra.player.state().queue.slice());
    await page.evaluate((ids) => Lyra.player.playQueue(ids, ids.length - 1), ids);
    await page.waitForTimeout(500);
    await page.evaluate(() => Lyra.player.seek(Lyra.player.state().duration - 0.35));
    await page.waitForTimeout(3500);
    const out = await page.evaluate((ids) => ({
      id: Lyra.player.state().track.id,
      first: ids[0],
      playing: Lyra.player.state().playing,
    }), ids);
    assert.equal(out.id, out.first, "the last song wrapped to the first one");
    assert.equal(out.playing, true, "and kept playing instead of pausing");
  });

  await check("with shuffle on, the end of the queue deals another song", async () => {
    await seed(page, null);
    const size = await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      for (const title of ["Shuffle Two", "Shuffle Three", "Shuffle Four"]) {
        await Lyra.db.addTrack({
          title, artist: base.artist, album: "", duration: 100,
          audio: base.audio, addedAt: Date.now() + Math.random(), plays: 0, liked: false, lyrics: "",
        });
      }
      await Lyra.app.refreshData();
      const ids = Lyra.app.tracks.map((t) => t.id);
      await Lyra.player.playQueue(ids, 0, { shuffle: true });
      const q = Lyra.player.state().queue.slice();
      await Lyra.player.playAt(q.length - 1);
      return q.length;
    });
    assert.equal(size, 4, "four songs shuffled");
    await page.waitForTimeout(500);
    const last = await page.evaluate(() => Lyra.player.state().track.id);
    await page.evaluate(() => Lyra.player.seek(Lyra.player.state().duration - 0.35));
    const out = await page.evaluate((last) => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const st = Lyra.player.state();
        if (st.track && st.track.id !== last) {
          return resolve({ id: st.track.id, playing: st.playing, queue: st.queue.slice(), shuffle: st.shuffle });
        }
        if (performance.now() - t0 > 7000) {
          return resolve({ id: last, playing: st.playing, queue: st.queue.slice(), shuffle: st.shuffle });
        }
        requestAnimationFrame(tick);
      };
      tick();
    }), last);
    assert.equal(out.shuffle, true, "shuffle is on");
    assert.notEqual(out.id, last, "a different song came on, not the same one again");
    assert.equal(out.playing, true, "and it is playing");
    assert.equal(out.queue.length, 4, "the new order keeps the whole queue");
    assert.ok(out.queue.includes(last), "the song that just finished is still in the loop");
    assert.equal(out.queue[0], out.id, "the new order starts with the song that is now playing");
    await page.evaluate(() => Lyra.player.setShuffle(false));
  });

  await check("dragging the timeline scrubs without moving or scrolling the sheet", async () => {
    await seed(page, { lyrics: "Line one of the fixture\nLine two of the fixture", lyricsSynced: {
      lines: [
        { t: 0, end: 10, text: "Line one of the fixture", words: [] },
        { t: 10, end: 20, text: "Line two of the fixture", words: [] },
        { t: 20, end: 30, text: "Line three of the fixture", words: [] },
      ],
      matchRate: 1, source: "fixture", createdAt: Date.now(),
    } });
    await openNp(page);
    await page.evaluate(() => { document.getElementById("np-drag").scrollTop = 0; });

    const info = await page.evaluate(async () => {
      const seek = document.getElementById("np-seek");
      const r = seek.getBoundingClientRect();
      const y = Math.round(r.top + r.height / 2);
      const x0 = r.left + r.width * 0.2;
      const x1 = r.left + r.width * 0.7;
      const mk = (x) => new Touch({ identifier: 11, target: seek, clientX: x, clientY: y });
      const fire = (type, x, list) => seek.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: (list || []).map(mk), targetTouches: (list || []).map(mk), changedTouches: [mk(x)],
      }));
      fire("touchstart", x0, [x0]);
      for (let i = 1; i <= 5; i++) {
        const x = x0 + ((x1 - x0) * i) / 5;
        fire("touchmove", x, [x]);
        await new Promise((res) => setTimeout(res, 12));
      }
      fire("touchend", x1, []);
      await new Promise((res) => setTimeout(res, 220));
      return {
        transform: document.getElementById("np").style.transform,
        hidden: document.getElementById("np").classList.contains("hidden"),
        scrollTop: document.getElementById("np-drag").scrollTop,
        fill: document.getElementById("np-seek-fill").firstElementChild.style.width,
        time: Lyra.player.state().currentTime,
        duration: Lyra.player.state().duration,
      };
    });
    assert.equal(info.hidden, false, "the sheet stayed open");
    assert.equal(info.transform, "", "the sheet was not dragged down");
    assert.equal(info.scrollTop, 0, "the sheet was not scrolled");
    assert.match(info.fill, /70(\.\d+)?%/, "the bar followed the finger");
    assert.ok(Math.abs(info.time - info.duration * 0.7) < info.duration * 0.12,
      "the song jumped to the touched position (" + Math.round(info.time) + "s)");
  });

  await check("the lyrics card previews the line that is playing", async () => {
    // Force a reload: clearing the store reuses track id 1, which the player
    // would otherwise treat as "this song is already loaded".
    await page.evaluate(() => Lyra.player.playAt(0));
    await page.waitForTimeout(500);
    const first = await page.evaluate(() => document.getElementById("np-lyrics-preview").textContent);
    await page.evaluate(() => Lyra.player.seek(12));
    await page.waitForTimeout(300);
    const later = await page.evaluate(() => document.getElementById("np-lyrics-preview").textContent);
    const lyricsHidden = await page.evaluate(() => document.getElementById("lyrics").classList.contains("hidden"));
    await closeNp(page);
    assert.equal(first, "Line one of the fixture\nLine two of the fixture", "first line plus the next one, got " + JSON.stringify(first));
    assert.equal(later, "Line two of the fixture\nLine three of the fixture", "preview follows playback");
    assert.equal(lyricsHidden, true, "…without opening the full lyrics view");
  });

  await check("the Home Screen icon is a real, opaque image", async () => {
    const icon = await page.evaluate(async () => {
      const img = new Image();
      img.src = "icons/apple-touch-icon.png";
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let green = 0, bright = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 1] > 110 && d[i + 1] > d[i] + 25) green++;
        if (d[i] + d[i + 1] + d[i + 2] > 120) bright++;
      }
      return { w: img.naturalWidth, h: img.naturalHeight, green, bright };
    });
    assert.equal(icon.w, 180, "iOS reads a 180x180 tile");
    assert.equal(icon.h, 180);
    assert.ok(icon.green > 400, "the green note is really drawn (" + icon.green + " px)");
    assert.ok(icon.bright > 400, "the tile is not a black square");
  });

  console.log("\nDetail play button");
  await check("the collection button turns into pause while it plays, and toggles", async () => {
    await seed(page, null);
    await page.evaluate(() => Lyra.app.go("detail", { kind: "artist", name: "Fixture Artist" }, false));
    await page.waitForTimeout(250);
    const read = () => page.evaluate(() => ({
      aria: document.querySelector("#detail-play").getAttribute("aria-label"),
      pauseIcon: document.querySelector("#detail-play").innerHTML.includes("M6 4h4v16H6z"),
      playing: Lyra.player.state().playing,
      cls: document.querySelector("#detail-play").className,
    }));

    const before = await read();
    assert.equal(before.aria, "Play");
    assert.equal(before.pauseIcon, false);

    await page.click("#detail-play");
    await page.waitForTimeout(500);
    const during = await read();
    assert.equal(during.aria, "Pause", "shows pause while playing");
    assert.equal(during.pauseIcon, true);
    assert.match(during.cls, /pause/);
    assert.equal(during.playing, true);

    await page.click("#detail-play");
    await page.waitForTimeout(300);
    const after = await read();
    assert.equal(after.aria, "Play", "back to play when paused");
    assert.equal(after.pauseIcon, false);
    assert.equal(after.playing, false);
  });

  await check("pausing from the mini player updates the big button too", async () => {
    await page.click("#detail-play");
    await page.waitForTimeout(450);
    await page.click("#mini-toggle");
    await page.waitForTimeout(300);
    const read = await page.evaluate(() => ({
      aria: document.querySelector("#detail-play").getAttribute("aria-label"),
      playing: Lyra.player.state().playing,
    }));
    assert.equal(read.playing, false);
    assert.equal(read.aria, "Play");
  });

  await check("playing from an artist page starts the song you tapped, not the old one", async () => {
    await seed(page, null);
    const ids = await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      base.artist = "Alpha Artist";
      base.artistManual = true;
      await Lyra.db.putTrack(base);
      const other = await Lyra.db.addTrack({
        title: "Zed Song", artist: "Zed", album: "", duration: 100,
        audio: base.audio, addedAt: Date.now() + 5, plays: 0, liked: false, lyrics: "",
      });
      // A second song, so the artist has a row of its own to click.
      await Lyra.db.addTrack({
        title: "Zed B-Side", artist: "Zed", album: "", duration: 100,
        audio: base.audio, addedAt: Date.now() + 6, plays: 0, liked: false, lyrics: "",
      });
      await Lyra.app.refreshData();
      return { alpha: base.id, zed: other };
    });
    // Play the first artist's song first, then start the other artist's song
    // from the Artists list.
    await page.evaluate((id) => Lyra.player.playQueue([id], 0), ids.alpha);
    await page.waitForTimeout(450);
    await page.click('.nav-btn[data-tab="library"]');
    await page.waitForTimeout(200);
    await page.click('#view [data-libfilter="artists"]');
    await page.waitForTimeout(200);
    await page.click('.sheet-item[data-detail-val="Zed"]');
    await page.waitForTimeout(250);
    await page.click(`#detail-rows [data-play-track="${ids.zed}"]`);
    await page.waitForTimeout(700);
    const st = await page.evaluate(() => ({
      id: Lyra.player.state().track.id,
      title: Lyra.player.state().track.title,
      playing: Lyra.player.state().playing,
      paused: Lyra.player.audio.paused,
      t: Lyra.player.audio.currentTime,
    }));
    assert.equal(st.id, ids.zed, "the tapped song is loaded (got " + st.title + ")");
    assert.equal(st.paused, false, "and it is playing");
    assert.equal(st.playing, true);
    assert.ok(st.t >= 0, "the clock is valid");
    // back to the song list for the next check
    await page.click('.nav-btn[data-tab="library"]');
    await page.waitForTimeout(150);
    await page.click('#view [data-libfilter="songs"]');
    await page.waitForTimeout(150);
  });

  await check("pressing play on the artist you are listening to keeps that song", async () => {
    await seed(page, null);
    const ids = await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      const newer = await Lyra.db.addTrack({
        title: "Newer Song", artist: "Shared Artist", album: "", duration: 100,
        audio: base.audio, addedAt: Date.now() + 20, plays: 0, liked: false, lyrics: "",
      });
      base.artist = "Shared Artist";
      await Lyra.db.putTrack(base);
      const outsider = await Lyra.db.addTrack({
        title: "Outsider", artist: "Other Artist", album: "", duration: 100,
        audio: base.audio, addedAt: Date.now() + 10, plays: 0, liked: false, lyrics: "",
      });
      await Lyra.app.refreshData();
      return { base: base.id, newer, outsider };
    });
    // Playing from the library: the queue is the whole library, so it is not
    // "this artist's collection" even though the song belongs to the artist.
    await page.evaluate((ids) => Lyra.player.playQueue([ids.newer, ids.base, ids.outsider], 0), ids);
    await page.waitForTimeout(400);
    await page.evaluate(() => Lyra.player.seek(3));
    await page.waitForTimeout(200);
    const artistTitle = await page.evaluate((id) => Lyra.app.tracks.find((t) => t.id === id).title, ids.newer);
    await page.evaluate(() => Lyra.app.go("detail", { kind: "artist", name: "Shared Artist" }, false));
    await page.waitForTimeout(350);
    const before = await page.evaluate(() => ({
      rows: document.querySelectorAll("#detail-rows [data-play-track]").length,
      playingRow: (document.querySelector("#detail-rows .song-title.playing") || {}).textContent,
      aria: document.querySelector("#detail-play").getAttribute("aria-label"),
    }));
    assert.equal(before.rows, 2, "the artist page lists both songs");
    const order = await page.evaluate(() => [...document.querySelectorAll("#detail-rows .song-title")].map((n) => n.textContent));
    assert.equal(order[0], "Shell Fixture Song With A Very Long Title To Check Nothing Overflows The Screen",
      "the page starts with the other song, so playing it would be a jump: " + order.join(" | "));
    await page.click("#detail-play");
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      id: Lyra.player.state().track.id,
      title: Lyra.player.state().track.title,
      playing: Lyra.player.state().playing,
      row: (document.querySelector("#detail-rows .song-title.playing") || {}).textContent,
      eqRows: document.querySelectorAll("#detail-rows .eq").length,
    }));
    assert.equal(after.id, ids.newer, "it kept the song that was loaded, not the first one listed (" + after.title + ")");
    assert.equal(after.playing, true);
    assert.equal(after.row, artistTitle, "the playing row follows the player");
    assert.equal(after.eqRows, 1, "exactly one row shows the level meter");
    await page.click("#detail-play");
    await page.waitForTimeout(250);
    await page.evaluate(() => Lyra.app.go("library"));
    await page.waitForTimeout(250);
  });

  await check("the artist page moves its now-playing marker with the player", async () => {
    await page.evaluate(() => Lyra.app.go("detail", { kind: "artist", name: "Shared Artist" }, false));
    await page.waitForTimeout(350);
    const rows = await page.evaluate(() => [...document.querySelectorAll("#detail-rows [data-play-track]")]
      .map((r) => ({ id: Number(r.dataset.playTrack), title: r.querySelector(".song-title").textContent })));
    const current = await page.evaluate(() => Lyra.player.state().track.id);
    const target = rows.find((r) => r.id !== current);
    await page.click(`#detail-rows [data-play-track="${target.id}"]`);
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => ({
      playing: Lyra.player.state().track.id,
      marked: [...document.querySelectorAll("#detail-rows .song-title.playing")].map((n) => n.textContent),
      eq: document.querySelectorAll("#detail-rows .eq").length,
    }));
    assert.equal(after.playing, target.id, "the tapped row started");
    assert.deepEqual(after.marked, [target.title], "the green row followed the player");
    assert.equal(after.eq, 1, "one level meter, on the right row");
    await page.evaluate(() => Lyra.app.go("library"));
    await page.waitForTimeout(250);
  });

  await check("the Library Select button adds chosen songs to a playlist", async () => {
    await seed(page, null);
    await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      await Lyra.db.addTrack({
        title: "Second Pick", artist: base.artist, album: "", duration: 100,
        audio: base.audio, addedAt: Date.now() + 5, plays: 0, liked: false, lyrics: "",
      });
      await Lyra.db.addPlaylist({ name: "Mix", trackIds: [] });
      await Lyra.app.refreshData();
      Lyra.app.go("library");
    });
    await page.waitForTimeout(400);

    const entry = await page.evaluate(() => {
      const b = document.getElementById("lib-select");
      const r = b.getBoundingClientRect();
      const h1 = document.querySelector(".screen-host[data-screen='library'] .h-screen").getBoundingClientRect();
      return { label: b.textContent, w: Math.round(r.width), h: Math.round(r.height), overlapsTitle: h1.right > r.left, right: Math.round(r.right) };
    });
    assert.equal(entry.label, "Select", "the library has a Select button");
    assert.ok(entry.w >= 50 && entry.h >= 30, "it is a real button, got " + entry.w + "x" + entry.h);
    assert.equal(entry.overlapsTitle, false, "it does not run into the title");
    assert.ok(entry.right <= 390, "it fits on a 390px screen");

    await page.click("#lib-select");
    await page.waitForTimeout(250);
    const started = await page.evaluate(() => ({
      label: document.getElementById("lib-select").textContent,
      bar: !!document.querySelector(".bulk-bar"),
      addDisabled: document.getElementById("bulk-add").disabled,
      delDisabled: document.getElementById("bulk-del").disabled,
      barBottom: Math.round(document.querySelector(".bulk-bar").getBoundingClientRect().bottom),
      navTop: Math.round(document.querySelector(".nav").getBoundingClientRect().top),
    }));
    assert.equal(started.label, "Done", "the button turns into Done");
    assert.equal(started.bar, true, "the selection bar appears");
    assert.equal(started.addDisabled, true, "Add is disabled with nothing selected");
    assert.equal(started.delDisabled, true, "Delete too");
    assert.ok(started.barBottom <= started.navTop, "the bar sits above the tab bar");

    const before = await page.evaluate(() => Lyra.player.state().track && Lyra.player.state().track.id);
    await page.click("#lib-body .song-row:nth-child(1)");
    await page.click("#lib-body .song-row:nth-child(2)");
    await page.waitForTimeout(200);
    const picked = await page.evaluate((before) => ({
      count: document.getElementById("bulk-count").textContent,
      checks: document.querySelectorAll("#lib-body .checkbox.on").length,
      addDisabled: document.getElementById("bulk-add").disabled,
      changed: (Lyra.player.state().track && Lyra.player.state().track.id) !== before,
    }), before);
    assert.equal(picked.count, "2 selected");
    assert.equal(picked.checks, 2);
    assert.equal(picked.addDisabled, false, "Add wakes up once songs are chosen");
    assert.equal(picked.changed, false, "choosing songs does not start playback");

    await page.click("#bulk-add");
    await page.waitForTimeout(350);
    const sheet = await page.evaluate(() => {
      const target = [...document.querySelectorAll("#sheet [data-pl]")].find((b) => /Mix/.test(b.textContent));
      return { open: !!target, value: target ? target.dataset.pl : null };
    });
    assert.equal(sheet.open, true, "the playlist sheet lists the playlist");
    await page.evaluate((value) => document.querySelector(`#sheet [data-pl="${value}"]`).click(), sheet.value);
    await page.waitForTimeout(600);
    const done = await page.evaluate(async () => {
      const pls = await Lyra.db.getAllPlaylists();
      const mix = pls.find((p) => p.name === "Mix");
      return {
        count: mix ? mix.trackIds.length : -1,
        titles: mix ? mix.trackIds.map((id) => (Lyra.app.tracks.find((t) => t.id === id) || {}).title) : [],
        bar: !!document.querySelector(".bulk-bar"),
        label: document.getElementById("lib-select").textContent,
      };
    });
    assert.equal(done.count, 2, "both chosen songs are in the playlist");
    assert.deepEqual(done.titles.sort(), ["Second Pick", "Shell Fixture Song With A Very Long Title To Check Nothing Overflows The Screen"].sort());
    assert.equal(done.bar, false, "selection mode closed itself");
    assert.equal(done.label, "Select");
  });

  await check("holding a playlist offers to delete it, and a plain tap still opens it", async () => {
    await seed(page, null);
    await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      for (const name of ["Keep Me", "Hold Me"]) {
        await Lyra.db.addPlaylist({ name, trackIds: [base.id], createdAt: Date.now() });
      }
      await Lyra.app.refreshData();
      Lyra.app.go("library");
    });
    await page.waitForTimeout(300);
    await page.click('#view [data-libfilter="playlists"]');
    await page.waitForTimeout(250);

    // A normal tap opens the playlist.
    await page.evaluate(() =>
      [...document.querySelectorAll("#lib-body [data-detail-kind='playlist']")]
        .find((b) => /Keep Me/.test(b.textContent)).click());
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() =>
      [...document.querySelectorAll(".screen-host")].filter((h) => !h.hidden).map((h) => h.dataset.screen));
    assert.deepEqual(opened, ["detail"], "a tap opens the playlist");

    await page.evaluate(() => Lyra.app.go("library"));
    await page.waitForTimeout(250);
    await page.click('#view [data-libfilter="playlists"]');
    await page.waitForTimeout(250);

    // Hold the other one: the sheet appears, and the click after the hold is
    // swallowed instead of opening the playlist.
    const held = await page.evaluate(async () => {
      const tile = [...document.querySelectorAll("#lib-body [data-hold-pl]")]
        .find((b) => /Hold Me/.test(b.textContent));
      const fire = (type) => tile.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      tile.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 300, button: 0 }));
      await new Promise((r) => setTimeout(r, 700));
      tile.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 40, clientY: 300 }));
      fire("click");
      await new Promise((r) => setTimeout(r, 250));
      const sheet = document.getElementById("sheet");
      return {
        sheetOpen: !sheet.classList.contains("hidden"),
        title: sheet.querySelector(".sheet-title")?.textContent || "",
        body: sheet.innerText,
        shown: [...document.querySelectorAll(".screen-host")].filter((h) => !h.hidden).map((h) => h.dataset.screen),
      };
    });
    assert.equal(held.sheetOpen, true, "holding a playlist opens the delete sheet");
    assert.match(held.title, /Delete playlist/i);
    assert.match(held.body, /Hold Me/);
    assert.deepEqual(held.shown, ["library"], "and it did not also open the playlist");

    await page.click("#sh-ok");
    await page.waitForTimeout(500);
    const after = await page.evaluate(async () => {
      const pls = await Lyra.db.getAllPlaylists();
      return {
        names: pls.map((p) => p.name).sort(),
        songs: Lyra.app.tracks.length,
        shown: [...document.querySelectorAll(".screen-host")].filter((h) => !h.hidden).map((h) => h.dataset.screen),
      };
    });
    assert.deepEqual(after.names, ["Keep Me"], "only the held playlist was deleted");
    assert.equal(after.songs, 1, "its song is untouched");
    assert.deepEqual(after.shown, ["library"], "the library is still on screen");
    // Back to the Songs tab for the checks that follow.
    await page.evaluate(async () => {
      document.querySelector('#view [data-libfilter="songs"]').click();
      await new Promise((r) => setTimeout(r, 200));
    });
  });

  await check("Select on the Playlists tab deletes several at once", async () => {
    await seed(page, null);
    await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      for (const name of ["Alpha List", "Beta List", "Gamma List"]) {
        await Lyra.db.addPlaylist({ name, trackIds: [base.id], createdAt: Date.now() });
      }
      await Lyra.app.refreshData();
      Lyra.app.go("library");
    });
    await page.waitForTimeout(300);
    await page.click('#view [data-libfilter="playlists"]');
    await page.waitForTimeout(250);

    const start = await page.evaluate(() => {
      document.getElementById("lib-select").click();
      return true;
    });
    assert.equal(start, true);
    await page.waitForTimeout(300);
    const entering = await page.evaluate(() => {
      const bar = document.querySelector(".bulk-bar");
      return {
        label: document.getElementById("lib-select").textContent,
        bar: !!bar,
        watched: bar ? bar.querySelectorAll(".btn").length : 0,
        delDisabled: document.getElementById("bulk-pl-del").disabled,
        checks: document.querySelectorAll("#lib-body .checkbox").length,
      };
    });
    assert.equal(entering.label, "Done", "the button turns into Done");
    assert.equal(entering.bar, true, "a selection bar appears");
    assert.equal(entering.watched, 1, "it offers just Delete for playlists");
    assert.equal(entering.delDisabled, true, "Delete is disabled with nothing chosen");
    assert.equal(entering.checks, 3, "every playlist gets a checkbox");

    await page.evaluate(() => {
      const tiles = [...document.querySelectorAll("#lib-body [data-pl-tile]")];
      tiles.find((b) => /Alpha List/.test(b.textContent)).click();
      tiles.find((b) => /Beta List/.test(b.textContent)).click();
    });
    await page.waitForTimeout(300);
    const chosen = await page.evaluate(() => ({
      count: document.getElementById("bulk-count").textContent,
      checks: document.querySelectorAll("#lib-body .checkbox.on").length,
      delDisabled: document.getElementById("bulk-pl-del").disabled,
      shown: [...document.querySelectorAll(".screen-host")].filter((h) => !h.hidden).map((h) => h.dataset.screen),
    }));
    assert.equal(chosen.count, "2 selected");
    assert.equal(chosen.checks, 2);
    assert.equal(chosen.delDisabled, false);
    assert.deepEqual(chosen.shown, ["library"], "choosing a playlist does not open it");

    await page.click("#bulk-pl-del");
    await page.waitForTimeout(300);
    const asked = await page.evaluate(() => document.getElementById("sheet").innerText);
    assert.match(asked, /Delete 2 playlists/);
    await page.click("#sh-ok");
    await page.waitForTimeout(500);
    const done = await page.evaluate(async () => {
      const pls = await Lyra.db.getAllPlaylists();
      return {
        names: pls.map((p) => p.name).sort(),
        tracksLeft: pls.reduce((n, p) => n + p.trackIds.length, 0),
        bar: !!document.querySelector(".bulk-bar"),
        label: document.getElementById("lib-select").textContent,
        songs: Lyra.app.tracks.length,
      };
    });
    assert.deepEqual(done.names, ["Gamma List"], "the two chosen playlists are gone");
    assert.equal(done.tracksLeft, 1, "the untouched playlist still holds its song");
    assert.equal(done.songs, 1, "the song itself was not deleted");
    assert.equal(done.bar, false, "selection closed after deleting");
    assert.equal(done.label, "Select");
    // Back to the Songs tab for the checks that follow.
    await page.evaluate(async () => {
      document.querySelector('#view [data-libfilter="songs"]').click();
      await new Promise((r) => setTimeout(r, 200));
    });
  });

  await check("the selection bar clears the mini player, with hittable buttons", async () => {
    await seed(page, null);
    await page.evaluate(async () => {
      await Lyra.player.playQueue([Lyra.app.tracks[0].id], 0);
      await new Promise((r) => setTimeout(r, 350));
      Lyra.app.go("library");
    });
    await page.waitForTimeout(300);
    await page.click("#lib-select");
    await page.waitForTimeout(250);
    await page.click("#lib-body .song-row");
    await page.waitForTimeout(250);

    const geo = await page.evaluate(() => {
      const bar = document.querySelector(".bulk-bar");
      const mini = document.getElementById("mini");
      const b = bar.getBoundingClientRect();
      const m = mini.getBoundingClientRect();
      const hit = (el) => {
        const r = el.getBoundingClientRect();
        const node = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          inside: !!(node && (node === el || el.contains(node))),
          got: node ? (node.id || node.className) : "nothing",
          w: Math.round(r.width), h: Math.round(r.height),
        };
      };
      return {
        hasMini: document.body.classList.contains("has-mini"),
        miniHidden: mini.classList.contains("hidden"),
        barTop: Math.round(b.top), barBottom: Math.round(b.bottom),
        miniTop: Math.round(m.top), vh: window.innerHeight,
        add: hit(document.getElementById("bulk-add")),
        edit: hit(document.getElementById("bulk-edit")),
        del: hit(document.getElementById("bulk-del")),
        navTop: Math.round(document.querySelector(".nav").getBoundingClientRect().top),
      };
    });
    assert.equal(geo.hasMini, true, "the app knows the mini player is on screen");
    assert.equal(geo.miniHidden, false, "it really is");
    assert.ok(geo.barBottom <= geo.miniTop - 4,
      "the bar sits above the mini player (bar bottom " + geo.barBottom + ", mini top " + geo.miniTop + ")");
    assert.ok(geo.barTop > 0, "and on screen (top " + geo.barTop + ")");
    assert.equal(geo.navTop > geo.miniTop, true, "mini is above the tab bar");
    assert.equal(geo.add.inside, true, "Add is tappable, hit " + geo.add.got);
    assert.equal(geo.edit.inside, true, "Edit is tappable, hit " + geo.edit.got);
    assert.equal(geo.del.inside, true, "Delete is tappable, hit " + geo.del.got);
    assert.ok(geo.add.w >= 40 && geo.del.w >= 40, "the buttons keep a real hit area");

    // Stop the player: the bar drops back down to the tab bar gap.
    await page.evaluate(() => Lyra.player.stop());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      hasMini: document.body.classList.contains("has-mini"),
      miniHidden: document.getElementById("mini").classList.contains("hidden"),
      barBottom: Math.round(document.querySelector(".bulk-bar").getBoundingClientRect().bottom),
      navTop: Math.round(document.querySelector(".nav").getBoundingClientRect().top),
    }));
    assert.equal(after.hasMini, false, "no mini player, no reserved room");
    assert.equal(after.miniHidden, true);
    assert.ok(after.barBottom <= after.navTop, "the bar still stays above the tab bar");
    assert.ok(after.barBottom > geo.barBottom - 60, "and drops back into the gap");

    await page.evaluate(async () => {
      document.getElementById("lib-select").click();
      await new Promise((r) => setTimeout(r, 200));
    });
  });

  await check("the selection bar is a shell overlay, so the list can neither scroll nor paint over it", async () => {
    await seed(page, null);
    await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      for (let i = 0; i < 24; i++) {
        await Lyra.db.addTrack({
          title: "Probe Song " + i, artist: "Probe Artist", album: "", duration: 100,
          audio: base.audio, addedAt: Date.now() + i, plays: 0, liked: false, lyrics: "",
        });
      }
      await Lyra.app.refreshData();
      await Lyra.player.playQueue([Lyra.app.tracks[0].id], 0);
      await new Promise((r) => setTimeout(r, 350));
      Lyra.app.go("library");
    });
    await page.waitForTimeout(300);
    await page.click("#lib-select");
    await page.waitForTimeout(250);
    await page.click("#lib-body .song-row");
    await page.waitForTimeout(250);

    const out = await page.evaluate(async () => {
      const bar = document.querySelector(".bulk-bar");
      const before = bar.getBoundingClientRect();
      document.getElementById("view").scrollTop = 700;
      await new Promise((r) => setTimeout(r, 200));
      const after = bar.getBoundingClientRect();
      const x = Math.round(after.left + after.width / 2);
      const y = Math.round(after.top + after.height / 2);
      const at = document.elementFromPoint(x, y);
      return {
        parent: bar.parentElement.id,
        siblingOfView: bar.parentElement.previousElementSibling && bar.parentElement.previousElementSibling.id,
        sameBox: Math.abs(before.top - after.top) < 1 && Math.abs(before.bottom - after.bottom) < 1,
        viewZ: getComputedStyle(document.getElementById("view")).zIndex,
        navZ: getComputedStyle(document.querySelector(".nav")).zIndex,
        miniZ: getComputedStyle(document.getElementById("mini")).zIndex,
        hitBar: !!(at && at.closest(".bulk-bar")),
      };
    });
    assert.equal(out.parent, "bulk-host", "the bar lives outside the scrolling list");
    assert.equal(out.siblingOfView, "view", "it is a sibling of the list, inside the app shell");
    assert.equal(out.sameBox, true, "scrolling the list does not move the bar");
    assert.equal(out.viewZ, "0", "the list sits in its own stacking context");
    assert.ok(Number(out.navZ) > Number(out.miniZ) && Number(out.miniZ) > 0, "the bars stack above it");
    assert.equal(out.hitBar, true, "a tap over the bar reaches the bar, not the row behind it");

    await page.evaluate(() => { document.getElementById("view").scrollTop = 0; document.getElementById("lib-select").click(); });
    await page.waitForTimeout(200);
  });

  await check("the selection's Edit button sets the artist and album for many songs", async () => {
    await seed(page, null);
    await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      for (const title of ["Bulk Two", "Bulk Three"]) {
        await Lyra.db.addTrack({
          title, artist: "Unknown Artist", album: "", duration: 100,
          audio: base.audio, addedAt: Date.now() + 5, plays: 0, liked: false, lyrics: "",
        });
      }
      await Lyra.app.refreshData();
      Lyra.app.go("library");
    });
    await page.waitForTimeout(400);
    await page.click("#lib-select");
    await page.waitForTimeout(200);
    for (let i = 1; i <= 3; i++) await page.click(`#lib-body .song-row:nth-child(${i})`);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.getElementById("bulk-count").textContent), "3 selected");
    assert.equal(await page.evaluate(() => document.getElementById("bulk-edit").disabled), false, "Edit wakes up with a selection");

    await page.click("#bulk-edit");
    await page.waitForTimeout(350);
    const sheet = await page.evaluate(() => ({
      title: (document.querySelector("#sheet .sheet-title") || {}).textContent,
      fields: !!document.getElementById("ef-artist") && !!document.getElementById("ef-album"),
      artistValue: (document.getElementById("ef-artist") || {}).value,
      note: (document.querySelector(".edit-note") || {}).textContent,
    }));
    assert.equal(sheet.fields, true, "the same artist/album sheet opens");
    assert.match(sheet.title, /3 songs/, "the sheet says how many songs: " + sheet.title);
    assert.equal(sheet.artistValue, "", "a mixed selection does not pretend to have one artist");
    assert.match(sheet.note, /Empty fields stay as they are/);

    await page.fill("#ef-artist", "YFG Fatso");
    await page.click("#ef-save");
    await page.waitForTimeout(600);
    const byArtist = await page.evaluate(() => ({
      tracks: Lyra.app.tracks.map((t) => ({ artist: t.artist, manual: t.artistManual, album: t.album })),
      bar: !!document.querySelector(".bulk-bar"),
    }));
    assert.equal(byArtist.tracks.length, 3);
    assert.deepEqual(byArtist.tracks.map((t) => t.artist), ["YFG Fatso", "YFG Fatso", "YFG Fatso"]);
    assert.deepEqual(byArtist.tracks.map((t) => t.manual), [true, true, true], "the edit is marked as yours");
    assert.equal(byArtist.bar, false, "selection closes after saving");

    // Album only: the artist field stays empty, so artists are left alone.
    await page.click("#lib-select");
    await page.waitForTimeout(200);
    await page.click("#lib-body .song-row:nth-child(1)");
    await page.click("#lib-body .song-row:nth-child(3)");
    await page.waitForTimeout(150);
    await page.click("#bulk-edit");
    await page.waitForTimeout(300);
    await page.fill("#ef-album", "Tape 2020");
    await page.click("#ef-save");
    await page.waitForTimeout(600);
    const mixed = await page.evaluate(() => Lyra.app.tracks
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((t) => ({ title: t.title, artist: t.artist, album: t.album, albumManual: !!t.albumManual })));
    const withAlbum = mixed.filter((t) => t.album === "Tape 2020");
    assert.equal(withAlbum.length, 2, "only the two chosen songs got the album: " + JSON.stringify(mixed));
    assert.deepEqual(mixed.map((t) => t.artist), ["YFG Fatso", "YFG Fatso", "YFG Fatso"], "artists were not blanked");
    assert.equal(mixed.find((t) => t.album === "").albumManual, false);

    const groups = await page.evaluate(async () => {
      Lyra.app.go("library");
      await new Promise((r) => setTimeout(r, 250));
      document.querySelector('#view [data-libfilter="artists"]').click();
      await new Promise((r) => setTimeout(r, 250));
      return [...document.querySelectorAll('.screen-host[data-screen="library"] .sheet-item')]
        .map((b) => b.textContent.replace(/\s+/g, " ").trim());
    });
    assert.equal(groups.length, 1, "one artist group now: " + groups.join(" | "));
    assert.match(groups[0], /YFG Fatso3 songs/);
    await page.evaluate(async () => {
      document.querySelector('#view [data-libfilter="songs"]').click();
      await new Promise((r) => setTimeout(r, 200));
    });
  });

  await check("tapping a song row starts it right away", async () => {
    await page.evaluate(() => Lyra.app.go("library"));
    await page.waitForTimeout(200);
    const started = await page.evaluate(() => {
      const row = document.querySelector("#lib-body .song-row");
      const t0 = performance.now();
      row.click();
      return new Promise((resolve) => {
        const tick = () => {
          const mini = document.getElementById("mini");
          const on = !!document.querySelector("#lib-body .song-title.playing");
          if (on && !mini.classList.contains("hidden")) resolve(performance.now() - t0);
          else if (performance.now() - t0 > 1200) resolve(-1);
          else requestAnimationFrame(tick);
        };
        tick();
      });
    });
    assert.ok(started >= 0, "the song became current without a second tap");
    assert.ok(started < 400, "row reacted in " + Math.round(started) + "ms");
  });

  await check("the bottom bars sit low, above the gesture area", async () => {
    const bar = await page.evaluate(() => {
      const nav = document.querySelector(".nav").getBoundingClientRect();
      const mini = document.querySelector(".mini").getBoundingClientRect();
      const view = getComputedStyle(document.querySelector("#view"));
      return {
        gap: Math.round(window.innerHeight - nav.bottom),
        navBottom: nav.bottom,
        vh: window.innerHeight,
        miniBottom: mini.bottom,
        padBottom: parseFloat(view.paddingBottom),
      };
    });
    assert.ok(bar.gap >= 0 && bar.gap <= 8, "tab bar hangs " + bar.gap + "px above the bottom edge");
    assert.ok(bar.navBottom <= bar.vh, "tab bar is not clipped");
    assert.ok(bar.miniBottom < bar.navBottom + 1, "mini player sits above the tab bar");
    assert.ok(bar.padBottom > 120, "content still scrolls under both bars");
  });

  console.log("\nShell locks");
  await check("the page cannot scroll sideways", async () => {
    const info = await page.evaluate(() => {
      window.scrollTo(80, 0);
      const doc = document.documentElement;
      const wide = [...document.querySelectorAll("#view *")]
        .some((el) => el.getBoundingClientRect().right > window.innerWidth + 1);
      return {
        scrollX: window.scrollX,
        docWidth: doc.scrollWidth,
        win: window.innerWidth,
        wide,
      };
    });
    assert.equal(info.scrollX, 0, "window did not pan");
    assert.ok(info.docWidth <= info.win + 1, "document is no wider than the screen");
    assert.equal(info.wide, false, "no element spills past the right edge");
  });

  await check("the bars live in a measured shell, not pinned to the browser viewport", async () => {
    const info = await page.evaluate(() => {
      const shell = document.getElementById("shell");
      const nav = document.querySelector(".nav");
      const mini = document.querySelector(".mini");
      const sb = shell.getBoundingClientRect();
      const nb = nav.getBoundingClientRect();
      const mb = mini.getBoundingClientRect();
      const hitMini = document.elementFromPoint(Math.round(mb.left + mb.width / 2), Math.round(mb.top + mb.height / 2));
      const hitNav = document.elementFromPoint(Math.round(nb.left + 40), Math.round(nb.top + nb.height / 2));
      return {
        bodyPos: getComputedStyle(document.body).position,
        shellPos: getComputedStyle(shell).position,
        navPos: getComputedStyle(nav).position,
        miniPos: getComputedStyle(mini).position,
        shellH: sb.height,
        viewH: document.querySelector("#view").getBoundingClientRect().height,
        innerH: window.innerHeight,
        miniHit: !!(hitMini && hitMini.closest("#mini")),
        navHit: !!(hitNav && hitNav.closest(".nav")),
        navInShell: shell.contains(nav),
        miniInShell: shell.contains(mini),
      };
    });
    assert.notEqual(info.bodyPos, "fixed", "a fixed body is what offset taps on iOS");
    assert.equal(info.shellPos, "absolute");
    assert.equal(info.navPos, "absolute", "tab bar is positioned inside the shell");
    assert.equal(info.miniPos, "absolute", "mini player is positioned inside the shell");
    assert.equal(info.navInShell, true);
    assert.equal(info.miniInShell, true);
    assert.ok(Math.abs(info.shellH - info.innerH) <= 1, "shell is " + info.shellH + " of " + info.innerH);
    assert.ok(Math.abs(info.viewH - info.innerH) <= 1, "view fills the shell");
    assert.equal(info.miniHit, true, "the point over the mini player hits the mini player");
    assert.equal(info.navHit, true, "the point over the tab bar hits the tab bar");
  });

  await check("Settings reports the viewport numbers", async () => {
    await page.evaluate(() => Lyra.app.go("settings"));
    await page.waitForTimeout(500);
    const text = await page.evaluate(() => document.getElementById("set-display").textContent);
    assert.match(text, /app \d+/);
    assert.match(text, /win \d+/);
    assert.match(text, /screen \d+/);
    assert.match(text, /dpr [\d.]+/);
    assert.match(text, /standalone|browser|fullscreen|minimal-ui/, "the running mode is reported");
    assert.match(text, /bar \d+/, "the bar's bottom edge is reported");
  });

  await check("a screen taller than the real viewport is not trusted blindly", async () => {
    // Simulate iOS reporting screen 844 while the page can only really be 797
    // tall: the taller shell must be dropped again, or the tab bar would be
    // painted where nothing can be tapped.
    const out = await page.evaluate(() => {
      const w = window.innerWidth, h = 797;
      document.documentElement.style.setProperty("--app-h", "797px");
      Object.defineProperty(window.screen, "height", { value: 844, configurable: true });
      Lyra.app._test.syncViewport();
      const nav = document.querySelector(".nav");
      const r = nav.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return {
        appH: getComputedStyle(document.documentElement).getPropertyValue("--app-h").trim(),
        navBottom: Math.round(r.bottom),
        reachable: !!(hit && nav.contains(hit)),
        viewportH: window.innerHeight,
      };
    });
    assert.equal(out.reachable, true, "the tab bar stays tappable");
    assert.ok(out.navBottom <= out.viewportH, "the bar is inside the real viewport: " + out.navBottom + " vs " + out.viewportH);
    assert.equal(out.appH, out.viewportH + "px", "the shell falls back to the measured height");
  });

  await check("from the Home Screen the shell uses the screen height, not a short reading", async () => {
    const out = await page.evaluate(() => {
      const realScreen = window.screen.height;
      Object.defineProperty(window.screen, "height", { value: 900, configurable: true });
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
      const winH = window.innerHeight;
      Lyra.app._test.syncViewport();
      const appH = getComputedStyle(document.documentElement).getPropertyValue("--app-h").trim();
      const shellH = getComputedStyle(document.getElementById("shell")).height;
      const navBottom = Math.round(document.getElementById("nav").getBoundingClientRect().bottom);
      Object.defineProperty(window.screen, "height", { value: realScreen, configurable: true });
      Object.defineProperty(navigator, "standalone", { value: false, configurable: true });
      Lyra.app._test.syncViewport();
      return { winH, appH, shellH, navBottom, mode: Lyra.app._test.displayMode() };
    });
    assert.equal(out.appH, "900px", "a Home Screen app fills the display (was " + out.appH + ")");
    assert.equal(out.shellH, "900px");
    assert.ok(Math.abs(out.navBottom - (900 - 4)) <= 1,
      "the tab bar sits near the bottom edge, not a status bar above it (bottom at " + out.navBottom + ")");
  });

  await check("the iPhone layout preview adds status bar and home indicator insets", async () => {
    const on = await page.evaluate(() => {
      Lyra.app._test.applySimIOS(true);
      const root = document.documentElement;
      const nav = document.getElementById("nav").getBoundingClientRect();
      const view = getComputedStyle(document.getElementById("view"));
      return {
        on: root.classList.contains("sim-ios"),
        appH: getComputedStyle(root).getPropertyValue("--app-h").trim(),
        winH: window.innerHeight,
        navBottom: Math.round(window.innerHeight - nav.bottom),
        top: Math.round(parseFloat(view.paddingTop)),
        saved: localStorage.getItem("simIOS"),
      };
    });
    assert.equal(on.on, true);
    assert.equal(on.appH, on.winH + "px", "the browser window is treated as the phone screen");
    assert.equal(on.navBottom, 8, "room for the home indicator (got " + on.navBottom + ")");
    assert.equal(on.top, 59, "room for the status bar (got " + on.top + ")");
    assert.equal(on.saved, "1", "the choice is remembered");

    const off = await page.evaluate(() => {
      Lyra.app._test.applySimIOS(false);
      return {
        on: document.documentElement.classList.contains("sim-ios"),
        top: Math.round(parseFloat(getComputedStyle(document.getElementById("view")).paddingTop)),
        saved: localStorage.getItem("simIOS"),
      };
    });
    assert.equal(off.on, false);
    assert.ok(off.top < 30, "back to the real padding (" + off.top + ")");
    assert.equal(off.saved, "0");
  });

  await check("a viewport mismatch lifts both bars by exactly that much", async () => {
    const out = await page.evaluate(() => {
      const nav = () => document.querySelector(".nav").getBoundingClientRect().bottom;
      const mini = () => document.querySelector(".mini").getBoundingClientRect().bottom;
      const pad = () => parseFloat(getComputedStyle(document.querySelector("#view")).paddingBottom);
      const before = { nav: nav(), mini: mini(), pad: pad() };
      document.documentElement.style.setProperty("--vv-lift", "40px");
      const after = { nav: nav(), mini: mini(), pad: pad() };
      document.documentElement.style.setProperty("--vv-lift", "0px");
      return { nav: Math.round(before.nav - after.nav), mini: Math.round(before.mini - after.mini), pad: Math.round(after.pad - before.pad) };
    });
    assert.equal(out.nav, 40, "tab bar lifts with the viewport");
    assert.equal(out.mini, 40, "mini player lifts with it");
    assert.equal(out.pad, 40, "content padding follows so nothing hides underneath");
  });

  await check("zoom is disabled for the viewport and the shell", async () => {
    const info = await page.evaluate(() => ({
      meta: document.querySelector('meta[name="viewport"]').getAttribute("content"),
      bodyTouch: getComputedStyle(document.body).touchAction,
      htmlTouch: getComputedStyle(document.documentElement).touchAction,
      overflowX: getComputedStyle(document.body).overflowX,
    }));
    assert.match(info.meta, /user-scalable=no/);
    assert.match(info.meta, /maximum-scale=1/);
    assert.equal(info.bodyTouch, "pan-y");
    assert.equal(info.htmlTouch, "pan-y");
    assert.equal(info.overflowX, "hidden");
  });

  await check("the import picker opens the Files app, not the photo sheet", async () => {
    const info = await page.evaluate(() => {
      const audio = document.getElementById("file-input");
      const any = document.getElementById("file-input-all");
      const lrcSource = document.querySelector('script[src="lyrics-sync.js"]');
      return {
        audioAccept: audio.hasAttribute("accept") ? audio.getAttribute("accept") : null,
        audioMultiple: audio.multiple,
        anyAccept: any.getAttribute("accept"),
        hasLyricsScript: !!lrcSource,
      };
    });
    assert.equal(info.audioAccept, null, "no accept attribute at all — any hint offers the photo sheet on iOS");
    assert.equal(info.audioMultiple, true, "multi-select still works");
    assert.equal(info.anyAccept, null, "the all-files input has no type filter either");
  });

  console.log("\nUp next, sorting, duplicates and backup");
  await check("the Up next sheet lists the queue and can reorder and remove", async () => {
    await seed(page, null);
    const ids = await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      const extra = [];
      for (const name of ["Second", "Third"]) {
        extra.push(await Lyra.db.addTrack({
          title: name, artist: base.artist, album: "", duration: 100,
          audio: base.audio, addedAt: Date.now() + extra.length + 1, plays: 0, liked: false, lyrics: "",
        }));
      }
      await Lyra.app.refreshData();
      await Lyra.player.playQueue([base.id, ...extra], 0);
      return [base.id, ...extra];
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById("np").classList.remove("hidden"));
    await page.click("#np-queue");
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() => ({
      rows: document.querySelectorAll("#sheet .q-row").length,
      title: (document.querySelector("#sheet .sheet-title") || {}).textContent || "",
      now: document.querySelectorAll("#sheet .q-row.now").length,
    }));
    assert.equal(opened.rows, 3, "one row per queued song");
    assert.match(opened.title, /Up next/);
    assert.equal(opened.now, 1, "the playing song is marked");

    await page.click('#sheet [data-q-down="0"]');
    await page.waitForTimeout(250);
    const moved = await page.evaluate(() => Lyra.player.state().queue.slice(0, 2));
    assert.deepEqual(moved, [ids[1], ids[0]], "moving down swaps the two songs");

    await page.click('#sheet [data-q-del="0"]');
    await page.waitForTimeout(300);
    const left = await page.evaluate(() => ({ len: Lyra.player.state().queue.length, rows: document.querySelectorAll("#sheet .q-row").length }));
    assert.equal(left.len, 2, "removing a row drops it from the queue");
    assert.equal(left.rows, 2, "the sheet redraws");
    await page.evaluate(() => {
      document.getElementById("sheet").classList.add("hidden");
      document.getElementById("backdrop").classList.add("hidden");
    });
    await closeNp(page);
  });

  await check("sorting by title orders the list and survives a reload", async () => {
    await page.evaluate(async () => {
      await Lyra.db.clearAll();
      const audio = Lyra.app.tracks[0] ? Lyra.app.tracks[0].audio : new Blob(["x"]);
      for (const name of ["Cedar", "Apple", "Birch"]) {
        await Lyra.db.addTrack({ title: name, artist: "Sort Artist", album: "", duration: 60, audio, addedAt: Math.random() * 1000, plays: 0 });
      }
      await Lyra.app.refreshData();
      Lyra.app.go("library");
    });
    await page.waitForTimeout(300);
    await page.click("#lib-sort");
    await page.waitForTimeout(250);
    await page.click('#sheet [data-sort="title"]');
    await page.waitForTimeout(400);
    const sorted = await page.evaluate(() => ({
      first: document.querySelector("#lib-body .song-title").textContent,
      label: document.getElementById("lib-sort").textContent.trim(),
      saved: null,
    }));
    assert.equal(sorted.first, "Apple", "title order starts at A");
    assert.match(sorted.label, /Title A–Z/);
    const saved = await page.evaluate(() => Lyra.db.getSetting("libSort"));
    assert.equal(saved, "title", "the choice is remembered");
  });

  await check("a duplicate import is caught before it is added", async () => {
    const res = await page.evaluate(async () => {
      await Lyra.db.clearAll();
      await Lyra.app.refreshData();
      const sr = 8000, secs = 1, frames = sr * secs;
      const buf = new ArrayBuffer(44 + frames * 2);
      const dv = new DataView(buf);
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, "RIFF"); dv.setUint32(4, 36 + frames * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
      dv.setUint16(34, 16, true); ws(36, "data"); dv.setUint32(40, frames * 2, true);
      const file = new File([buf], "Duplicate Test.wav", { type: "audio/wav" });

      await Lyra.app.importFiles([file]);
      await new Promise((r) => setTimeout(r, 900));
      const afterFirst = Lyra.app.tracks.length;
      Lyra.app.importFiles([file]);
      await new Promise((r) => setTimeout(r, 1200));
      const title = (document.querySelector("#sheet .sheet-title") || {}).textContent || "";
      const skip = document.getElementById("dup-skip");
      if (skip) skip.click();
      await new Promise((r) => setTimeout(r, 900));
      return { afterFirst, afterSecond: Lyra.app.tracks.length, title };
    });
    assert.equal(res.afterFirst, 1, "the first import added the song");
    assert.match(res.title, /Already in your library/, "the second import asks first");
    assert.equal(res.afterSecond, 1, "skipping the duplicate adds nothing");
  });

  await check("without a recent backup the app offers a nudge", async () => {
    const label = await page.evaluate(async () => {
      await Lyra.app.go("settings");
      await new Promise((r) => setTimeout(r, 500));
      return document.getElementById("set-lastbackup").textContent;
    });
    assert.match(label, /Never|Last saved/);
  });

  await check("the backup carries edits and restores them onto a re-imported file", async () => {
    const out = await page.evaluate(async () => {
      const track = Lyra.app.tracks[0];
      track.artistManual = "Yfg Fatso";
      track.likeSet = true;
      track.liked = true;
      await Lyra.db.putTrack(track);
      await Lyra.app.refreshData();

      Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
      Object.defineProperty(navigator, "share", { value: async (d) => { window.__shared = d.files[0]; }, configurable: true });
      await Lyra.app.exportBackup();
      const text = await window.__shared.text();
      const data = JSON.parse(text);
      const saved = data.tracks[0];
      const lastBackup = await Lyra.db.getSetting("lastBackupAt");

      // Simulate a reinstall: nothing on the device, then the same file
      // imported again with its original tags.
      const audio = track.audio;
      await Lyra.db.clearAll();
      const id = await Lyra.db.addTrack({
        title: track.title, artist: track.artist, album: "", duration: track.duration,
        audio, addedAt: Date.now() + 9, plays: 0, liked: false, lyrics: "",
      });
      await Lyra.app.refreshData();
      const backup = new File([text], "lyra-backup.json", { type: "application/json" });
      await Lyra.app.restoreBackup(backup);
      const restored = await Lyra.db.getTrack(id);
      return {
        exportedManual: saved.artistManual,
        exportedSynced: "lyricsSynced" in saved,
        restoredManual: restored && restored.artistManual,
        restoredLiked: restored && restored.liked,
        lastBackup,
      };
    });
    assert.equal(out.exportedManual, "Yfg Fatso", "the edited artist is in the backup");
    assert.equal(out.exportedSynced, true, "synced lyrics are in the backup");
    assert.equal(out.restoredManual, "Yfg Fatso", "a re-imported file gets the edit back");
    assert.equal(out.restoredLiked, true, "likes come back too");
    assert.ok(out.lastBackup > 0, "the export is dated");
  });

  await check("swiping the mini player skips to the next song", async () => {
    const ids = await page.evaluate(async () => {
      await Lyra.db.clearAll();
      const base = new Blob(["x"], { type: "audio/wav" });
      const a = await Lyra.db.addTrack({ title: "Swipe A", artist: "S", album: "", duration: 90, audio: base, addedAt: 1, plays: 0 });
      const b = await Lyra.db.addTrack({ title: "Swipe B", artist: "S", album: "", duration: 90, audio: base, addedAt: 2, plays: 0 });
      await Lyra.app.refreshData();
      await Lyra.player.playQueue([a, b], 0);
      await new Promise((r) => setTimeout(r, 400));
      return { a, b };
    });
    const out = await page.evaluate(async () => {
      const mini = document.getElementById("mini");
      const r = mini.getBoundingClientRect();
      const y = Math.round(r.top + r.height / 2);
      const mk = (x) => new Touch({ identifier: 21, target: mini, clientX: x, clientY: y });
      const fire = (type, x, list) => mini.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: (list || []).map(mk), targetTouches: (list || []).map(mk), changedTouches: [mk(x)],
      }));
      fire("touchstart", 300, [300]);
      for (let i = 1; i <= 5; i++) { fire("touchmove", 300 - i * 15, [300 - i * 15]); await new Promise((res) => setTimeout(res, 12)); }
      fire("touchend", 225, []);
      await new Promise((res) => setTimeout(res, 700));
      return { id: Lyra.player.state().track.id, npHidden: document.getElementById("np").classList.contains("hidden") };
    });
    assert.equal(out.id, ids.b, "a left swipe moved to the next song");
    assert.equal(out.npHidden, true, "and it did not open Now Playing");
  });

  console.log("\nStorage");
  await check("the audio is stored apart from the track, so metadata saves never rewrite it", async () => {
    await seed(page, null);
    const info = await page.evaluate(async () => {
      const id = Lyra.app.tracks[0].id;
      const raw = await new Promise((resolve, reject) => {
        const req = indexedDB.open("lyra", 2);
        req.onsuccess = () => {
          const db = req.result;
          const g = db.transaction("tracks", "readonly").objectStore("tracks").get(id);
          g.onsuccess = () => resolve(g.result);
          g.onerror = () => reject(g.error);
        };
        req.onerror = () => reject(req.error);
      });
      const before = await Lyra.db.getTrack(id);
      await Lyra.db.saveMeta(id, { lyrics: "saved without touching the audio", plays: 7 });
      const after = await Lyra.db.getTrack(id);
      return {
        inline: Object.prototype.hasOwnProperty.call(raw, "audio"),
        inlineBytes: raw.audio ? raw.audio.size : 0,
        beforeBytes: before.audio ? before.audio.size : 0,
        afterBytes: after.audio ? after.audio.size : 0,
        afterType: after.audio ? after.audio.type : "",
        lyrics: after.lyrics,
        plays: after.plays,
      };
    });
    assert.equal(info.inline, false, "the track record carries no Blob anymore");
    assert.equal(info.inlineBytes, 0);
    assert.ok(info.beforeBytes > 0, "the audio is still there, in its own store");
    assert.equal(info.afterBytes, info.beforeBytes, "a lyric save leaves the audio untouched");
    assert.equal(info.afterType, "audio/wav");
    assert.equal(info.lyrics, "saved without touching the audio");
    assert.equal(info.plays, 7);
  });

  await check("saving metadata for a deleted song reports it, instead of a storage error", async () => {
    const out = await page.evaluate(async () => {
      try {
        await Lyra.db.saveMeta(987654, { lyrics: "gone" });
        return { ok: true };
      } catch (e) {
        return { ok: false, code: e.code || "", message: e.message };
      }
    });
    assert.equal(out.ok, false);
    assert.equal(out.code, "not-found");
    assert.match(out.message, /no longer in your library/);
  });

  await check("deleting a song removes its audio too", async () => {
    const out = await page.evaluate(async () => {
      const id = Lyra.app.tracks[0].id;
      await Lyra.db.deleteTrack(id);
      const rows = await new Promise((resolve, reject) => {
        const req = indexedDB.open("lyra", 2);
        req.onsuccess = () => {
          const db = req.result;
          const g = db.transaction("audio", "readonly").objectStore("audio").get(id);
          g.onsuccess = () => resolve(g.result || null);
          g.onerror = () => reject(g.error);
        };
        req.onerror = () => reject(req.error);
      });
      const track = await Lyra.db.getTrack(id);
      await Lyra.app.refreshData();
      return { audioRow: rows, track };
    });
    assert.equal(out.audioRow, null, "the stored audio goes with the song");
    assert.equal(out.track, undefined);
  });

  console.log("\nFive tabs");
  await check("five tabs fit, with Settings last, and the pill lines up with each", async () => {
    await page.evaluate(() => Lyra.app.go("library"));
    await page.waitForTimeout(200);
    const info = await page.evaluate(() => {
      const nav = document.getElementById("nav");
      const pill = document.getElementById("tab-pill");
      const tabs = [...nav.querySelectorAll(".nav-btn")];
      const navW = nav.getBoundingClientRect().width;
      return {
        count: tabs.length,
        labels: tabs.map((b) => b.querySelector("span").textContent),
        overflow: tabs.some((b) => b.scrollWidth > b.clientWidth + 1),
        pillW: Math.round(pill.getBoundingClientRect().width),
        expected: Math.round((navW - 10) / 5),
        lastTransform: tabs.length && pill.style.transform,
      };
    });
    assert.equal(info.count, 5, "five tabs");
    assert.deepEqual(info.labels, ["Home", "Search", "Library", "Import", "Settings"]);
    assert.equal(info.labels[4], "Settings", "Settings is to the right of Import");
    assert.equal(info.overflow, false, "no label is clipped");
    assert.ok(Math.abs(info.pillW - info.expected) <= 1, "pill is one fifth of the bar (" + info.pillW + " vs " + info.expected + ")");

    await page.click('.nav-btn[data-tab="settings"]');
    await page.waitForTimeout(300);
    const view = await page.evaluate(() => ({
      version: !!document.getElementById("set-version"),
      active: document.querySelector('.nav-btn[data-tab="settings"]').classList.contains("on"),
      transform: document.getElementById("tab-pill").style.transform,
    }));
    assert.equal(view.version, true, "the Settings tab opens Settings");
    assert.equal(view.active, true);
    assert.match(view.transform, /translateX\(400%\)/, "the pill sits on the fifth tab (" + view.transform + ")");
    await page.click('.nav-btn[data-tab="home"]');
    await page.waitForTimeout(200);
  });

  console.log("\nGroq upload body");
  await check("uploadFileFrom sends a sized File with a safe audio filename", async () => {
    const out = await page.evaluate(async () => {
      const bytes = new Uint8Array(2048).fill(7);
      const odd = new File([bytes], 'mix : "bad"/name', { type: "audio/mpeg" });
      const safe = await Lyra.lyricsSync.uploadFileFrom(odd);
      const unnamed = await Lyra.lyricsSync.uploadFileFrom(new Blob([bytes], { type: "audio/wav" }));
      const typed = await Lyra.lyricsSync.uploadFileFrom(new File([bytes], "song", { type: "audio/x-m4a" }));
      let emptyErr = null;
      try { await Lyra.lyricsSync.uploadFileFrom(new Blob([], { type: "audio/mpeg" })); }
      catch (e) { emptyErr = { code: e.code, message: e.message }; }
      return {
        safe: { name: safe.name, size: safe.size, type: safe.type, isFile: safe instanceof File },
        unnamed: { name: unnamed.name, type: unnamed.type },
        typed: { name: typed.name, type: typed.type },
        emptyErr,
      };
    });
    assert.equal(out.safe.isFile, true, "materialized as a File, not a lazy reference");
    assert.equal(out.safe.size, 2048, "full byte length is known up front");
    assert.equal(out.safe.type, "audio/mpeg");
    assert.doesNotMatch(out.safe.name, /["/:*?<>|]/, "filename sanitized: " + out.safe.name);
    assert.match(out.safe.name, /\.mp3$/, "keeps its extension");
    assert.match(out.unnamed.name, /\.wav$/);
    assert.equal(out.unnamed.type, "audio/wav");
    assert.match(out.typed.name, /\.m4a$/, "adds an extension from the MIME type");
    assert.equal(out.emptyErr.code, "empty-audio", "empty audio is reported clearly");
    assert.match(out.emptyErr.message, /empty|re-import/i);
  });

  await check("the multipart upload arrives complete, with every field and the whole file", async () => {
    const seen = { method: null, bytes: 0, parts: [], closed: false, fields: {} };
    const uploadServer = http.createServer((req, res) => {
      const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization,content-type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
      };
      if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const text = body.toString("latin1");
        seen.method = req.method;
        seen.bytes = body.length;
        const boundary = (req.headers["content-type"] || "").match(/boundary=(.+)$/);
        seen.hasBoundary = !!boundary;
        const b = boundary ? boundary[1] : "";
        const parts = text.split("--" + b).slice(1, -1);
        for (const part of parts) {
          const nameMatch = part.match(/name="([^"]+)"/);
          if (!nameMatch) continue;
          const value = part.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
          seen.parts.push(nameMatch[1]);
          seen.fields[nameMatch[1]] = nameMatch[1] === "file" ? value.length : value.trim();
        }
        seen.closed = /--\r\n$/.test(text);
        res.writeHead(200, Object.assign({ "Content-Type": "application/json" }, cors));
        res.end(JSON.stringify({ text: "fake", words: [], segments: [], language: "en" }));
      });
    });
    await new Promise((r) => uploadServer.listen(0, "127.0.0.1", r));
    const endpoint = `http://127.0.0.1:${uploadServer.address().port}/upload`;

    const result = await page.evaluate(async (endpoint) => {
      const bytes = new Uint8Array(9000);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
      const file = new File([bytes], "odd name: mix.mp3", { type: "audio/mpeg" });
      const out = await Lyra.lyricsSync.transcribeBlob(file, { key: "test-key", language: "en", endpoint });
      return { text: out.text, language: out.language };
    }, endpoint);

    await new Promise((r) => uploadServer.close(r));
    assert.equal(seen.method, "POST");
    assert.equal(seen.hasBoundary, true, "browser supplied a multipart boundary");
    assert.equal(seen.closed, true, "body ends with a closing boundary — no EOF truncation");
    assert.deepEqual(seen.parts.sort(), ["file", "language", "model", "response_format", "temperature", "timestamp_granularities[]", "timestamp_granularities[]"]);
    assert.equal(seen.fields.model, "whisper-large-v3");
    assert.equal(seen.fields.response_format, "verbose_json");
    assert.equal(seen.fields.temperature, "0");
    assert.equal(seen.fields.language, "en");
    assert.equal(seen.fields.file, 9000, "the complete file arrived, byte for byte");
    assert.equal(result.text, "fake", "a 200 reply is parsed as a transcript");
  });

  await check("a truncated multipart reply is retried once over fetch", async () => {
    let calls = 0;
    const uploadServer = http.createServer((req, res) => {
      const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization,content-type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
      };
      if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
      req.resume();
      req.on("end", () => {
        calls++;
        if (calls === 1) {
          res.writeHead(400, Object.assign({ "Content-Type": "application/json" }, cors));
          res.end(JSON.stringify({ error: { message: "multipart: NextPart: EOF" } }));
          return;
        }
        res.writeHead(200, Object.assign({ "Content-Type": "application/json" }, cors));
        res.end(JSON.stringify({ text: "retried fine", words: [], segments: [], language: "en" }));
      });
    });
    await new Promise((r) => uploadServer.listen(0, "127.0.0.1", r));
    const endpoint = `http://127.0.0.1:${uploadServer.address().port}/upload`;

    const out = await page.evaluate(async (endpoint) => {
      const file = new File([new Uint8Array(4096)], "retry.mp3", { type: "audio/mpeg" });
      const stages = [];
      const transcript = await Lyra.lyricsSync.transcribeBlob(file, {
        key: "k", language: "en", endpoint,
        onStage: (s) => stages.push(s),
      });
      return { text: transcript.text, stages };
    }, endpoint);

    await new Promise((r) => uploadServer.close(r));
    assert.equal(calls, 2, "one XHR attempt, then one fetch retry");
    assert.equal(out.text, "retried fine", "the retry's transcript is used");
    assert.ok(out.stages.includes("uploading"), "progress stages still reported");
  });

  await check("the Library header with Select stays pinned while the list scrolls", async () => {
    await seed(page, null);
    await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      for (let i = 0; i < 24; i++) {
        await Lyra.db.addTrack({
          title: "Pinned Row " + i, artist: "Fixture Artist", album: "", duration: 100,
          audio: base.audio, addedAt: Date.now() + i + 1, plays: 0, liked: false, lyrics: "",
        });
      }
      await Lyra.app.refreshData();
      Lyra.app.go("library");
    });
    await page.waitForTimeout(400);
    const out = await page.evaluate(async () => {
      const shell = document.getElementById("view");
      const btn = document.getElementById("lib-select");
      const restTop = btn.getBoundingClientRect().top;
      shell.scrollTop = 700;
      await new Promise((r) => setTimeout(r, 250));
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        restTop: Math.round(restTop),
        pinnedTop: Math.round(r.top),
        scrollTop: shell.scrollTop,
        onScreen: r.top >= 0 && r.bottom <= window.innerHeight,
        insideWidth: r.left >= 0 && r.right <= window.innerWidth,
        hit: hit ? (hit.id || hit.className || hit.tagName) : "nothing",
        inside: !!(hit && (hit === btn || btn.contains(hit))),
        label: btn.textContent,
      };
    });
    assert.ok(out.scrollTop > 600, "the list really scrolled (" + out.scrollTop + ")");
    assert.equal(out.onScreen, true, "Select is still on screen");
    assert.equal(out.insideWidth, true, "and fully on the screen sideways");
    assert.ok(out.pinnedTop < 140, "pinned near the top edge, got " + out.pinnedTop);
    assert.equal(out.inside, true, "a tap there lands on Select, got " + out.hit);
    assert.equal(out.label, "Select");
  });

  await check("skipping a song on a playlist page scrolls to the new row", async () => {
    await seed(page, null);
    await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      const ids = [base.id];
      for (let i = 0; i < 18; i++) {
        ids.push(await Lyra.db.addTrack({
          title: "Long Row " + i, artist: "Fixture Artist", album: "", duration: 100,
          audio: base.audio, addedAt: Date.now() + i + 1, plays: 0, liked: false, lyrics: "",
        }));
      }
      await Lyra.db.addPlaylist({ name: "Long List", trackIds: ids, createdAt: Date.now() });
      await Lyra.app.refreshData();
      const pl = Lyra.app.playlists.find((p) => p.name === "Long List");
      await Lyra.player.playQueue(ids, 0);
      Lyra.app.go("detail", { kind: "playlist", id: pl.id }, false);
    });
    await page.waitForTimeout(500);
    const out = await page.evaluate(async () => {
      const shell = document.getElementById("view");
      const before = shell.scrollTop;
      for (let i = 0; i < 16; i++) {
        await Lyra.player.next(true);
        await new Promise((r) => setTimeout(r, 180));
      }
      await new Promise((r) => setTimeout(r, 1000));
      const cur = Lyra.player.state().track;
      const row = document.querySelector(`#detail-rows [data-play-track="${cur.id}"]`);
      const r = row.getBoundingClientRect();
      return {
        before, after: shell.scrollTop, title: cur.title,
        rowTop: Math.round(r.top), rowBottom: Math.round(r.bottom), vh: window.innerHeight,
        marked: [...document.querySelectorAll("#detail-rows .song-title.playing")].map((n) => n.textContent),
        rows: document.querySelectorAll("#detail-rows .song-row").length,
      };
    });
    assert.equal(out.before, 0, "the page started at the top");
    assert.ok(out.rows >= 19, "the playlist page is long: " + out.rows);
    assert.ok(out.after > 80, "it scrolled down to the playing row (0 -> " + Math.round(out.after) + ")");
    assert.ok(out.rowTop >= 0 && out.rowBottom <= out.vh,
      "the row is on screen (" + out.rowTop + "-" + out.rowBottom + " of " + out.vh + ")");
    assert.deepEqual(out.marked, [out.title], "and it is the marked row");
  });

  console.log("\nNever played, mini drag and back swipe");
  await check("a song that merely started leaves 'Never played'", async () => {
    await seed(page, null);
    const ids = await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      const untouched = await Lyra.db.addTrack({
        title: "Untouched", artist: "Fixture Artist", album: "", duration: 90,
        audio: base.audio, addedAt: Date.now() + 5, plays: 0, liked: false, lyrics: "",
      });
      await Lyra.app.refreshData();
      return { started: base.id, untouched };
    });
    const before = await page.evaluate(() => Lyra.app._test
      .detailData({ kind: "browse", name: "never" }).list.map((t) => t.title).sort());
    assert.equal(before.length, 2, "both unplayed songs are listed: " + before);

    await page.evaluate((id) => Lyra.player.playQueue([id], 0), ids.started);
    await page.waitForTimeout(800);
    const after = await page.evaluate(async (id) => {
      const stored = await Lyra.db.getTrack(id);
      const local = Lyra.app.tracks.find((t) => t.id === id);
      return {
        never: Lyra.app._test.detailData({ kind: "browse", name: "never" }).list.map((t) => t.title),
        plays: stored.plays,
        storedAt: stored.lastPlayedAt || 0,
        localAt: local.lastPlayedAt || 0,
      };
    }, ids.started);
    assert.deepEqual(after.never, ["Untouched"], "the song you started dropped out, the untouched one stayed");
    assert.equal(after.plays, 0, "without waiting for the 30-second play count");
    assert.ok(after.storedAt > 0, "the start time is saved on the song");
    assert.equal(after.localAt, after.storedAt, "and the app's copy knows about it");
  });

  await check("dragging the mini player up grows it and opens Now Playing", async () => {
    await seed(page, null);
    await page.evaluate(async () => {
      await Lyra.player.playQueue([Lyra.app.tracks[0].id], 0);
      await new Promise((r) => setTimeout(r, 400));
    });
    await page.waitForTimeout(300);

    const pull = (toLift) => page.evaluate(async (toLift) => {
      const mini = document.getElementById("mini");
      const r = mini.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const mk = (cy) => new Touch({ identifier: 31, target: mini, clientX: x, clientY: cy });
      const fire = (type, cy, list) => mini.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: (list || []).map(mk), targetTouches: (list || []).map(mk), changedTouches: [mk(cy)],
      }));
      fire("touchstart", y, [y]);
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const cy = Math.round(y - (toLift * i) / steps);
        fire("touchmove", cy, [cy]);
        await new Promise((res) => setTimeout(res, 16));
      }
      const during = { transform: mini.style.transform, dragging: mini.classList.contains("dragging") };
      fire("touchend", y - toLift, []);
      await new Promise((res) => setTimeout(res, 500));
      return {
        during,
        after: mini.style.transform,
        dragging: mini.classList.contains("dragging"),
        np: !document.getElementById("np").classList.contains("hidden"),
      };
    }, toLift);

    const small = await pull(50);
    assert.equal(small.during.dragging, true, "the player follows the finger");
    assert.match(small.during.transform, /translateY\(-/, "it lifts (" + small.during.transform + ")");
    assert.match(small.during.transform, /scale\(1\.[1-9]/, "and grows (" + small.during.transform + ")");
    assert.equal(small.after, "", "a short pull springs back");
    assert.equal(small.np, false, "Now Playing stays closed");

    const big = await pull(130);
    assert.match(big.during.transform, /scale\(1\.[2-9]/, "a full pull grows it further (" + big.during.transform + ")");
    assert.equal(big.np, true, "letting go past the mark opens Now Playing");
    await closeNp(page);
  });

  await check("the back gesture stays inside the app instead of leaving", async () => {
    await seed(page, null);
    await page.evaluate(() => Lyra.app.go("library"));
    await page.waitForTimeout(250);
    const before = page.url();
    await page.evaluate(async () => {
      history.back();
      await new Promise((r) => setTimeout(r, 400));
    });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      url: location.href,
      alive: !!(window.Lyra && Lyra.app && Lyra.app.tracks),
      shown: [...document.querySelectorAll(".screen-host")].filter((h) => !h.hidden).map((h) => h.dataset.screen),
    }));
    assert.equal(after.url, before, "the page did not navigate away");
    assert.equal(after.alive, true, "the app is still running");
    assert.deepEqual(after.shown, ["library"], "and still on the same screen");

    await page.evaluate(() => Lyra.app.go("detail", { kind: "artist", name: "Fixture Artist" }, false));
    await page.waitForTimeout(250);
    await page.evaluate(async () => {
      history.back();
      await new Promise((r) => setTimeout(r, 400));
    });
    await page.waitForTimeout(250);
    const backed = await page.evaluate(() => ({
      url: location.href,
      shown: [...document.querySelectorAll(".screen-host")].filter((h) => !h.hidden).map((h) => h.dataset.screen),
    }));
    assert.equal(backed.url, before, "still no navigation away from the app");
    assert.equal(backed.shown.includes("detail"), false, "a swipe on a song page steps back a screen");
  });

  console.log("\nMotion");
  await check("a press ripples from the finger and still plays the row", async () => {
    await seed(page, null);
    await page.waitForTimeout(350);
    const box = await page.locator("#lib-body .song-row").first().boundingBox();
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(70);
    const mid = await page.evaluate(() => {
      const r = document.querySelector("#lib-body .song-row");
      return {
        rippling: r.classList.contains("rippling"),
        rx: r.style.getPropertyValue("--rx"),
        ry: r.style.getPropertyValue("--ry"),
      };
    });
    assert.equal(mid.rippling, true, "the press starts a ripple");
    assert.match(mid.rx, /^[\d.]+%$/, "it starts at the finger, horizontally (" + mid.rx + ")");
    assert.match(mid.ry, /^[\d.]+%$/, "and vertically (" + mid.ry + ")");
    await page.mouse.up();
    await page.waitForTimeout(750);
    const after = await page.evaluate(() => {
      const r = document.querySelector("#lib-body .song-row");
      return {
        rippling: r.classList.contains("rippling"),
        playing: Lyra.player.state().playing,
        current: Lyra.player.state().track && Lyra.player.state().track.id,
      };
    });
    assert.equal(after.rippling, false, "the ripple clears itself");
    assert.equal(after.playing, true, "and the tap still played the song");
    assert.ok(after.current, "a track is loaded");
  });

  await check("a fresh screen fades in and its rows arrive one after another", async () => {
    await seed(page, null);
    await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      for (let i = 0; i < 8; i++) {
        await Lyra.db.addTrack({
          title: "Motion " + i, artist: "Motion Artist", album: "", duration: 100,
          audio: base.audio, addedAt: Date.now() + i + 1, plays: 0, liked: false, lyrics: "",
        });
      }
      await Lyra.app.refreshData();
      Lyra.app.go("library");
    });
    await page.waitForTimeout(50);
    const early = await page.evaluate(() => {
      const host = document.querySelector('.screen-host[data-screen="library"]');
      const rows = [...host.querySelectorAll("#lib-body .song-row")];
      return {
        host: host.getAnimations().map((a) => a.animationName),
        row: rows[0].getAnimations().map((a) => a.animationName),
        delays: rows.slice(0, 3).map((r) => {
          const a = r.getAnimations()[0];
          return a ? Math.round(a.effect.getTiming().delay) : null;
        }),
        count: rows.length,
      };
    });
    assert.ok(early.host.includes("screen-fade"), "the screen crossfades in (" + early.host + ")");
    assert.deepEqual(early.row, ["row-rise"], "its rows rise");
    assert.ok(early.count >= 8, "enough rows to see it");
    assert.deepEqual(early.delays, [0, 18, 36], "each row waits a beat longer than the one above");
    await page.waitForTimeout(700);
    const settled = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#lib-body .song-row")];
      return {
        anims: rows.reduce((n, r) => n + r.getAnimations().length, 0),
        opacity: getComputedStyle(rows[0]).opacity,
        transform: getComputedStyle(rows[0]).transform,
      };
    });
    assert.equal(settled.anims, 0, "nothing keeps animating");
    assert.equal(settled.opacity, "1", "rows end fully opaque");
    assert.equal(settled.transform, "none", "and back in place");
  });

  await check("holding a song row opens its menu without playing it", async () => {
    await seed(page, null);
    await page.waitForTimeout(350);
    const before = await page.evaluate(() => (Lyra.player.state().track ? Lyra.player.state().track.id : null));
    const box = await page.locator("#lib-body .song-row").first().boundingBox();
    await page.mouse.move(box.x + 100, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(760);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({
      sheetOpen: !document.getElementById("sheet").classList.contains("hidden"),
      text: document.getElementById("sheet").innerText.replace(/\s+/g, " ").slice(0, 90),
      now: Lyra.player.state().track ? Lyra.player.state().track.id : null,
    }));
    assert.equal(st.sheetOpen, true, "the row menu opens: " + st.text);
    assert.equal(st.now, before, "and the hold did not start playback");
    await page.evaluate(() => {
      document.getElementById("sheet").classList.add("hidden");
      document.getElementById("backdrop").classList.add("hidden");
    });
  });

  await check("the tab icon pops on landing and a like beats once", async () => {
    await seed(page, null);
    await page.click('.nav-btn[data-tab="search"]');
    await page.waitForTimeout(60);
    const pop = await page.evaluate(() => {
      const svg = document.querySelector('.nav-btn[data-tab="search"].on svg');
      return svg ? svg.getAnimations().map((a) => a.animationName) : [];
    });
    assert.ok(pop.includes("tab-pop"), "the icon pops when you land on a tab (" + pop + ")");

    await page.evaluate(() => Lyra.player.playQueue([Lyra.app.tracks[0].id], 0));
    await page.waitForTimeout(250);
    await page.click("#mini-like");
    await page.waitForTimeout(60);
    const heart = await page.evaluate(() => ({
      liked: document.getElementById("mini-like").classList.contains("liked"),
      anims: [...document.querySelectorAll("#mini-like svg")].flatMap((s) => s.getAnimations().map((a) => a.animationName)),
    }));
    assert.equal(heart.liked, true, "the song is liked");
    assert.ok(heart.anims.includes("heart-pop"), "the heart beats once (" + heart.anims + ")");
  });

  await check("reduced motion switches every new animation off", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page, null);
    await page.evaluate(async () => {
      const base = Lyra.app.tracks[0];
      await Lyra.db.addTrack({
        title: "Calm", artist: "Motion Artist", album: "", duration: 100,
        audio: base.audio, addedAt: Date.now() + 1, plays: 0, liked: false, lyrics: "",
      });
      await Lyra.app.refreshData();
      Lyra.app.go("library");
    });
    await page.waitForTimeout(60);
    const out = await page.evaluate(() => {
      const host = document.querySelector('.screen-host[data-screen="library"]');
      const row = host.querySelector("#lib-body .song-row");
      const durs = (el) => el.getAnimations().map((a) => a.effect.getTiming().duration);
      return { host: durs(host), row: durs(row), transition: getComputedStyle(row).transitionProperty };
    });
    assert.ok(out.row.every((d) => d <= 1), "rows do not ease: " + out.row);
    assert.ok(out.host.every((d) => d <= 1), "screens do not fade: " + out.host);
    assert.equal(out.transition, "none", "and transitions are off too");
    await page.emulateMedia({ reducedMotion: "no-preference" });
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
