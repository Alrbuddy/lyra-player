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
    for (const t of ["search", "library", "import", "home"]) {
      await page.click(`.nav-btn[data-tab="${t}"]`);
      await page.waitForTimeout(140);
      const view = await page.evaluate(() => document.querySelector("#view").innerHTML.length);
      assert.ok(view > 100, t + " rendered");
    }
    assert.equal(await page.evaluate(() => window.__vt), 0, "no view-transition snapshots");
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
    await page.evaluate(() => { document.querySelector("#view").scrollTop = 420; });
    await page.waitForTimeout(80);
    await page.click('.nav-btn[data-tab="home"]');
    await page.waitForTimeout(600);
    const top = await page.evaluate(() => document.querySelector("#view").scrollTop);
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
