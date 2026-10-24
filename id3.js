/* Lyra.id3 — tag reading via vendored jsmediatags, plus duration probing.
   Never throws: falls back to the filename on any failure. */
(function () {
  "use strict";
  window.Lyra = window.Lyra || {};

  function nameFallback(fileName) {
    const base = String(fileName || "Unknown").replace(/\.[^.]+$/, "");
    return base.replace(/_/g, " ").trim() || "Unknown";
  }

  function readTags(file) {
    return new Promise((resolve) => {
      const fallback = {
        title: nameFallback(file.name),
        artist: "Unknown Artist",
        album: "Unknown Album",
        art: null,
      };
      try {
        if (!window.jsmediatags) return resolve(fallback);
        window.jsmediatags.read(file, {
          onSuccess(result) {
            try {
              const tags = result.tags || {};
              let art = null;
              if (tags.picture && tags.picture.data && tags.picture.data.length) {
                const format = tags.picture.format || "image/jpeg";
                art = new Blob([new Uint8Array(tags.picture.data)], { type: format });
              }
              resolve({
                title: (tags.title || "").trim() || fallback.title,
                artist: (tags.artist || "").trim() || fallback.artist,
                album: (tags.album || "").trim() || fallback.album,
                art,
              });
            } catch (e) {
              resolve(fallback);
            }
          },
          onError() {
            resolve(fallback);
          },
        });
      } catch (e) {
        resolve(fallback);
      }
    });
  }

  function readDuration(blob) {
    return new Promise((resolve) => {
      let url;
      try {
        url = URL.createObjectURL(blob);
        const a = new Audio();
        const done = (secs) => {
          URL.revokeObjectURL(url);
          resolve(secs);
        };
        a.preload = "metadata";
        a.onloadedmetadata = () => {
          const d = a.duration;
          done(Number.isFinite(d) ? d : 0);
        };
        a.onerror = () => done(0);
        a.src = url;
      } catch (e) {
        if (url) URL.revokeObjectURL(url);
        resolve(0);
      }
    });
  }

  window.Lyra.id3 = { readTags, readDuration, nameFallback };
})();
