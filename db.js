/* Lyra.db — IndexedDB layer. Stores: tracks, playlists, settings. */
(function () {
  "use strict";
  window.Lyra = window.Lyra || {};

  const DB_NAME = "lyra";
  const DB_VERSION = 1;

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("tracks")) {
          db.createObjectStore("tracks", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("playlists")) {
          db.createObjectStore("playlists", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const result = fn(s);
      t.oncomplete = () => resolve(result && result._value !== undefined ? result._value : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const db = {
    addTrack(track) {
      return open().then((d) => reqToPromise(
        d.transaction("tracks", "readwrite").objectStore("tracks").add(track)
      ));
    },
    putTrack(track) {
      return open().then((d) => reqToPromise(
        d.transaction("tracks", "readwrite").objectStore("tracks").put(track)
      ));
    },
    getTrack(id) {
      return open().then((d) => reqToPromise(
        d.transaction("tracks", "readonly").objectStore("tracks").get(id)
      ));
    },
    deleteTrack(id) {
      return open().then((d) => reqToPromise(
        d.transaction("tracks", "readwrite").objectStore("tracks").delete(id)
      ));
    },
    getAllTracks() {
      return open().then((d) => reqToPromise(
        d.transaction("tracks", "readonly").objectStore("tracks").getAll()
      ));
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
        const t = d.transaction(["tracks", "playlists", "settings"], "readwrite");
        t.objectStore("tracks").clear();
        t.objectStore("playlists").clear();
        t.objectStore("settings").clear();
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      }));
    },
  };

  window.Lyra.db = db;
})();
