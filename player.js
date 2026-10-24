/* Lyra.player — single audio element, queue, shuffle/repeat, Media Session. */
(function () {
  "use strict";
  window.Lyra = window.Lyra || {};

  const audio = new Audio();
  audio.preload = "auto";

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
  let repeat = "off";      // "off" | "all" | "one"
  let playCounted = false; // play count incremented for current track
  let playedSeconds = 0;
  let lastTick = 0;

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

  let endingSegment = false;

  function seekToStart() {
    const s = startOf(current);
    if (!(s > 0)) return;
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const target = dur ? Math.min(s, Math.max(0, dur - 0.2)) : s;
    try { audio.currentTime = target; } catch (e) { return; }
    lastTick = target;
  }

  const artUrls = new Map(); // track id -> object URL, kept for Media Session artwork

  function artUrlFor(track) {
    if (!track || !track.art) return null;
    if (!artUrls.has(track.id)) artUrls.set(track.id, URL.createObjectURL(track.art));
    return artUrls.get(track.id);
  }

  let loadToken = 0;

  // Starting a song is the fragile part on iOS: a play() promise that is still
  // pending when the source changes rejects with AbortError, and revoking the
  // blob URL of the song that is playing can leave the element silent. Pause
  // first, swap the source, then play with one retry when the new source is
  // actually ready.
  async function startPlayback(token) {
    if (token !== loadToken) return;
    try {
      await audio.play();
    } catch (e) {
      if (token !== loadToken) return;
      if (e && (e.name === "AbortError" || e.name === "NotAllowedError")) {
        audio.addEventListener("canplay", () => {
          if (token === loadToken) audio.play().catch(() => emit("state", state()));
        }, { once: true });
        return;
      }
      emit("state", state());
    }
  }

  async function loadTrack(track, autoplay) {
    const token = ++loadToken;
    audio.pause();
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
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
      audio.removeAttribute("src");
      audio.load();
      if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    }
    emit("track", track);
    emit("time", state());
    if (track && autoplay) await startPlayback(token);
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
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || "Unknown",
      artist: track.artist || "Unknown Artist",
      album: track.album || "",
      artwork,
    });
  }

  function state() {
    return {
      track: current,
      queue: queue.slice(),
      index,
      shuffle,
      repeat,
      playing: !audio.paused && !audio.ended,
      currentTime: audio.currentTime || 0,
      duration: Number.isFinite(audio.duration) ? audio.duration : (current ? current.duration || 0 : 0),
    };
  }

  async function countPlay() {
    if (playCounted || !current) return;
    playCounted = true;
    try {
      const t = await window.Lyra.db.getTrack(current.id);
      if (!t) return;
      t.plays = (t.plays || 0) + 1;
      t.lastPlayedAt = Date.now();
      await window.Lyra.db.putTrack(t);
      current.plays = t.plays;
      current.lastPlayedAt = t.lastPlayedAt;
      emit("playcount", t);
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

  const player = {
    audio,

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
        // A finished song should start over rather than sit at the end.
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (audio.ended || (dur && audio.currentTime >= dur - 0.15)) {
          try { audio.currentTime = startOf(current); } catch (e) { /* ignore */ }
        }
        if (audio.paused) await startPlayback(loadToken);
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

    async toggle() {
      if (!current) {
        emit("needqueue");
        return;
      }
      if (audio.paused) {
        try { await audio.play(); } catch (e) { /* user gesture required */ }
      } else {
        audio.pause();
      }
    },

    async next(manual) {
      if (!queue.length) return;
      if (repeat === "one" && !manual) {
        audio.currentTime = startOf(current);
        try { await audio.play(); } catch (e) {}
        return;
      }
      let i = index + 1;
      if (i >= queue.length) {
        if (repeat === "all" || manual) i = 0;
        else return;
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

  audio.addEventListener("play", () => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    emit("state", state());
  });
  audio.addEventListener("pause", () => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    emit("state", state());
  });
  audio.addEventListener("timeupdate", () => {
    const now = audio.currentTime || 0;
    if (lastTick && now > lastTick) playedSeconds += now - lastTick;
    lastTick = now;
    if (playedSeconds >= 30) countPlay();
    emit("time", state());
    const end = endOf(current);
    if (end > 0 && !audio.paused && now >= end - 0.06) finishSegment();
  });
  audio.addEventListener("seeked", () => { lastTick = audio.currentTime || 0; });
  audio.addEventListener("ended", () => {
    countPlay();
    player.next(false);
  });

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
  audio.addEventListener("durationchange", () => emit("time", state()));

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
    audio.addEventListener("timeupdate", () => {
      if (!current || !Number.isFinite(audio.duration)) return;
      try {
        ms.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: audio.currentTime,
        });
      } catch (e) {}
    });
  }

  window.Lyra.player = player;
})();
