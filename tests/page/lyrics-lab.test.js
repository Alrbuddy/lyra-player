/* Headless page tests for Lyrics Lab (beta).
 * iPhone viewport 390x844, app served from a /Lyra/ subfolder like GitHub Pages.
 * Run: node tests/page/lyrics-lab.test.js
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

const pause = (page, ms) => page.waitForTimeout(ms);

async function activeIndex(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".llab-line.now");
    return el ? Number(el.dataset.i) : -1;
  });
}

async function seekTo(page, t, { play = false } = {}) {
  await page.evaluate(({ t, play }) => {
    const a = Lyra.player.audio;
    a.currentTime = t;
    if (play) a.play().catch(() => {});
    else a.pause();
  }, { t, play });
  await page.waitForTimeout(160);
}

async function seed(page, keepSettings) {
  return page.evaluate(async (keepSettings) => {
    if (keepSettings) {
      const all = await Lyra.db.getAllTracks();
      for (const t of all) await Lyra.db.deleteTrack(t.id);
    } else {
      await Lyra.db.clearAll();
    }
    // 8s mono 16 kHz WAV, quiet tone
    const sr = 16000;
    const secs = 20;
    const frames = sr * secs;
    const buf = new ArrayBuffer(44 + frames * 2);
    const dv = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); dv.setUint32(4, 36 + frames * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true); ws(36, "data"); dv.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) dv.setInt16(44 + i * 2, Math.round(Math.sin(i / 14) * 160), true);
    const blob = new Blob([buf], { type: "audio/wav" });

    // 12 lines, 1.4s apart, so the lyrics box is taller than the viewport.
    const spec = [
      ["One", "two", "three"], ["Four", "five", "six"], ["Seven", "eight", "nine"], ["Ten", "eleven", "twelve"],
      ["Alpha", "beta", "gamma"], ["Delta", "echo", "foxtrot"], ["Golf", "hotel", "india"], ["Juliet", "kilo", "lima"],
      ["Mike", "november", "oscar"], ["Papa", "quebec", "romeo"], ["Sierra", "tango", "uniform"], ["Victor", "whiskey", "xray"],
    ];
    const lines = spec.map((ws, i) => {
      const t = 0.2 + i * 1.4;
      return {
        t, end: t + 1.2, text: ws.join(" "),
        words: ws.map((w, j) => ({ text: w, t: t + j * 0.4, e: t + j * 0.4 + 0.35, p: i === 1 && j === 1 ? 0.35 : 0.9 })),
      };
    });

    const id = await Lyra.db.addTrack({
      title: "Fixture Song",
      artist: "Test Artist",
      album: "Test Album",
      duration: secs,
      audio: blob,
      createdAt: Date.now(),
      plays: 0,
      lyrics: lines.map((l) => l.text).join("\n"),
      lyricsSynced: { lines, matchRate: 1, source: "fixture", createdAt: Date.now() },
    });
    await Lyra.app.refreshData();
    return id;
  }, !!keepSettings);
}

/** A mono 16 kHz WAV of a quiet tone, long enough to need several chunks. */
async function addLongTrack(page, secs) {
  return page.evaluate(async (secs) => {
    const sr = 16000;
    const frames = sr * secs;
    const buf = new ArrayBuffer(44 + frames * 2);
    const dv = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); dv.setUint32(4, 36 + frames * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true); ws(36, "data"); dv.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) dv.setInt16(44 + i * 2, Math.round(Math.sin(i / 14) * 400), true);
    const id = await Lyra.db.addTrack({
      title: "Chunk Fixture", artist: "Test Artist", album: "Test Album",
      duration: secs, audio: new Blob([buf], { type: "audio/wav" }),
      createdAt: Date.now(), plays: 0, lyrics: "",
    });
    await Lyra.app.refreshData();
    return id;
  }, secs);
}

async function openNowPlaying(page) {
  await page.evaluate(async () => {
    const id = Lyra.app.tracks[0].id;
    await Lyra.player.playQueue([id], 0);
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById("mini").click());
  await page.waitForTimeout(250);
}

async function openLyrics(page) {
  await openNowPlaying(page);
  await page.evaluate(() => document.getElementById("np-lyrics-card").click());
  await page.waitForTimeout(350);
}

async function gotoView(page, view) {
  await page.evaluate((v) => Lyra.app.go(v, {}, false), view);
  await page.waitForTimeout(220);
}

/** Close the lyrics view and Now Playing sheet so page chrome is clickable again. */
async function closeOverlays(page) {
  await page.evaluate(() => {
    const lyr = document.getElementById("lyrics");
    if (lyr && !lyr.classList.contains("hidden")) document.getElementById("lyrics-close").click();
    const np = document.getElementById("np");
    if (np && !np.classList.contains("hidden")) document.getElementById("np-close").click();
  });
  await page.waitForTimeout(300);
}

(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}${PREFIX}/`;

  let browser;
  try {
    browser = await chromium.launch({
      channel: "msedge",
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
  } catch (e) {
    console.log("msedge unavailable, falling back to bundled chromium: " + e.message.split("\n")[0]);
    browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  }

  const context = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: "block" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });

  console.log("\nServing " + base + " at " + VIEWPORT.width + "x" + VIEWPORT.height + "\n");

  await page.goto(base, { waitUntil: "load" });
  await page.waitForTimeout(500);
  await seed(page);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(500);

  console.log("Beta OFF (default)");
  await check("beta is off after a fresh install", async () => {
    await gotoView(page, "settings");
    await pause(page, 300);
    const state = await page.evaluate(async () => ({
      setting: await Lyra.db.getSetting("llab.enabled"),
      card: !!document.getElementById("llab-card"),
      checked: document.getElementById("llab-enabled")?.checked,
      extraHidden: document.getElementById("llab-extra")?.classList.contains("hidden"),
    }));
    assert.equal(state.setting ?? false, false);
    assert.equal(state.card, true, "the Settings switch must exist so it can be turned on");
    assert.equal(state.checked, false);
    assert.equal(state.extraHidden, true);
  });

  await check("no Lyrics Lab UI anywhere with beta off", async () => {
    await openNowPlaying(page);
    const np = await page.evaluate(() => !!document.getElementById("llab-np"));
    assert.equal(np, false, "Now Playing must not get the actions row");
    await page.evaluate(() => document.getElementById("np-lyrics-card").click());
    await page.waitForTimeout(300);
    const lyrics = await page.evaluate(() => ({
      bar: !!document.getElementById("llab-bar"),
      lines: document.querySelectorAll(".llab-line").length,
      cls: document.getElementById("lyrics-text").className,
      text: document.getElementById("lyrics-text").textContent.trim(),
    }));
    assert.equal(lyrics.bar, false);
    assert.equal(lyrics.lines, 0);
    assert.equal(lyrics.cls, "lyrics-text");
    assert.match(lyrics.text, /One two three/);
    await closeOverlays(page);
  });

  console.log("\nBeta ON");
  await check("Settings switch turns the Lab on and stores the key on-device", async () => {
    await gotoView(page, "settings");
    await page.click("#llab-enabled");
    await page.waitForTimeout(300);
    const on = await page.evaluate(() => ({
      extraHidden: document.getElementById("llab-extra").classList.contains("hidden"),
      note: document.querySelector(".llab-note")?.textContent || "",
      lang: document.getElementById("llab-lang")?.value,
    }));
    assert.equal(on.extraHidden, false);
    assert.match(on.note, /Uploads this song's audio to Groq/);
    assert.equal(on.lang, "en", "language defaults to English");
    await page.fill("#llab-key", "gsk_test_key_value");
    await page.evaluate(() => document.getElementById("llab-key").dispatchEvent(new Event("change")));
    await page.waitForTimeout(200);
    const stored = await page.evaluate(() => Lyra.db.getSetting("llab.groqKey"));
    assert.equal(stored, "gsk_test_key_value");
  });

  await check("Now Playing shows the four Lyrics Lab actions", async () => {
    await openNowPlaying(page);
    const ids = await page.evaluate(() => ["llab-auto", "llab-align", "llab-import", "llab-export"]
      .map((id) => !!document.getElementById(id)));
    assert.deepEqual(ids, [true, true, true, true]);
  });

  await check("Sync my lyrics explains what it needs instead of sitting grey", async () => {
    const info = await page.evaluate(() => {
      const align = document.getElementById("llab-align");
      const tip = document.getElementById("llab-tip");
      return {
        disabled: align.disabled,
        title: align.title,
        tip: tip ? tip.textContent : "",
        trackHasWords: !!(Lyra.player.state().track.lyricsWords || []).length,
      };
    });
    assert.equal(info.trackHasWords, false, "fixture has no transcript yet");
    assert.equal(info.disabled, true);
    assert.match(info.title, /Auto-sync/i, "disabled reason: " + info.title);
    assert.match(info.tip, /Auto-sync transcribes/i, "tip text: " + info.tip);
  });

  await check("auto-sync turns the transcript into synced lyrics when there are none", async () => {
    await page.route("https://api.groq.com/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        text: "hello there again now",
        language: "en",
        words: [
          { word: "hello", start: 0.2, end: 0.6 },
          { word: "there", start: 0.6, end: 1.0 },
          { word: "again", start: 2.4, end: 2.8 },
          { word: "now", start: 2.8, end: 3.2 },
        ],
        segments: [],
      }),
    }));
    // Start from a song with no lyrics of its own, like a fresh download —
    // keeping the fixture so the later lyrics-view checks still have 12 lines.
    const original = await page.evaluate(async () => {
      const t = await Lyra.db.getTrack(Lyra.player.state().track.id);
      const saved = { lyrics: t.lyrics, synced: t.lyricsSynced };
      t.lyrics = "";
      t.lyricsSynced = null;
      t.lyricsWords = null;
      await Lyra.db.putTrack(t);
      await Lyra.app.refreshData();
      return saved;
    });
    await page.evaluate(() => document.getElementById("llab-auto").click());
    await page.waitForFunction(() => /words saved/.test((document.getElementById("llab-status") || {}).textContent || ""), null, { timeout: 15000 });
    const out = await page.evaluate(async () => {
      const t = await Lyra.db.getTrack(Lyra.player.state().track.id);
      return {
        lyrics: t.lyrics,
        lines: ((t.lyricsSynced || {}).lines || []).length,
        source: (t.lyricsSynced || {}).source,
        status: document.getElementById("llab-status").textContent,
        alignEnabled: !document.getElementById("llab-align").disabled,
      };
    });
    assert.match(out.status, /lyrics synced/);
    assert.match(out.lyrics, /hello there/);
    assert.ok(out.lines >= 2, "a pause splits the lines, got " + out.lines);
    assert.equal(out.source, "transcript");
    assert.equal(out.alignEnabled, true, "Sync my lyrics is usable once words exist");
    await page.unroute("https://api.groq.com/**");
    await page.evaluate(async (saved) => {
      const t = await Lyra.db.getTrack(Lyra.player.state().track.id);
      t.lyrics = saved.lyrics;
      t.lyricsSynced = saved.synced;
      t.lyricsWords = null;
      await Lyra.db.putTrack(t);
      await Lyra.app.refreshData();
    }, original);
  });

  await check("a long song is sent as overlapping chunks and lands on the song's clock", async () => {
    const id = await addLongTrack(page, 60);
    let calls = 0;
    await page.route("https://api.groq.com/**", (route) => {
      calls++;
      const local = [
        { word: "part" + calls, start: 1.5, end: 2.0 },
        { word: "line" + calls, start: 5.0, end: 5.6 },
      ];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          text: local.map((w) => w.word).join(" "),
          language: "en",
          words: local,
          segments: [{ start: 1, end: 6, avg_logprob: -0.2, compression_ratio: 1.4 }],
        }),
      });
    });
    await page.evaluate(async (trackId) => {
      await Lyra.player.playQueue([trackId], 0);
      document.getElementById("mini").click();
    }, id);
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById("llab-auto").click());
    await page.waitForFunction(() => /words saved/.test((document.getElementById("llab-status") || {}).textContent || ""), null, { timeout: 30000 });
    const out = await page.evaluate(async (trackId) => {
      const t = await Lyra.db.getTrack(trackId);
      return {
        words: (t.lyricsWords || []).map((w) => ({ word: w.word, start: Math.round(w.start * 10) / 10 })),
        status: document.getElementById("llab-status").textContent,
      };
    }, id);
    assert.equal(calls, 3, "60 s at 25 s + 3 s overlap is three uploads, got " + calls);
    assert.equal(out.words.length, 6, "two words per chunk survive the stitch");
    assert.deepEqual(out.words.map((w) => w.start), [1.5, 5, 26.5, 30, 51.5, 55], "each chunk is shifted by its own start");
    for (let i = 1; i < out.words.length; i++) {
      assert.ok(out.words[i].start > out.words[i - 1].start, "times stay monotonic");
    }
    assert.match(out.status, /3 chunks/, "status reports the chunks: " + out.status);
    await page.unroute("https://api.groq.com/**");
    await page.evaluate(async (trackId) => {
      await Lyra.db.deleteTrack(trackId);
      await Lyra.app.refreshData();
      await Lyra.player.playQueue([Lyra.app.tracks[0].id], 0);
    }, id);
    await page.waitForTimeout(250);
  });

  await check("a looped chunk is re-sent instead of being kept", async () => {
    let calls = 0;
    await page.route("https://api.groq.com/**", (route) => {
      calls++;
      const looped = calls === 1;
      const payload = looped ? {
        text: "loopy loopy loopy",
        language: "en",
        words: [1, 2, 3].map((i) => ({ word: "loopy", start: i, end: i + 0.4 })),
        segments: [{ start: 0, end: 8, avg_logprob: -0.4, compression_ratio: 3.1, no_speech_prob: 0.1 }],
      } : {
        text: "clean words",
        language: "en",
        words: [{ word: "clean", start: 1, end: 1.4 }, { word: "words", start: 1.6, end: 2 }],
        segments: [{ start: 1, end: 2, avg_logprob: -0.2, compression_ratio: 1.3, no_speech_prob: 0.1 }],
      };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    });
    const out = await page.evaluate(async () => {
      const track = Lyra.app.tracks[0];
      const res = await Lyra.lyricsSync.transcribeAudio(track.audio, { key: "k", language: "en", chunkSeconds: 6, overlap: 2 });
      return { words: res.words.map((w) => w.word), retried: res.retried, chunks: res.chunks };
    });
    assert.equal(out.chunks, 3, "20 s at 6 s + 2 s is three chunks, got " + out.chunks);
    assert.equal(out.retried, 1, "the looped chunk was sent again");
    assert.equal(calls, 4, "three chunks plus one re-check, got " + calls);
    assert.equal(out.words.includes("loopy"), false, "the loop was replaced: " + out.words.join(" "));
    assert.ok(out.words.filter((w) => w === "clean").length >= 2, "the clean decode is kept");
    await page.unroute("https://api.groq.com/**");
  });

  await check("lyrics view gets the toolbar and timed lines", async () => {
    await openLyrics(page);
    const info = await page.evaluate(() => ({
      bar: !!document.getElementById("llab-bar"),
      lines: document.querySelectorAll(".llab-line").length,
      words: document.querySelectorAll(".llab-word").length,
      followHidden: document.getElementById("llab-follow").classList.contains("hidden"),
      active: document.querySelectorAll(".llab-line.now").length,
    }));
    assert.equal(info.bar, true);
    assert.equal(info.lines, 12);
    assert.equal(info.words, 0, "line mode by default");
    assert.equal(info.followHidden, false, "follow is off by default, so the Follow pill shows");
    assert.equal(info.active, 1);
  });

  await check("active line follows a seek", async () => {
    await seekTo(page, 0.5);
    assert.equal(await activeIndex(page), 0);
    await seekTo(page, 2.0);
    assert.equal(await activeIndex(page), 1);
    await seekTo(page, 12.9);
    assert.equal(await activeIndex(page), 9);
  });

  await check("active line advances as audio time advances", async () => {
    await seekTo(page, 0.1, { play: true });
    const start = await activeIndex(page);
    let seen = start;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await pause(page, 150);
      const idx = await activeIndex(page);
      if (idx > seen) seen = idx;
      if (seen >= 1) break;
    }
    await page.evaluate(() => Lyra.player.audio.pause());
    assert.equal(start, 0);
    assert.ok(seen >= 1, "active line should advance during playback (saw " + seen + ")");
  });

  await check("word mode fills words in order, with karaoke fill", async () => {
    await page.click('#llab-bar [data-mode="word"]');
    await page.waitForTimeout(200);
    await seekTo(page, 1.65);
    const atStart = await page.evaluate(() => {
      const line = document.querySelector('.llab-line[data-i="1"]');
      return {
        words: line.querySelectorAll(".llab-word").length,
        on: line.querySelectorAll(".llab-word.on").length,
        cur: line.querySelectorAll(".llab-word.cur").length,
        curText: line.querySelector(".llab-word.cur")?.textContent,
        fill: line.querySelector(".llab-word.cur")?.style.getPropertyValue("--fill"),
        low: document.querySelectorAll(".llab-word.low").length,
      };
    });
    assert.equal(atStart.words, 3);
    assert.equal(atStart.cur, 1);
    assert.equal(atStart.curText, "Four");
    assert.match(atStart.fill, /%$/);
    assert.equal(atStart.low, 1, "the low-probability word is underlined");

    await seekTo(page, 2.9);
    const later = await page.evaluate(() => {
      const line = document.querySelector('.llab-line[data-i="1"]');
      return {
        on: line.querySelectorAll(".llab-word.on").length,
        curText: line.querySelector(".llab-word.cur")?.textContent,
      };
    });
    assert.ok(later.on >= 1, "earlier words stay filled (saw " + later.on + ")");
    assert.notEqual(later.curText, "Four");
  });

  await check("word mode dims the line so each word can light up in turn", async () => {
    await seekTo(page, 2.2);
    const colours = await page.evaluate(() => {
      const box = document.getElementById("lyrics-text");
      const line = document.querySelector('.llab-line[data-i="1"]');
      const sung = line.querySelector(".llab-word.on");
      const waiting = line.querySelector(".llab-word:not(.on):not(.cur)");
      return {
        cls: box.className,
        line: getComputedStyle(line).color,
        sung: sung ? getComputedStyle(sung).color : "",
        waiting: waiting ? getComputedStyle(waiting).color : "",
      };
    });
    assert.match(colours.cls, /word-mode/, "the lyrics box knows it is in word mode");
    assert.match(colours.line, /rgba\(255, 255, 255, 0\.3\d\)/, "the active line itself stays dim");
    assert.equal(colours.sung, "rgb(255, 255, 255)", "a sung word is white");
    assert.match(colours.waiting, /rgba\(255, 255, 255, 0\.3\d\)/, "an unsung word is not");
    assert.notEqual(colours.sung, colours.waiting, "word mode must look different from line mode");
  });

  await check("follow keeps the active line about 40% from the top", async () => {
    await page.click("#llab-auto-scroll");
    await page.waitForTimeout(200);
    await seekTo(page, 10.0);
    await pause(page, 1400);
    const ratio = await page.evaluate(() => {
      const sc = document.getElementById("lyrics-scroll");
      const line = document.querySelector(".llab-line.now");
      const scRect = sc.getBoundingClientRect();
      const lRect = line.getBoundingClientRect();
      return (lRect.top - scRect.top) / sc.clientHeight;
    });
    assert.ok(ratio > 0.2 && ratio < 0.6, "active line at " + ratio.toFixed(2) + " of the viewport");
  });

  await check("manual scrolling turns follow off and shows Follow", async () => {
    const box = await page.locator("#lyrics-scroll").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 420);
    await pause(page, 350);
    const after = await page.evaluate(() => ({
      followVisible: !document.getElementById("llab-follow").classList.contains("hidden"),
      chipOn: document.getElementById("llab-auto-scroll").classList.contains("on"),
      state: Lyra.lyricsSync._state().follow,
    }));
    assert.equal(after.followVisible, true);
    assert.equal(after.chipOn, false);
    assert.equal(after.state, false);
  });

  await check("the Follow button resumes following", async () => {
    await page.click("#llab-follow");
    await pause(page, 700);
    const after = await page.evaluate(() => ({
      followVisible: !document.getElementById("llab-follow").classList.contains("hidden"),
      chipOn: document.getElementById("llab-auto-scroll").classList.contains("on"),
      state: Lyra.lyricsSync._state().follow,
    }));
    assert.equal(after.followVisible, false);
    assert.equal(after.chipOn, true);
    assert.equal(after.state, true);
  });

  await check("tapping a line seeks there", async () => {
    await page.click('.llab-line[data-i="2"]');
    await pause(page, 250);
    const t = await page.evaluate(() => Lyra.player.audio.currentTime);
    assert.ok(t > 2.8 && t < 3.6, "seeked to " + t.toFixed(2));
  });

  await check("holding a line pauses and edits it in place, and Save keeps the timing", async () => {
    await seekTo(page, 1.7);
    await page.locator('.llab-line[data-i="1"]').scrollIntoViewIfNeeded();
    await pause(page, 200);
    const box = await page.locator('.llab-line[data-i="1"]').boundingBox();
    const at = { x: Math.round(box.x + 24), y: Math.round(box.y + box.height / 2) };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await pause(page, 680);
    const during = await page.evaluate((at) => ({
      hit: (document.elementFromPoint(at.x, at.y) || {}).className,
      editor: !!document.querySelector(".llab-edit-input"),
      value: (document.querySelector(".llab-edit-input") || {}).value,
      editing: Lyra.lyricsSync._state().editing,
      paused: Lyra.player.audio.paused,
      lines: document.querySelectorAll(".llab-line").length,
      heading: document.getElementById("lyrics-heading").textContent,
    }), at);
    await page.mouse.up();
    assert.equal(during.editor, true, "holding a line opens the inline editor (hit=" + during.hit + " editing=" + during.editing + ")");
    assert.equal(during.value, "Four five six");
    assert.equal(during.editing, 1);
    assert.equal(during.paused, true, "the song pauses while you fix the line");
    assert.equal(during.lines, 12, "the rest of the lyrics stay on screen");
    assert.equal(during.heading, "Fixture Song", "still on the lyrics screen");

    await page.fill(".llab-edit-input", "Four five six  (heard)");
    await page.click('.llab-edit [data-edit="save"]');
    await pause(page, 450);
    const after = await page.evaluate(async () => {
      const t = await Lyra.db.getTrack(Lyra.app.tracks[0].id);
      const lines = t.lyricsSynced.lines;
      return {
        text: lines[1].text,
        t: lines[1].t,
        next: lines[2].t,
        count: lines.length,
        words: (lines[1].words || []).length,
        firstWord: lines[1].words && lines[1].words[0].t,
        dom: document.querySelector('.llab-line[data-i="1"]').textContent.trim(),
        editor: !!document.querySelector(".llab-edit-input"),
        lyricsLine: t.lyrics.split("\n")[1],
      };
    });
    assert.equal(after.text, "Four five six (heard)");
    assert.ok(Math.abs(after.t - 1.6) < 0.01, "the line keeps its original start time (" + after.t + ")");
    assert.ok(Math.abs(after.next - 3) < 0.01, "the next line's time is untouched (" + after.next + ")");
    assert.equal(after.count, 12, "no lines were added or lost");
    assert.equal(after.words, 4, "word mode still has word timing");
    assert.ok(Math.abs(after.firstWord - 1.6) < 0.01, "word timing starts at the line start");
    assert.equal(after.dom, "Four five six (heard)", "the screen shows the fix");
    assert.equal(after.editor, false);
    assert.equal(after.lyricsLine, "Four five six (heard)", "the plain lyrics text follows");
  });

  await check("Discard leaves the line and the song as they were, then plays on", async () => {
    await page.evaluate(() => Lyra.player.audio.play().catch(() => {}));
    await pause(page, 300);
    await page.locator('.llab-line[data-i="2"]').scrollIntoViewIfNeeded();
    await pause(page, 200);
    const box = await page.locator('.llab-line[data-i="2"]').boundingBox();
    await page.mouse.move(box.x + 24, box.y + box.height / 2);
    await page.mouse.down();
    await pause(page, 680);
    await page.mouse.up();
    await page.fill(".llab-edit-input", "this should be thrown away");
    await page.click('.llab-edit [data-edit="cancel"]');
    await pause(page, 500);
    const after = await page.evaluate(async () => {
      const t = await Lyra.db.getTrack(Lyra.app.tracks[0].id);
      return {
        text: t.lyricsSynced.lines[2].text,
        dom: document.querySelector('.llab-line[data-i="2"]').textContent.trim(),
        editor: !!document.querySelector(".llab-edit-input"),
        paused: Lyra.player.audio.paused,
        editing: Lyra.lyricsSync._state().editing,
      };
    });
    assert.equal(after.text, "Seven eight nine");
    assert.equal(after.dom, "Seven eight nine");
    assert.equal(after.editor, false);
    assert.equal(after.editing, -1);
    assert.equal(after.paused, false, "playback resumes without leaving the lyrics screen");
    await page.evaluate(() => Lyra.player.audio.pause());
  });

  await check("offset nudge shifts which line is active and is saved", async () => {
    await seekTo(page, 1.5);
    assert.equal(await activeIndex(page), 0, "line 2 starts at 1.6s");
    await page.click('[data-nudge="-1"]');
    await page.click('[data-nudge="-1"]');
    await pause(page, 250);
    const after = await page.evaluate(async () => ({
      active: Number(document.querySelector(".llab-line.now")?.dataset.i),
      label: document.getElementById("llab-offset").textContent,
      saved: (await Lyra.db.getTrack(Lyra.app.tracks[0].id)).lrcOffset,
    }));
    assert.equal(after.active, 1, "with -0.2s the next line becomes active at 1.5s");
    assert.equal(after.label, "-0.2s");
    assert.equal(after.saved, -0.2);
  });

  await check("importing a .lrc attaches timed lines and exports back", async () => {
    await closeOverlays(page);
    await openNowPlaying(page);
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.click("#llab-import"),
    ]);
    const lrc = "[00:00.50]first test line\n[00:03.00][00:06.00]chorus test line\n";
    await chooser.setFiles({ name: "test.lrc", mimeType: "text/plain", buffer: Buffer.from(lrc) });
    await pause(page, 600);
    const saved = await page.evaluate(async () => {
      const t = await Lyra.db.getTrack(Lyra.app.tracks[0].id);
      const text = Lyra.lyricsSync.lrcTextFor(t);
      return {
        source: t.lyricsSynced && t.lyricsSynced.source,
        count: t.lyricsSynced && t.lyricsSynced.lines.length,
        firstTime: t.lyricsSynced && t.lyricsSynced.lines[0].t,
        exported: (text || "").split("\n").filter((l) => /^\[\d{2}:\d{2}\.\d{2}\]/.test(l)).length,
        exportedHasStamps: /\[00:0[0-9]\.\d\d\]/.test(text || ""),
      };
    });
    assert.equal(saved.source, "lrc");
    assert.equal(saved.count, 3, "two stamps on one line become two lines");
    assert.equal(saved.firstTime, 0.5);
    assert.equal(saved.exported, 3);
    assert.equal(saved.exportedHasStamps, true);
  });

  await check("lrc import drives the highlighted view", async () => {
    await page.evaluate(() => document.getElementById("np-lyrics-card").click());
    await pause(page, 500);
    const info = await page.evaluate(() => ({
      lines: document.querySelectorAll(".llab-line").length,
      hasBar: !!document.getElementById("llab-bar"),
    }));
    assert.equal(info.lines, 3);
    assert.equal(info.hasBar, true);
    await closeOverlays(page);
    // restore the original fixture (settings untouched) for the remaining checks
    await seed(page, true);
    await pause(page, 300);
  });

  console.log("\nBeta OFF again");
  await check("turning the Lab off restores the plain lyrics view", async () => {
    await closeOverlays(page);
    await gotoView(page, "settings");
    await page.click("#llab-enabled");
    await pause(page, 300);
    await openLyrics(page);
    const after = await page.evaluate(() => ({
      bar: !!document.getElementById("llab-bar"),
      lines: document.querySelectorAll(".llab-line").length,
      follow: !!document.getElementById("llab-follow"),
      cls: document.getElementById("lyrics-text").className,
      text: document.getElementById("lyrics-text").textContent.trim(),
      np: !!document.getElementById("llab-np"),
    }));
    assert.equal(after.bar, false);
    assert.equal(after.lines, 0);
    assert.equal(after.follow, false);
    assert.equal(after.cls, "lyrics-text");
    assert.match(after.text, /One two three/);
    assert.equal(after.np, false);
  });

  await check("large files are decoded and resampled to 16 kHz mono WAV, with a size cap", async () => {
    const out = await page.evaluate(async () => {
      // 1 s stereo 48 kHz sine, built inline as a real WAV blob.
      const sr = 48000, frames = sr, ch = 2, bytes = frames * ch * 2;
      const buf = new ArrayBuffer(44 + bytes);
      const dv = new DataView(buf);
      const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      str(0, "RIFF"); dv.setUint32(4, 36 + bytes, true); str(8, "WAVE"); str(12, "fmt ");
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true);
      dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); str(36, "data");
      dv.setUint32(40, bytes, true);
      for (let i = 0; i < frames; i++) {
        const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 12000);
        dv.setInt16(44 + i * 4, v, true);
        dv.setInt16(46 + i * 4, v, true);
      }
      const blob = new Blob([buf], { type: "audio/wav" });

      const shrunk = await Lyra.lyricsSync.prepareAudioForUpload(blob, { limit: 100000 });
      const head = new DataView(await shrunk.blob.arrayBuffer());
      const tag = (o) => String.fromCharCode(head.getUint8(o), head.getUint8(o + 1), head.getUint8(o + 2), head.getUint8(o + 3));
      let tooLong = null;
      try { await Lyra.lyricsSync.prepareAudioForUpload(blob, { limit: 100 }); }
      catch (e) { tooLong = { code: e.code, message: e.message }; }
      const passthrough = await Lyra.lyricsSync.prepareAudioForUpload(blob, { limit: 1e7 });

      return {
        inSize: blob.size,
        outSize: shrunk.blob.size,
        converted: shrunk.converted,
        riff: tag(0), wave: tag(8),
        format: head.getUint16(20, true),
        channels: head.getUint16(22, true),
        rate: head.getUint32(24, true),
        bits: head.getUint16(34, true),
        frames: (shrunk.blob.size - 44) / 2,
        tooLong,
        passthroughConverted: passthrough.converted,
        passthroughSame: passthrough.blob === blob,
      };
    });
    assert.equal(out.riff, "RIFF");
    assert.equal(out.wave, "WAVE");
    assert.equal(out.format, 1);
    assert.equal(out.channels, 1, "downmixed to mono");
    assert.equal(out.rate, 16000, "resampled to 16 kHz");
    assert.equal(out.bits, 16);
    assert.ok(out.outSize < out.inSize, "output must be smaller than input");
    assert.ok(Math.abs(out.frames - 16000) <= 64, "about one second of 16 kHz audio, got " + out.frames + " frames");
    assert.equal(out.converted, true);
    assert.equal(out.tooLong.code, "too-long", "over the cap after conversion reports too-long");
    assert.match(out.tooLong.message, /too long/i);
    assert.equal(out.passthroughConverted, false, "files under the cap are sent as is");
    assert.equal(out.passthroughSame, true);
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
