/* Lyra.player — single audio element, queue, shuffle/repeat, Media Session.

   Playback on iOS is the fragile part of a web music app: a play() that is
   still pending when the source changes rejects with AbortError, and an element
   that has failed once can stay silent for the rest of the session. Every start
   therefore goes through startPlayback(), and a song that still will not make a
   sound escalates: a fresh blob URL, then a copy re-read from IndexedDB, then a
   brand new <audio> element. */
(function () {
  "use strict";
  window.Lyra = window.Lyra || {};

  const listeners = {};
  function emit(evt, data) {
    (listeners[evt] || []).forEach((cb) => {
      try { cb(data); } catch (e) { /* listener errors must not break playback */ }
    });
  }

  let queue = [];          // array of track ids, in play order
  let baseQueue = [];      // original (unshuffled) order
  let index = -1;
  let current = null;      // current track record
  let currentUrl = null;
  let shuffle = false;
  // A list keeps playing when it reaches the end: loop the queue by default,
  // so finishing the last song never leaves the app sitting on a dead player.
  // The repeat button still offers off (stop at the end) and one (this song).
  let repeat = "all";      // "off" | "all" | "one"
  let playCounted = false; // play count incremented for current track
  let playedSeconds = 0;
  let lastTick = 0;

  let loadToken = 0;
  let errorRetries = 0;
  let endHandled = false;
  let endingSegment = false;
  // iOS keeps reporting the previous song's position for a moment after the
  // source changes; until the new source has metadata, the honest answer is
  // the new song's start point.
  let awaitingMeta = false;

  const artUrls = new Map(); // track id -> object URL, kept for Media Session artwork

  function currentId() {
    return index >= 0 && index < queue.length ? queue[index] : null;
  }

  // Per-song start / end points (seconds). 0 / null means "no trim".
  function startOf(track) {
    const s = Number(track && track.startAt) || 0;
    return s > 0 ? s : 0;
  }

  function endOf(track) {
    const e = Number(track && track.endAt) || 0;
    return e > 0 ? e : 0;
  }

  function seekToStart() {
    const s = startOf(current);
    if (!(s > 0)) return;
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const target = dur ? Math.min(s, Math.max(0, dur - 0.2)) : s;
    try { audio.currentTime = target; } catch (e) { return; }
    lastTick = target;
  }

  function artUrlFor(track) {
    if (!track || !track.art) return null;
    if (!artUrls.has(track.id)) artUrls.set(track.id, URL.createObjectURL(track.art));
    return artUrls.get(track.id);
  }

  // The blob URL of the outgoing song is revoked a few seconds after the
  // switch rather than immediately: revoking the source iOS is still holding
  // can leave the element silent until the app is reloaded.
  function revokeSoon(url) {
    if (!url) return;
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 8000);
  }

  // Resolves when the element can actually play (or after a short wait).
  function waitUntilReady(ms) {
    return new Promise((resolve) => {
      const el = audio;
      const events = ["loadedmetadata", "loadeddata", "canplay", "canplaythrough"];
      let done = false;
      let timer = 0;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        events.forEach((ev) => el.removeEventListener(ev, finish));
        resolve();
      };
      events.forEach((ev) => el.addEventListener(ev, finish));
      timer = setTimeout(finish, ms);
      if (el.readyState >= 2) finish();
    });
  }

  // Starting a song is the fragile part on iOS: a play() promise that is still
  // pending when the source changes rejects with AbortError, and a rejection
  // just after a source swap leaves the element paused with nothing retrying
  // it. Retry against the element itself instead of waiting for one event that
  // may already have fired.
  async function startPlayback(token) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (token !== loadToken) return false;
      try {
        await audio.play();
        if (!audio.paused) return true;
      } catch (e) {
        if (token !== loadToken) return false; // a newer load owns playback now
      }
      await waitUntilReady(attempt === 0 ? 700 : 400);
    }
    if (token === loadToken) emit("state", state());
    return token === loadToken && !audio.paused;
  }

  const audioState = () => (audio ? audio : null);

  // Point the element at the loaded song again with a brand new blob URL.
  function rebuildSource() {
    if (!current || !current.audio) return false;
    const old = currentUrl;
    try { audio.pause(); } catch (e) { /* nothing playing */ }
    let url;
    try {
      url = URL.createObjectURL(current.audio);
    } catch (e) {
      return false;
    }
    currentUrl = url;
    audio.src = url;
    try { audio.load(); } catch (e) { /* retried by the caller */ }
    if (old && old !== url) revokeSoon(old);
    awaitingMeta = true;
    lastTick = 0;
    audio.addEventListener("loadedmetadata", seekToStart, { once: true });
    return true;
  }

  // The last resort when an element refuses to make a sound: throw it away.
  function replaceAudioElement() {
    const old = audio;
    try { old.pause(); } catch (e) {}
    try { old.removeAttribute("src"); old.load(); } catch (e) {}
    audio = createAudio();
    return audio;
  }

  /* A song that failed to start, in order of cheapness: same bytes, new source;
     the copy stored in IndexedDB (an in-memory File can go stale); a fresh
     element. Returns true when sound is actually coming out. */
  async function emergencyRestart(token) {
    if (!current || token !== loadToken) return false;
    if (rebuildSource()) {
      if (await startPlayback(token)) return true;
      if (token !== loadToken) return false;
    }
    try {
      const fresh = await window.Lyra.db.getTrack(current.id);
      if (fresh && fresh.audio) current.audio = fresh.audio;
    } catch (e) { /* keep the bytes we have */ }
    if (token !== loadToken || !current) return false;
    replaceAudioElement();
    if (!rebuildSource()) return false;
    return startPlayback(token);
  }

  // Resume the loaded song, recovering if it will not start.
  async function resume() {
    if (!current) return false;
    const token = loadToken;
    if (audio.error || (audio.readyState === 0 && audio.currentSrc)) {
      await loadTrack(current, true);
      return true;
    }
    if (await startPlayback(token)) return true;
    if (token !== loadToken) return true;
    return emergencyRestart(token);
  }

  function updateMediaSession(track) {
    if (!("mediaSession" in navigator)) return;
    let artwork = [];
    if (track.artUrl) {
      artwork = [
        { src: track.artUrl, sizes: "256x256", type: track.art ? track.art.type : "image/jpeg" },
        { src: track.artUrl, sizes: "512x512", type: track.art ? track.art.type : "image/jpeg" },
      ];
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || "Unknown",
        artist: track.artist || "Unknown Artist",
        album: track.album || "",
        artwork,
      });
    } catch (e) { /* older WebKit */ }
  }

  async function loadTrack(track, autoplay) {
    const token = ++loadToken;
    endHandled = false;
    errorRetries = 0;
    awaitingMeta = !!track;
    try { audio.pause(); } catch (e) { /* nothing to pause */ }
    const old = currentUrl;
    currentUrl = null;
    current = track;
    if (track) track.artUrl = artUrlFor(track);
    playCounted = false;
    playedSeconds = 0;
    lastTick = 0;
    if (track) {
      currentUrl = URL.createObjectURL(track.audio);
      audio.src = currentUrl;
      audio.load();
      audio.addEventListener("loadedmetadata", seekToStart, { once: true });
      updateMediaSession(track);
    } else {
      try { audio.removeAttribute("src"); audio.load(); } catch (e) { /* ignore */ }
      if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    }
    revokeSoon(old);
    emit("track", track);
    emit("time", state());
    if (track && autoplay) {
      const ok = await startPlayback(token);
      if (!ok && token === loadToken) await emergencyRestart(token);
    }
    return true;
  }

  function state() {
    const st = {
      track: current,
      queue: queue.slice(),
      index,
      shuffle,
      repeat,
      playing: !!(audio && !audio.paused && !audio.ended),
      currentTime: awaitingMeta ? startOf(current) : ((audio && audio.currentTime) || 0),
      duration: audio && Number.isFinite(audio.duration)
        ? audio.duration
        : (current ? current.duration || 0 : 0),
    };
    return st;
  }

  async function countPlay() {
    if (playCounted || !current) return;
    playCounted = true;
    try {
      // Metadata-only write: never re-store the song's audio for a play count.
      const fresh = await window.Lyra.db.saveMeta(current.id, {
        plays: (current.plays || 0) + 1,
        lastPlayedAt: Date.now(),
      });
      current.plays = fresh.plays;
      current.lastPlayedAt = fresh.lastPlayedAt;
      emit("playcount", current);
    } catch (e) { /* non-fatal */ }
  }

  function shuffledIds(ids, keepFirstId) {
    const rest = ids.filter((id) => id !== keepFirstId);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return keepFirstId != null ? [keepFirstId, ...rest] : rest;
  }

  /* ------------------------------------------------------- element wiring */
  function attachAudioHandlers(el) {
    el.preload = "auto";

    el.addEventListener("play", () => {
      if (el !== audio) return;
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
      emit("state", state());
    });
    el.addEventListener("pause", () => {
      if (el !== audio) return;
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
      emit("state", state());
    });
    el.addEventListener("loadedmetadata", () => {
      if (el !== audio) return;
      awaitingMeta = false;
    });
    el.addEventListener("timeupdate", () => {
      if (el !== audio) return;
      awaitingMeta = false;
      const now = el.currentTime || 0;
      if (lastTick && now > lastTick) playedSeconds += now - lastTick;
      lastTick = now;
      if (playedSeconds >= 30) countPlay();
      emit("time", state());
      const end = endOf(current);
      if (end > 0 && !el.paused && now >= end - 0.06) finishSegment();
    });
    el.addEventListener("seeked", () => {
      if (el !== audio) return;
      lastTick = el.currentTime || 0;
    });
    el.addEventListener("durationchange", () => {
      if (el !== audio) return;
      emit("time", state());
    });
    el.addEventListener("ended", () => {
      if (el !== audio) return;
      handleEnded();
    });
    el.addEventListener("error", () => {
      if (el !== audio || !current || !el.error || errorRetries >= 2) return;
      errorRetries++;
      const token = loadToken;
      setTimeout(() => {
        if (token !== loadToken) return;
        if (!rebuildSource()) return;
        startPlayback(token).then((ok) => { if (!ok) emergencyRestart(token); });
      }, 300);
    });

    if ("mediaSession" in navigator) {
      el.addEventListener("timeupdate", () => {
        if (el !== audio || !current || !Number.isFinite(el.duration)) return;
        try {
          navigator.mediaSession.setPositionState({
            duration: el.duration,
            playbackRate: el.playbackRate,
            position: el.currentTime,
          });
        } catch (e) {}
      });
    }
  }

  function createAudio() {
    const el = new Audio();
    attachAudioHandlers(el);
    return el;
  }

  let audio = createAudio();

  // Reached the end: count the play and move on. Guarded so the ended event
  // and the watchdog below can never advance twice for one song.
  async function handleEnded() {
    if (!current || endHandled) return;
    endHandled = true;
    countPlay();
    try { await player.next(false); } catch (e) { /* keep the UI consistent */ }
    emit("state", state());
  }

  // iOS sometimes drops `ended` (an interruption, a pause on the last frame),
  // which left the app sitting on a finished song. Poll the element's own flag.
  setInterval(() => { if (current && audio && audio.ended) handleEnded(); }, 1000);

  // Reached this song's end point: advance exactly like a natural finish.
  async function finishSegment() {
    if (endingSegment) return;
    endingSegment = true;
    const id = currentId();
    countPlay();
    try {
      await player.next(false);
      // At the end of the queue with repeat off nothing advanced — stop here.
      const end = endOf(current);
      if (currentId() === id && end > 0 && audio.currentTime >= end - 0.06) {
        audio.pause();
        try { audio.currentTime = end; } catch (e) {}
      }
    } finally {
      endingSegment = false;
    }
  }

  const player = {
    get audio() { return audio; },

    on(evt, cb) {
      (listeners[evt] = listeners[evt] || []).push(cb);
    },

    state,

    async playQueue(ids, startIndex, opts) {
      opts = opts || {};
      if (!ids || !ids.length) return;
      baseQueue = ids.slice();
      queue = ids.slice();
      if (shuffle || opts.shuffle) {
        shuffle = true;
        queue = shuffledIds(queue, ids[startIndex]);
        index = 0;
      } else {
        index = startIndex;
      }
      // Tapping the song that is already loaded should not rebuild the audio
      // source: pause/resume it instead (re-tapping used to stall playback).
      if (current && current.id === currentId()) {
        // …unless the element is wedged (a failed decode, a source that never
        // loaded). Then rebuilding it is the only way back to sound.
        if (audio.error || (audio.readyState === 0 && audio.currentSrc)) {
          await loadTrack(current, true);
          emit("queue", state());
          return;
        }
        // A finished song should start over rather than sit at the end.
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (audio.ended || (dur && audio.currentTime >= dur - 0.15)) {
          try { audio.currentTime = startOf(current); } catch (e) { /* ignore */ }
        }
        if (audio.paused) await resume();
        emit("queue", state());
        return;
      }
      // Start from the record already in memory when the caller has it: a
      // round-trip to IndexedDB before setting audio.src is what made a tap
      // feel like it needed a second press.
      let track = opts.firstTrack && opts.firstTrack.id === currentId() ? opts.firstTrack : null;
      if (!track) track = await window.Lyra.db.getTrack(currentId());
      if (track) await loadTrack(track, true);
      emit("queue", state());
    },

    // ---- Queue editing (the Up next sheet) ----
    queueMove(from, to) {
      if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
      const playing = queue[index];
      const [id] = queue.splice(from, 1);
      queue.splice(to, 0, id);
      index = queue.indexOf(playing);
      emit("queue", state());
    },

    async queueRemove(i) {
      if (i < 0 || i >= queue.length) return;
      const wasCurrent = i === index;
      const playing = index >= 0 ? queue[index] : null;
      const [removed] = queue.splice(i, 1);
      const bi = baseQueue.indexOf(removed);
      if (bi >= 0) baseQueue.splice(bi, 1);
      if (wasCurrent) {
        index = Math.min(i, queue.length - 1);
        if (index >= 0) {
          const track = await window.Lyra.db.getTrack(queue[index]);
          if (track) await loadTrack(track, true);
        } else {
          player.stop();
        }
      } else {
        index = queue.indexOf(playing);
      }
      emit("queue", state());
    },

    async playNext(id) {
      if (index < 0) {
        return player.playQueue([id], 0);
      }
      queue.splice(index + 1, 0, id);
      const bi = baseQueue.indexOf(queue[index]);
      baseQueue.splice(bi >= 0 ? bi + 1 : baseQueue.length, 0, id);
      emit("queue", state());
    },

    async playAt(i) {
      if (i < 0 || i >= queue.length) return;
      index = i;
      const track = await window.Lyra.db.getTrack(currentId());
      if (track) await loadTrack(track, true);
    },

    // Used when the loaded song is deleted: leaving a deleted record (and its
    // blob) on the element would let a later import that reuses the id look
    // like "this song is already loaded".
    stop() {
      ++loadToken;
      endHandled = true;
      awaitingMeta = false;
      try { audio.pause(); } catch (e) { /* nothing playing */ }
      const old = currentUrl;
      currentUrl = null;
      try { audio.removeAttribute("src"); audio.load(); } catch (e) { /* ignore */ }
      revokeSoon(old);
      current = null;
      queue = [];
      baseQueue = [];
      index = -1;
      playedSeconds = 0;
      lastTick = 0;
      if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
      emit("track", null);
      emit("state", state());
    },

    async toggle() {
      if (!current) {
        emit("needqueue");
        return;
      }
      if (audio.paused) {
        await resume();
      } else {
        audio.pause();
      }
    },

    async next(manual) {
      if (!queue.length) return;
      if (repeat === "one" && !manual) {
        audio.currentTime = startOf(current);
        await resume();
        return;
      }
      let i = index + 1;
      if (i >= queue.length) {
        if (repeat === "all" || manual) {
          // Nothing to move on to in a one-song queue: let it end rather than
          // restart the same song forever.
          if (queue.length < 2 && !manual) return;
          i = 0;
        } else return;
      }
      await player.playAt(i);
    },

    async prev() {
      if (!queue.length) return;
      const lo = startOf(current);
      if (audio.currentTime > lo + 3) {
        audio.currentTime = lo;
        return;
      }
      let i = index - 1;
      if (i < 0) i = repeat === "all" ? queue.length - 1 : 0;
      await player.playAt(i);
    },

    seek(t) {
      if (!current) return;
      const lo = startOf(current);
      const end = endOf(current);
      const hi = end > 0 ? end : (state().duration || 0);
      audio.currentTime = Math.max(lo, Math.min(t, hi));
      emit("time", state());
    },

    setShuffle(on) {
      if (on === shuffle) return;
      shuffle = on;
      const id = currentId();
      if (shuffle) {
        baseQueue = queue.slice();
        queue = shuffledIds(queue, id);
        index = 0;
      } else {
        queue = baseQueue.length ? baseQueue.slice() : queue;
        index = queue.indexOf(id);
        if (index < 0 && queue.length) index = 0;
      }
      emit("state", state());
    },

    cycleRepeat() {
      repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
      emit("state", state());
      return repeat;
    },

    // Metadata was edited for the loaded track — refresh the lock screen card.
    refreshMediaSession() {
      if (current) updateMediaSession(current);
    },
  };

  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch (e) {} };
    set("play", () => player.toggle());
    set("pause", () => audio.pause());
    set("previoustrack", () => player.prev());
    set("nexttrack", () => player.next(true));
    set("seekto", (d) => { if (d.seekTime != null) player.seek(d.seekTime); });
    set("seekbackward", (d) => player.seek((audio.currentTime || 0) - (d.seekOffset || 10)));
    set("seekforward", (d) => player.seek((audio.currentTime || 0) + (d.seekOffset || 10)));
  }

  player._test = { audioState, rebuildSource, emergencyRestart };

  window.Lyra.player = player;
})();
