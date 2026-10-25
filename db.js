/* Lyra.db — IndexedDB layer.
   Stores: tracks (metadata only), audio (one blob per track), playlists, settings.

   Audio lives in its own store on purpose. Safari intermittently refuses to
   clone a Blob into IndexedDB ("Error preparing Blob/File data to be stored in
   object store", WebKit bug 188438), and a `put(track)` rewrites the whole
   record — so every lyric edit or play count used to re-serialize the song
   file. Keeping the blob out of the record makes those writes tiny and makes
   the failure impossible. */
(function () {
  "use strict";
  window.Lyra = window.Lyra || {};

  const DB_NAME = "lyra";
  const DB_VERSION = 2;

  let dbPromise = null;

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function stripAudio(track) {
    const copy = Object.assign({}, track);
    delete copy.audio;
    return copy;
  }

  // Tracks written by older builds carried the blob inside the record. Move
  // those into the audio store once, per track, so an interrupted migration
  // simply resumes next launch.
  async function migrateLegacyAudio(d) {
    if (!d.objectStoreNames.contains("audio")) return;
    const legacy = await reqToPromise(
      d.transaction("tracks", "readonly").objectStore("tracks").getAll()
    );
    for (const t of legacy) {
      if (!t || !t.audio) continue;
      const blob = t.audio;
      try {
        const exists = await reqToPromise(
          d.transaction("audio", "readonly").objectStore("audio").get(t.id)
        );
        const tx = d.transaction(["tracks", "audio"], "readwrite");
        if (!exists) tx.objectStore("audio").put({ id: t.id, blob });
        tx.objectStore("tracks").put(stripAudio(t));
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } catch (e) {
        // Leave the inline copy in place: reads join from either location, and
        // the next launch tries again.
      }
    }
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("tracks")) {
          db.createObjectStore("tracks", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("audio")) {
          db.createObjectStore("audio", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("playlists")) {
          db.createObjectStore("playlists", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Never hand out a connection until the old inline blobs are moved.
        migrateLegacyAudio(db).catch(() => {}).then(() => resolve(db));
      };
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function audioFor(d, id) {
    return reqToPromise(d.transaction("audio", "readonly").objectStore("audio").get(id))
      .then((row) => (row && row.blob ? row.blob : null))
      .catch(() => null);
  }

  function attachAudio(track, blob) {
    if (!track) return track;
    const copy = Object.assign({}, track);
    if (blob) copy.audio = blob;
    else if (track.audio) delete copy.audio;
    return copy;
  }

  function putAudio(d, id, blob) {
    return new Promise((resolve, reject) => {
      const tx = d.transaction("audio", "readwrite");
      tx.objectStore("audio").put({ id, blob });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const db = {
    async addTrack(track) {
      const d = await open();
      const rec = stripAudio(track);
      const id = await reqToPromise(
        d.transaction("tracks", "readwrite").objectStore("tracks").add(rec)
      );
      if (track && track.audio) {
        try {
          await putAudio(d, id, track.audio);
        } catch (e) {
          // No audio store? Keep the file with the record rather than lose it.
          await reqToPromise(
            d.transaction("tracks", "readwrite").objectStore("tracks").put(
              Object.assign({}, rec, { id, audio: track.audio })
            )
          );
        }
      }
      return id;
    },

    async putTrack(track) {
      const d = await open();
      const rec = stripAudio(track);
      const existing = await reqToPromise(
        d.transaction("audio", "readonly").objectStore("audio").get(track.id)
      ).catch(() => null);
      if (track && track.audio && !existing) {
        try { await putAudio(d, track.id, track.audio); }
        catch (e) { rec.audio = track.audio; }
      } else if (!existing && !rec.audio) {
        // The record may still carry a legacy inline blob; never drop it.
        const stored = await reqToPromise(
          d.transaction("tracks", "readonly").objectStore("tracks").get(track.id)
        ).catch(() => null);
        if (stored && stored.audio) rec.audio = stored.audio;
      }
      await reqToPromise(
        d.transaction("tracks", "readwrite").objectStore("tracks").put(rec)
      );
      return track.id;
    },

    /* Update fields on the stored record without touching the audio blob.
       `fields` is a plain object of what changed; the record is re-read first
       so an edit never writes a stale copy of anything else. Distinguishes a
       deleted song ("not-found") from a storage failure. */
    async saveMeta(id, fields) {
      const d = await open();
      const stored = await reqToPromise(
        d.transaction("tracks", "readonly").objectStore("tracks").get(id)
      );
      if (!stored) {
        const err = new Error("This song is no longer in your library.");
        err.code = "not-found";
        throw err;
      }
      const merged = stripAudio(Object.assign({}, stored, fields || {}));
      if (stored.audio) {
        // A record that still holds its blob must not lose it to this write.
        try { await putAudio(d, id, stored.audio); }
        catch (e) { merged.audio = stored.audio; }
      }
      await reqToPromise(
        d.transaction("tracks", "readwrite").objectStore("tracks").put(merged)
      );
      return merged;
    },

    async getTrack(id) {
      const d = await open();
      const track = await reqToPromise(
        d.transaction("tracks", "readonly").objectStore("tracks").get(id)
      );
      if (!track) return track;
      if (track.audio) return track; // legacy inline copy
      const blob = await audioFor(d, id);
      return attachAudio(track, blob);
    },

    async deleteTrack(id) {
      const d = await open();
      await new Promise((resolve, reject) => {
        const t = d.transaction(["tracks", "audio"], "readwrite");
        t.objectStore("tracks").delete(id);
        t.objectStore("audio").delete(id);
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    },

    async getAllTracks() {
      const d = await open();
      const [list, audioRows] = await Promise.all([
        reqToPromise(d.transaction("tracks", "readonly").objectStore("tracks").getAll()),
        reqToPromise(d.transaction("audio", "readonly").objectStore("audio").getAll())
          .catch(() => []),
      ]);
      const byId = new Map();
      (audioRows || []).forEach((row) => { if (row && row.blob) byId.set(row.id, row.blob); });
      return (list || []).map((t) => {
        if (t.audio) return t;
        const blob = byId.get(t.id);
        return blob ? Object.assign({}, t, { audio: blob }) : t;
      });
    },

    addPlaylist(pl) {
      return open().then((d) => reqToPromise(
        d.transaction("playlists", "readwrite").objectStore("playlists").add(pl)
      ));
    },
    putPlaylist(pl) {
      return open().then((d) => reqToPromise(
        d.transaction("playlists", "readwrite").objectStore("playlists").put(pl)
      ));
    },
    getPlaylist(id) {
      return open().then((d) => reqToPromise(
        d.transaction("playlists", "readonly").objectStore("playlists").get(id)
      ));
    },
    deletePlaylist(id) {
      return open().then((d) => reqToPromise(
        d.transaction("playlists", "readwrite").objectStore("playlists").delete(id)
      ));
    },
    getAllPlaylists() {
      return open().then((d) => reqToPromise(
        d.transaction("playlists", "readonly").objectStore("playlists").getAll()
      ));
    },
    getSetting(key) {
      return open().then((d) => reqToPromise(
        d.transaction("settings", "readonly").objectStore("settings").get(key)
      )).then((row) => (row ? row.value : undefined));
    },
    setSetting(key, value) {
      return open().then((d) => reqToPromise(
        d.transaction("settings", "readwrite").objectStore("settings").put({ key, value })
      ));
    },
    clearAll() {
      return open().then((d) => new Promise((resolve, reject) => {
        const t = d.transaction(["tracks", "audio", "playlists", "settings"], "readwrite");
        ["tracks", "audio", "playlists", "settings"].forEach((s) => t.objectStore(s).clear());
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      }));
    },
  };

  window.Lyra.db = db;
})();
