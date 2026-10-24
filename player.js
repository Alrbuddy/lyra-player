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

  const artUrls = new Map(); // track id -> object URL, kept for Media Session artwork

  function artUrlFor(track) {
    if (!track || !track.art) return null;
    if (!artUrls.has(track.id)) artUrls.set(track.id, URL.createObjectURL(track.art));
    return artUrls.get(track.id);
  }

  async function loadTrack(track, autoplay) {
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
      updateMediaSession(track);
    } else {
      audio.removeAttribute("src");
      audio.load();
      if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    }
    emit("track", track);
    if (track && autoplay) {
      try { await audio.play(); } catch (e) { emit("state", state()); }
    }
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
      const track = await window.Lyra.db.getTrack(currentId());
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
        audio.currentTime = 0;
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
      if (audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
      }
      let i = index - 1;
      if (i < 0) i = repeat === "all" ? queue.length - 1 : 0;
      await player.playAt(i);
    },

    seek(t) {
      if (!current) return;
      audio.currentTime = Math.max(0, Math.min(t, state().duration || 0));
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
  });
  audio.addEventListener("seeked", () => { lastTick = audio.currentTime || 0; });
  audio.addEventListener("ended", () => {
    countPlay();
    player.next(false);
  });
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
