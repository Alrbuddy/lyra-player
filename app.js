/* Lyra.app — UI, routing, screens, import, backup, lyrics. */
(function () {
  "use strict";
  window.Lyra = window.Lyra || {};

  const APP_VERSION = "1.4.20";
  const db = window.Lyra.db;
  const player = window.Lyra.player;

  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function fmtTime(s) {
    s = Math.max(0, Math.round(s || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function fmtTotal(s) {
    s = Math.round(s || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return h + " hr " + m + " min";
    return m + " min " + (s % 60) + " sec";
  }

  const NOTE_SVG = '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/></svg>';
  const HEART_SVG = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.7-10-9.3C.4 8.6 2.3 4.5 6.2 4.5c2.3 0 3.9 1.3 4.8 2.6.9-1.3 2.5-2.6 4.8-2.6 3.9 0 5.8 4.1 4.2 7.2C19.5 16.3 12 21 12 21z"/></svg>';
  const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>';
  const PAUSE_SVG = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
  const SHUFFLE_SVG = '<svg viewBox="0 0 24 24"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>';
  const REPEAT_SVG = '<svg viewBox="0 0 24 24"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>';
  const REPEAT_ONE_SVG = '<svg viewBox="0 0 24 24"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><text x="12" y="15" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">1</text></svg>';
  const DOTS_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/></svg>';
  const GEAR_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>';
  const PLUS_SVG = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
  const BACK_SVG = '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>';
  const UP_SVG = '<svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"/></svg>';
  const DOWN_SVG = '<svg viewBox="0 0 24 24"><path d="m6 10 6 6 6-6"/></svg>';
  const X_SVG = '<svg viewBox="0 0 24 24"><path d="M6 6 18 18M18 6 6 18"/></svg>';

  function setHeartState(btn, track) {
    btn.dataset.like = track ? track.id : "";
    btn.classList.toggle("liked", !!(track && track.liked));
  }

  // ---------- Art + color caches ----------
  const artUrlCache = new Map();
  function artUrl(track) {
    if (!track || !track.art) return null;
    if (!artUrlCache.has(track.id)) artUrlCache.set(track.id, URL.createObjectURL(track.art));
    return artUrlCache.get(track.id);
  }

  // Most downloaded files carry no artwork, and a wall of identical grey boxes
  // reads as broken. Instead every cover-less song gets its own sleeve: the
  // first letter of its title over a deep gradient picked from that title, so
  // one track always looks the same and a list looks like a row of records.
  // The letter lives in an SVG so it scales with the box at any size.
  const PH_PALETTE = [
    ["#1d4d38", "#0e1512", "#1ed760"],
    ["#16414a", "#0c1416", "#35d6c4"],
    ["#242d52", "#0e1119", "#7c8cff"],
    ["#3a2450", "#130f1c", "#b47cff"],
    ["#4a3520", "#16110b", "#f0a94e"],
    ["#4a2433", "#170f13", "#ff7a9a"],
    ["#2b3a42", "#0e1315", "#9fb4be"],
    ["#33401f", "#11140d", "#b8d96a"],
  ];
  function seedOf(text) {
    let h = 0;
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function monogram(name) {
    const m = String(name || "").match(/[a-z0-9]/i);
    return m ? m[0].toUpperCase() : "?";
  }
  function phHTML(name, style) {
    const seed = seedOf(name) % PH_PALETTE.length;
    const p = PH_PALETTE[seed];
    const s = style ? style.replace(/\s*;?\s*$/, ";") : "";
    return `<div class="art-ph" data-ph="${seed}" style="${s}--ph-a:${p[0]};--ph-b:${p[1]};--ph-t:${p[2]}">` +
      `<svg class="ph-glyph" viewBox="0 0 100 100" aria-hidden="true">` +
      `<text x="50" y="50" dy="0.34em" text-anchor="middle" font-size="44" font-weight="800" letter-spacing="-2" fill="rgba(255,255,255,.9)">${esc(monogram(name))}</text>` +
      `</svg></div>`;
  }

  function artHTML(track, style) {
    const u = artUrl(track);
    if (u) return `<img class="art" style="${style || ""}" src="${u}" alt="" draggable="false">`;
    return phHTML(track && track.title, style);
  }

  const colorCache = new Map();
  function dominantColor(track) {
    if (!track) return Promise.resolve([18, 94, 44]);
    if (colorCache.has(track.id)) return colorCache.get(track.id);
    const p = new Promise((resolve) => {
      const u = artUrl(track);
      if (!u) return resolve([18, 94, 44]);
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = c.height = 8;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, 8, 8);
          const d = ctx.getImageData(0, 0, 8, 8).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 128) continue;
            r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
          }
          if (!n) return resolve([18, 94, 44]);
          resolve([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
        } catch (e) { resolve([18, 94, 44]); }
      };
      img.onerror = () => resolve([18, 94, 44]);
      img.src = u;
    });
    colorCache.set(track.id, p);
    return p;
  }

  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  // ---------- Data cache ----------
  let tracks = [];
  let playlists = [];

  async function refreshData() {
    [tracks, playlists] = await Promise.all([db.getAllTracks(), db.getAllPlaylists()]);
    recomputeAlbumKeys();
    // Screens built from the library are now stale; they rebuild when next shown.
    for (const v of DATA_VIEWS) dirtyViews.add(v);
  }

  // Album keys that count as real albums (recomputed whenever the library changes,
  // so listing songs does not rescan every track for every row).
  let realAlbumKeys = new Set();
  function recomputeAlbumKeys() {
    const counts = new Map();
    for (const t of tracks) {
      const name = albumName(t);
      if (!name) continue;
      const key = name.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    realAlbumKeys = new Set();
    counts.forEach((n, key) => { if (n >= 2) realAlbumKeys.add(key); });
  }

  // ---------- Artists & albums ----------
  // Downloaded files have unreliable tags: "Unknown Artist", or the same name
  // padded/cased differently per file. Group on a normalized key and show the
  // spelling you set yourself, otherwise the most common one.
  const UNKNOWN_ARTIST = "Unknown Artist";
  const UNKNOWN_ALBUM = "Unknown Album";

  function tagName(v) { return String(v == null ? "" : v).trim(); }

  function pickDisplayName(counts, fallback) {
    let best = fallback, bestCount = 0;
    counts.forEach((n, name) => {
      if (n > bestCount || (n === bestCount && name.localeCompare(best) < 0)) {
        best = name;
        bestCount = n;
      }
    });
    return best;
  }

  // "Unknown Album" and empty are the same thing: no album.
  function albumName(t) {
    const name = tagName(t && t.album);
    if (!name || name.toLowerCase() === UNKNOWN_ALBUM.toLowerCase()) return "";
    return name;
  }

  function groupTracks(list, nameOf, manualFlag) {
    const map = new Map();
    for (const t of list) {
      const name = nameOf(t);
      const key = name.toLowerCase();
      let g = map.get(key);
      if (!g) map.set(key, (g = { key, names: new Map(), tracks: [], manual: "" }));
      g.tracks.push(t);
      g.names.set(name, (g.names.get(name) || 0) + 1);
      if (manualFlag && t[manualFlag]) g.manual = name;
    }
    return [...map.values()].map((g) => ({
      key: g.key,
      // A name you typed yourself wins over whatever the dominant tag spelling is.
      name: g.manual || pickDisplayName(g.names, [...g.names.keys()][0] || ""),
      tracks: g.tracks,
    }));
  }

  function artistOf(t) { return tagName(t && t.artist) || UNKNOWN_ARTIST; }

  function artistsOf(list) {
    return groupTracks(list, artistOf, "artistManual").sort((a, b) => a.name.localeCompare(b.name));
  }

  // One song is not a shelf: an artist only gets a row once two or more of
  // their songs are in the library. The songs themselves still carry the name,
  // so nothing about the music changes — the artist simply appears as soon as
  // a second song joins them.
  function listedArtists(list) {
    return artistsOf(list).filter((a) => a.tracks.length >= 2);
  }

  // One song with a stray album tag is not an album — showing those made a
  // duplicate single-song album per download. An album counts only when at
  // least two songs share the name, whether the tag came from the file or from
  // you: naming an album on a single song stores the tag but shows nothing
  // until a second song matches it.
  function albumsOf(list) {
    return groupTracks(list.filter((t) => albumName(t)), albumName, "albumManual")
      .filter((g) => g.tracks.length >= 2)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function isRealAlbum(t) {
    const name = albumName(t);
    return !!name && realAlbumKeys.has(name.toLowerCase());
  }

  // ---------- Router ----------
  let route = { view: "home", params: {} };
  const historyStack = [];

  // ---------- Screens ----------
  // Each tab keeps its own host element inside #view, so switching tabs is a
  // visibility flip instead of a rebuild of thousands of nodes. A host is only
  // rebuilt when its data changed or when it is entered fresh; its scroll
  // offset is remembered so coming back lands where you left off.
  const SCREEN_KEYS = ["home", "search", "library", "import", "settings", "detail"];
  // Views whose content depends on library data: rebuilt after a data change.
  const DATA_VIEWS = ["home", "search", "library"];
  const hosts = new Map();
  const dirtyViews = new Set();
  const scrollByView = {};
  let activeKey = null;

  function screenKey(view) {
    return view === "detail" ? "detail" : view;
  }

  function ensureHost(key) {
    const shell = $("#view");
    let host = hosts.get(key);
    if (host && host.isConnected && host.parentNode === shell) return host;
    host = document.createElement("div");
    host.className = "screen-host";
    host.dataset.screen = key;
    host.hidden = true;
    shell.appendChild(host);
    hosts.set(key, host);
    return host;
  }

  function showOnly(key) {
    for (const k of SCREEN_KEYS) {
      const host = hosts.get(k);
      if (host) host.hidden = k !== key;
    }
  }

  // Liquid-glass tab highlight: slide the pill to the active tab.
  function positionTabPill() {
    const pill = $("#tab-pill");
    if (!pill) return;
    const i = Array.from(document.querySelectorAll(".nav-btn"))
      .findIndex((b) => b.classList.contains("on"));
    pill.classList.toggle("off", i < 0);
    if (i >= 0) pill.style.transform = `translateX(${i * 100}%)`;
  }

  function applyChrome() {
    document.querySelectorAll(".nav-btn").forEach((b) =>
      b.classList.toggle("on", b.dataset.tab === route.view));
    positionTabPill();
  }

  function viewHTML(view) {
    if (view === "home") return viewHome();
    if (view === "search") return viewSearch();
    if (view === "library") return viewLibrary();
    if (view === "import") return viewImport();
    if (view === "settings") return viewSettings();
    return viewDetail(route.params);
  }

  function go(view, params, push) {
    if (push !== false && route.view !== view) historyStack.push(route);
    route = { view, params: params || {} };
    showView();
  }

  function back() {
    const prev = historyStack.pop();
    route = prev || { view: "home", params: {} };
    showView();
  }

  // Enter a view. A clean cached screen is shown as-is; anything stale, new or
  // route-dependent (a detail page) is rebuilt.
  // Restart a one-shot CSS animation. Removing the class, forcing a style
  // flush and adding it again is what makes it replay on a reused element.
  // Restart a one-shot animation on an element (same flush trick as above).
  function pulseClass(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function playScreenIn(host, rows) {
    if (!host) return;
    host.classList.remove("screen-in", "rows-in");
    void host.offsetWidth;
    host.classList.add("screen-in");
    if (rows) host.classList.add("rows-in");
    clearTimeout(host._inTimer);
    host._inTimer = setTimeout(() => host.classList.remove("screen-in", "rows-in"), 700);
  }

  function showView() {
    const key = screenKey(route.view);
    const shell = $("#view");
    const host = hosts.get(key);
    // Settings reads live device numbers every time it opens.
    if (!host || dirtyViews.has(key) || key === "detail" || key === "settings") {
      render({ rows: true });
      return;
    }
    if (activeKey) scrollByView[activeKey] = shell.scrollTop;
    showOnly(key);
    activeKey = key;
    applyChrome();
    shell.scrollTop = scrollByView[key] || 0;
    // A cached screen fades in but its rows are not rebuilt, so they stay put.
    playScreenIn(host, false);
  }

  // Re-render the active view in place. Keeps the scroll offset unless asked
  // for the top, so a data refresh never throws the reader back to the start.
  function render(opts) {
    opts = opts || {};
    const shell = $("#view");
    const key = screenKey(route.view);
    const host = ensureHost(key);
    if (activeKey) scrollByView[activeKey] = shell.scrollTop;
    // opts.keep holds the reader's place — a save (album, artist, lyrics) must
    // not throw you back to the top of a long list.
    const kept = opts.keep ? shell.scrollTop : null;
    const restore = kept != null ? kept : opts.top ? 0 : key === "detail" ? 0 : scrollByView[key] || 0;
    host.innerHTML = viewHTML(route.view);
    bindView(route.view, host);
    showOnly(key);
    activeKey = key;
    dirtyViews.delete(key);
    applyChrome();
    shell.scrollTop = restore;
    if (kept != null) scrollByView[key] = restore;
    // A selection bar is tall, and a toast must land above it rather than on
    // top of its buttons.
    document.body.classList.toggle("has-bulk", !!(selecting || plSelecting));
    // Local updates (a checkbox, a saved edit) and player-driven redraws must
    // not replay the entrance: only an actual screen entry animates.
    if (!opts.keep && !opts.quiet) playScreenIn(host, opts.rows === true);
  }

  // ---------- Shared row ----------
  function songRow(t, opts) {
    opts = opts || {};
    const st = player.state();
    const isCur = st.track && st.track.id === t.id;
    const eq = isCur
      ? `<span class="eq ${st.playing ? "" : "paused"}"><i></i><i></i><i></i></span>`
      : "";
    const check = opts.selecting
      ? `<span class="checkbox ${opts.selected && opts.selected.has(t.id) ? "on" : ""}"></span>` : "";
    const dots = opts.selecting ? "" :
      `<button class="icon-btn row-dots" data-dots="${t.id}" aria-label="More">${DOTS_SVG}</button>`;
    return `<div class="song-row press" data-play-track="${t.id}" role="button" tabindex="0">
      ${check}${artHTML(t)}
      <div class="song-info">
        <div class="song-title ${isCur ? "playing" : ""}">${esc(t.title)}</div>
        <div class="song-sub">${esc(artistOf(t))}${isRealAlbum(t) ? " • " + esc(albumName(t)) : ""}</div>
      </div>
      ${eq}
      <div class="song-meta"><span>${fmtTime(t.duration)}</span><span>${t.plays || 0} plays</span></div>
      ${dots}
    </div>`;
  }

  function likedTile(cls) {
    return `<div class="art-heart ${cls || ""}" style="width:56px;height:56px;border-radius:8px 0 0 8px">${HEART_SVG}</div>`;
  }

  // ---------- Home ----------
  function viewHome() {
    const h = new Date().getHours();
    const greet = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    if (!tracks.length) {
      return `<div class="screen">
        <div class="row-between"><h1 class="h-greeting">${greet}</h1>
          <button class="icon-btn" data-go="settings" aria-label="Settings">${GEAR_SVG}</button></div>
        <div class="empty">
          <div class="big">Your library is empty</div>
          <div class="small">Import songs from the Files app to get started.</div>
          <button class="btn primary" data-go="import">Import music</button>
        </div></div>`;
    }

    const recentPlaylists = playlists.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
    const likedCount = tracks.filter((t) => t.liked).length;
    const tiles = [`<button class="tile" data-detail-kind="liked" data-detail-val="">${likedTile()}<span class="tile-name">Liked Songs</span></button>`]
      .concat(recentPlaylists.map((p) => {
        const cover = tracks.find((t) => p.trackIds.includes(t.id) && t.art);
        return `<button class="tile" data-detail-kind="playlist" data-detail-val="${p.id}">${cover ? artHTML(cover, "width:56px;height:56px;border-radius:8px 0 0 8px") : phHTML(p.name, "width:56px;height:56px;border-radius:8px 0 0 8px")}<span class="tile-name">${esc(p.name)}</span></button>`;
      })).join("");

    const recentPlayed = tracks.filter((t) => t.lastPlayedAt).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt).slice(0, 10);
    const recentAdded = tracks.slice().sort((a, b) => b.addedAt - a.addedAt).slice(0, 10);
    const mostPlayed = tracks.filter((t) => t.plays > 0).sort((a, b) => b.plays - a.plays).slice(0, 10);
    const albums = albumsOf(tracks);

    const card = (t, sub) => `<button class="card" data-play-one="${t.id}">${artHTML(t, "width:128px;height:128px")}<div class="card-title">${esc(t.title)}</div><div class="card-sub">${esc(sub)}</div></button>`;
    const albumCard = (a) => {
      const cover = a.tracks.find((t) => t.art) || a.tracks[0];
      return `<button class="card" data-detail-kind="album" data-detail-val="${esc(a.name)}">${artHTML(cover, "width:128px;height:128px")}<div class="card-title">${esc(a.name)}</div><div class="card-sub">${esc(a.tracks[0].artist)}</div></button>`;
    };
    const shelf = (title, items, id) => items.length
      ? `<div class="shelf"${id ? ` id="${id}"` : ""}><h2 class="h-section">${title}</h2><div class="shelf-row">${items}</div></div>` : "";

    return `<div class="screen">
      <div class="row-between"><h1 class="h-greeting">${greet}</h1>
        <button class="icon-btn" data-go="settings" aria-label="Settings">${GEAR_SVG}</button></div>
      <div class="chips" id="home-chips">
        <button class="chip on" data-chip="all">All</button>
        <button class="chip" data-chip="songs">Songs</button>
        <button class="chip" data-chip="albums">Albums</button>
      </div>
      <div class="tiles" id="home-tiles">${tiles}</div>
      <div id="home-shelves">
        ${shelf("Recently played", recentPlayed.map((t) => card(t, t.artist)).join(""))}
        ${shelf("Recently added", recentAdded.map((t) => card(t, t.artist)).join(""))}
        ${shelf("Most played", mostPlayed.map((t) => card(t, (t.plays || 0) + " plays")).join(""))}
        ${shelf("Your albums", albums.map(albumCard).join(""), "shelf-albums")}
      </div></div>`;
  }

  // ---------- Search ----------
  let searchQuery = "";

  function searchResults(q) {
    q = q.trim().toLowerCase();
    if (!q) return null;
    const match = (t) =>
      (t.title || "").toLowerCase().includes(q) ||
      (t.artist || "").toLowerCase().includes(q) ||
      (t.album || "").toLowerCase().includes(q) ||
      (t.lyrics || "").toLowerCase().includes(q);
    return {
      tracks: tracks.filter(match),
      playlists: playlists.filter((p) => p.name.toLowerCase().includes(q)),
    };
  }

  const BROWSE_TILES = [
    { key: "songs", label: "Songs", color: "#8400e7" },
    { key: "albums", label: "Albums", color: "#1e3264" },
    { key: "artists", label: "Artists", color: "#ba5d07" },
    { key: "playlists", label: "Playlists", color: "#0d73ec" },
    { key: "liked", label: "Liked", color: "#dc148c" },
    { key: "never", label: "Never played", color: "#477d95" },
  ];

  function viewSearch() {
    const res = searchResults(searchQuery);
    const browse = BROWSE_TILES.map((b) => {
      const t = tracks.find((x) => x.art);
      return `<button class="browse-tile" style="background:${b.color}" data-browse="${b.key}">
        ${esc(b.label)}${t ? artHTML(t) : `<div class="art-ph">${NOTE_SVG}</div>`}</button>`;
    }).join("");

    let body;
    if (!res) {
      body = `<h2 class="h-section">Browse all</h2><div class="browse">${browse}</div>`;
    } else {
      const rows = res.tracks.map((t) =>
        songRow(t).replace(`<div class="song-sub">${esc(t.artist)}`, `<div class="song-sub">Song • ${esc(t.artist)}`)
      ).join("");
      const pls = res.playlists.map((p) =>
        `<button class="sheet-item" data-detail-kind="playlist" data-detail-val="${p.id}">${NOTE_SVG}${esc(p.name)} • Playlist</button>`).join("");
      body = rows + pls || `<div class="empty"><div class="big">No results</div><div class="small">Try a different search — songs, albums, artists, playlists, or lyrics.</div></div>`;
      if (!rows && !pls) body = `<div class="empty"><div class="big">No results</div><div class="small">Try a different search — songs, albums, artists, playlists, or lyrics.</div></div>`;
    }

    return `<div class="screen">
      <h1 class="h-screen">Search</h1>
      <div class="searchbar">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="search-input" type="search" placeholder="Songs, albums, artists, lyrics…" value="${esc(searchQuery)}" enterkeyhint="search">
      </div>
      <div id="search-body">${body}</div></div>`;
  }

  // ---------- Library ----------
  let libFilter = "songs";
  let libGrid = false;
  let selecting = false;
  let selected = new Set();
  // Playlists have their own selection so choosing songs never mixes with them.
  let plSelecting = false;
  let plSelected = new Set();
  let libSort = "recent"; // recent | title | artist | plays
  const SORT_LABELS = { recent: "Recents", title: "Title A–Z", artist: "Artist A–Z", plays: "Most played" };

  function sortKeyOf(t) {
    const name = libSort === "artist" ? artistOf(t) : t.title;
    return String(name || "").toUpperCase();
  }

  function sortedTracks() {
    const list = tracks.slice();
    const byTitle = (a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
    if (libSort === "title") return list.sort(byTitle);
    if (libSort === "artist") {
      return list.sort((a, b) => String(artistOf(a)).localeCompare(String(artistOf(b)), undefined, { sensitivity: "base" }) || byTitle(a, b));
    }
    if (libSort === "plays") return list.sort((a, b) => (b.plays || 0) - (a.plays || 0) || byTitle(a, b));
    return list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  // Letters that actually start a group in the current order, for the jump strip.
  function sortLetters(list) {
    const seen = [];
    for (const t of list) {
      const c = sortKeyOf(t)[0];
      if (c && /[A-Z0-9]/.test(c) && seen[seen.length - 1] !== c) seen.push(c);
    }
    return [...new Set(seen)].sort();
  }

  function openSortSheet() {
    openSheet(`<div class="sheet-title">Sort songs</div>` +
      Object.keys(SORT_LABELS).map((k) =>
        `<button class="sheet-item" data-sort="${k}"><span style="flex:1;text-align:left">${SORT_LABELS[k]}</span>${libSort === k ? "✓" : ""}</button>`).join(""));
    $("#sheet").querySelectorAll("[data-sort]").forEach((b) => (b.onclick = async () => {
      libSort = b.dataset.sort;
      closeSheet();
      try { await db.setSetting("libSort", libSort); } catch (e) { /* private mode */ }
      render({ top: true, rows: true });
      $("#view").scrollTo({ top: 0 });
    }));
  }

  function viewLibrary() {
    let body = "";
    if (libFilter === "songs") {
      const list = sortedTracks();
      body = list.length
        ? list.map((t) => songRow(t, { selecting, selected })).join("")
        : `<div class="empty"><div class="big">No songs yet</div><div class="small">Import some music first.</div></div>`;
    } else if (libFilter === "playlists") {
      const tiles = playlists.map((p) => {
        const cover = tracks.find((t) => p.trackIds.includes(t.id) && t.art);
        const on = plSelected.has(p.id);
        // While selecting, a tile is a checkbox instead of a link; otherwise it
        // opens the playlist and a long press offers to delete it.
        const attrs = plSelecting
          ? `data-pl-tile="${p.id}"`
          : `data-detail-kind="playlist" data-detail-val="${p.id}" data-hold-pl="${p.id}"`;
        return `<button class="tile press" style="width:100%;margin-bottom:8px" ${attrs}>
          ${plSelecting ? `<span class="checkbox${on ? " on" : ""}" style="margin-left:12px"></span>` : ""}
          ${cover ? artHTML(cover, "width:56px;height:56px;border-radius:8px 0 0 8px") : phHTML(p.name, "width:56px;height:56px;border-radius:8px 0 0 8px")}
          <span class="tile-name">${esc(p.name)}</span><span class="dim" style="margin-left:auto;padding-right:10px;font-weight:400">${p.trackIds.length} songs</span></button>`;
      }).join("");
      body = `<button class="tile" style="width:100%;margin-bottom:8px" data-detail-kind="liked" data-detail-val="">${likedTile()}<span class="tile-name">Liked Songs</span></button>` +
        (tiles || `<div class="empty"><div class="big">No playlists</div><div class="small">Tap + to create one.</div></div>`);
    } else if (libFilter === "albums") {
      const albs = albumsOf(tracks);
      body = `<div class="browse">` + albs.map((a) => {
        const cover = a.tracks.find((t) => t.art) || a.tracks[0];
        return `<button class="browse-tile" style="background:var(--surface)" data-detail-kind="album" data-detail-val="${esc(a.name)}">
          ${artHTML(cover, "position:static;transform:none;box-shadow:none;width:100%;height:52px;object-fit:cover;border-radius:6px;margin-bottom:6px")}
          <div style="font-size:13px">${esc(a.name)}</div></button>`;
      }).join("") + `</div>`;
    } else if (libFilter === "artists") {
      const artists = listedArtists(tracks);
      body = artists.length ? artists.map((a) =>
        `<button class="sheet-item" data-detail-kind="artist" data-detail-val="${esc(a.name)}">
          <span class="avatar">${esc(a.name[0] || "?").toUpperCase()}</span>
          ${esc(a.name)}<span class="dim" style="margin-left:auto">${a.tracks.length} songs</span></button>`).join("")
        : `<div class="empty"><div class="big">No artists yet</div><div class="small">An artist shows up once two or more of their songs are here.</div></div>`;
    }

    const none = selected.size === 0;
    const bulk = libFilter === "playlists"
      ? (plSelecting
        ? `<div class="bulk-bar glass">
            <span id="bulk-count">${plSelected.size} selected</span>
            <button class="btn danger" id="bulk-pl-del"${plSelected.size ? "" : " disabled"}>Delete</button>
          </div>` : "")
      : selecting
      ? `<div class="bulk-bar glass">
          <span id="bulk-count">${selected.size} selected</span>
          <button class="btn ghost" id="bulk-add"${none ? " disabled" : ""}>Add to playlist</button>
          <button class="btn ghost" id="bulk-edit"${none ? " disabled" : ""}>Edit</button>
          <button class="btn danger" id="bulk-del"${none ? " disabled" : ""}>Delete</button>
        </div>` : "";

    return `<div class="screen">
      <div class="row-between">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <span class="avatar">L</span><h1 class="h-screen" style="margin:0;white-space:nowrap">Your Library</h1>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex:none">
          ${libFilter === "songs" || libFilter === "playlists"
            ? `<button class="btn ghost lib-select-btn" id="lib-select">${(libFilter === "songs" ? selecting : plSelecting) ? "Done" : "Select"}</button>` : ""}
          <button class="icon-btn" id="lib-plus" aria-label="Add">${PLUS_SVG}</button>
        </div>
      </div>
      <div class="chips">
        ${["songs", "playlists", "albums", "artists"].map((f) =>
          `<button class="chip ${libFilter === f ? "on" : ""}" data-libfilter="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}
      </div>
      <div class="row-between" style="margin-bottom:4px">
        ${libFilter === "songs"
          ? `<button class="chip" id="lib-sort" style="background:none;color:var(--text-dim);padding-left:0">${SORT_LABELS[libSort]} ▾</button>`
          : `<span></span>`}
        <div style="display:flex;gap:2px">
          <button class="icon-btn" id="lib-toggle" aria-label="Toggle list or grid">
            <svg viewBox="0 0 24 24">${libGrid ? '<path d="M4 6h16M4 12h16M4 18h16"/>' : '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'}</svg>
          </button>
        </div>
      </div>
      ${libFilter === "songs" && libSort !== "recent" && sortedTracks().length > 11
        ? `<div class="az-strip" id="az-strip">${sortLetters(sortedTracks()).map((c) => `<button class="az-btn" data-letter="${c}">${c}</button>`).join("")}</div>`
        : ""}
      <div id="lib-body" class="${libGrid && libFilter === "songs" ? "tiles" : ""}">${body}</div>
      ${bulk}</div>`;
  }

  // ---------- Import ----------
  function viewImport() {
    return `<div class="screen">
      <h1 class="h-screen">Import</h1>
      <button class="big-card" id="imp-files">
        <span class="ic"><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg></span>
        <span class="t">Files</span>
        <span class="d">Import tracks from your phone. Pick one or many audio files from the Files app.</span>
      </button>
      <button class="link-btn" id="imp-files-all">Songs greyed out in the picker? Browse all files</button>
      <button class="big-card" id="imp-computer">
        <span class="ic"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg></span>
        <span class="t">From my computer</span>
        <span class="d">How to move songs from a PC or Mac onto this phone.</span>
      </button>
      <button class="big-card" id="imp-restore">
        <span class="ic"><svg viewBox="0 0 24 24"><path d="M12 15V3m0 12 4-4m-4 4-4-4" transform="rotate(180 12 9)"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg></span>
        <span class="t">Restore backup</span>
        <span class="d">Bring back playlists, likes, lyrics, and play counts from a Lyra backup file.</span>
      </button>
      <div id="import-out"></div></div>`;
  }

  const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aiff|aif|weba)$/i;

  function isAudioFile(file) {
    if (/^audio\//.test(file.type)) return true;
    // iOS often reports no type (or video/mp4 for .m4a) — trust the extension
    return AUDIO_EXT.test(file.name);
  }

  const normText = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

  // A file that looks like a song already in the library: same title, same
  // artist (tag or your edit), and a length within two seconds.
  function findDuplicate(staged) {
    const title = normText(staged.tags.title);
    const artist = normText(staged.tags.artist);
    const dur = Number(staged.duration) || 0;
    if (!title) return null;
    return tracks.find((t) => {
      if (normText(t.title) !== title) return false;
      if (dur && t.duration && Math.abs(t.duration - dur) > 2) return false;
      if (!artist) return true;
      return normText(t.artist) === artist || normText(artistOf(t)) === artist;
    }) || null;
  }

  // "skip" keeps only the new songs, "all" imports the duplicates too.
  function duplicateSheet(dupes, total) {
    return new Promise((resolve) => {
      openSheet(`<div class="sheet-title">Already in your library</div>
        <div style="padding:0 14px 8px;color:var(--text-dim);font-size:14px;line-height:1.5">
          ${dupes.length} of ${total} looked like songs you already have.
        </div>
        <div class="queue-list">${dupes.slice(0, 6).map((d) =>
          `<div class="q-row"><div class="song-info"><div class="song-title">${esc(d.tags.title)}</div><div class="song-sub">${esc(d.tags.artist || "")}</div></div></div>`).join("")}
          ${dupes.length > 6 ? `<div class="q-more">+${dupes.length - 6} more</div>` : ""}</div>
        <div class="sheet-actions" style="flex-direction:column;gap:8px">
          <button class="btn primary" id="dup-skip" style="width:100%">Skip the duplicates</button>
          <button class="btn ghost" id="dup-all" style="width:100%">Import everything</button>
        </div>`);
      const done = (mode) => { closeSheet(); resolve(mode); };
      $("#dup-skip").onclick = () => done("skip");
      $("#dup-all").onclick = () => done("all");
    });
  }

  async function importFiles(fileList) {
    const out = $("#import-out");
    const files = [...fileList];
    if (!files.length) return;
    let imported = 0, skipped = 0;
    if (out) out.innerHTML = `<div class="import-progress" id="imp-prog"></div>`;
    const prog = $("#imp-prog");
    const line = (txt, status) => {
      if (prog) prog.insertAdjacentHTML("beforeend",
        `<div class="import-line"><span>${esc(txt)}</span><span class="${status === "added" ? "ok" : "bad"}">${status}</span></div>`);
    };

    // Read every file's tags first so duplicates can be spotted before a
    // second copy of the same song lands in the library.
    const staged = [];
    for (const file of files) {
      if (!isAudioFile(file)) { skipped++; line(file.name, "not audio"); continue; }
      try {
        const [tags, duration] = await Promise.all([
          window.Lyra.id3.readTags(file),
          window.Lyra.id3.readDuration(file),
        ]);
        staged.push({ file, tags, duration: duration || 0 });
      } catch (e) {
        skipped++; line(file.name, "couldn't read");
      }
    }

    const dupes = staged.filter((s) => findDuplicate(s));
    let mode = "all";
    if (dupes.length) {
      mode = await duplicateSheet(dupes, staged.length);
      if (!mode) return;
    }

    let persisted = false;
    for (const s of staged) {
      if (mode === "skip" && findDuplicate(s)) {
        skipped++;
        line(s.tags.title + " — already in library", "skipped");
        continue;
      }
      try {
        await db.addTrack({
          title: s.tags.title, artist: s.tags.artist, album: s.tags.album,
          duration: s.duration, addedAt: Date.now(),
          plays: 0, liked: false, lyrics: "",
          art: s.tags.art, audio: s.file,
        });
        imported++;
        line(s.tags.title, "added");
        if (!persisted) {
          persisted = true;
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        }
      } catch (e) {
        skipped++;
        line(s.file.name, "couldn't read");
      }
    }
    await refreshData();
    if (prog) prog.insertAdjacentHTML("beforeend",
      `<div class="import-summary">${imported} song${imported === 1 ? "" : "s"} imported${skipped ? `, ${skipped} skipped` : ""}</div>`);
    if (out && !imported) out.insertAdjacentHTML("afterbegin",
      `<div class="import-hint">Nothing was imported. If the picker would not let you select your songs, try “Browse all files”.</div>`);
    toast(`${imported} imported${skipped ? `, ${skipped} skipped` : ""}`);
    maybeBackupNudge();
  }

  // ---------- Settings ----------
  function viewSettings() {
    return `<div class="screen">
      <div class="row-between">
        <button class="icon-btn back-btn" data-back aria-label="Back">${BACK_SVG}</button>
        <h1 class="h-screen" style="margin:0">Settings</h1><span style="width:44px"></span>
      </div>
      <div class="set-row"><div><div class="l">Storage used</div><div class="s" id="set-storage">Calculating…</div></div></div>
      <button class="set-row" id="set-export" style="width:100%;text-align:left">
        <div><div class="l">Export backup</div><div class="s">Metadata, lyrics, playlists, likes, play counts. Audio files are not included.</div></div>
      </button>
      <button class="set-row" id="set-restore" style="width:100%;text-align:left">
        <div><div class="l">Restore backup</div><div class="s">Merge a backup into this library (matched by title, artist, duration).</div></div>
      </button>
      <div class="set-row"><div><div class="l">Last backup</div><div class="s" id="set-lastbackup">—</div></div></div>
      <div class="set-row">
        <div><div class="l">Lyrics auto-scroll</div><div class="s">Default for the lyrics view</div></div>
        <input type="checkbox" class="ios" id="set-autoscroll">
      </div>
      <button class="set-row" id="set-clear" style="width:100%;text-align:left">
        <div><div class="l" style="color:#ff6b6b">Clear library</div><div class="s">Delete every song, playlist, and setting on this device.</div></div>
      </button>
      <button class="set-row" id="set-update" style="width:100%;text-align:left">
        <div><div class="l">Check for updates</div><div class="s" id="set-update-sub">Downloads the newest build. Songs, playlists and lyrics stay on this device.</div></div>
      </button>
      <div class="set-row"><div><div class="l">Version</div><div class="s" id="set-version">Lyra ${APP_VERSION}</div></div></div>
      <div class="set-row"><div><div class="l">Display</div><div class="s" id="set-display">—</div></div></div>
      <div class="set-row">
        <div><div class="l">iPhone layout preview</div><div class="s">Pretends to be a Home Screen app (status bar and home indicator insets) so the floating bars can be checked in a browser. Changes nothing on your phone.</div></div>
        <input type="checkbox" class="ios" id="set-sim">
      </div>
    </div>`;
  }

  // ---------- Version / updates ----------
  // The installed build is the service worker cache on this device; the latest
  // build is the VERSION sw.js serves right now. They differ until the phone
  // picks up a deploy, which is what makes this line actually move.
  function versionLabel(installed, latest) {
    const parts = [`Lyra ${APP_VERSION}`];
    if (installed) parts.push(`build ${installed}`);
    if (installed && latest && latest !== installed) parts.push(`${latest} available`);
    return parts.join(" · ");
  }

  function newestVersion(list) {
    const num = (v) => parseInt(String(v).replace(/^v/, ""), 10) || 0;
    return list.slice().sort((a, b) => num(b) - num(a))[0] || "";
  }

  async function installedBuild() {
    if (!window.caches) return "";
    try {
      const keys = await caches.keys();
      return newestVersion(keys.filter((k) => k.indexOf("lyra-") === 0).map((k) => k.slice(5)));
    } catch (e) { return ""; }
  }

  async function latestBuild() {
    try {
      const res = await fetch("sw.js?build=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return "";
      const m = (await res.text()).match(/const VERSION\s*=\s*"([^"]+)"/);
      return m ? m[1] : "";
    } catch (e) { return ""; }
  }

  // "standalone" when Lyra runs from the Home Screen, "browser" in a normal
  // Safari tab or an in-app browser (where the strip at the bottom belongs to
  // the browser, not to us).
  function displayMode() {
    const mm = (q) => {
      try { return window.matchMedia && window.matchMedia(q).matches; } catch (e) { return false; }
    };
    if (mm("(display-mode: standalone)") || window.navigator.standalone === true) return "standalone";
    if (mm("(display-mode: fullscreen)")) return "fullscreen";
    if (mm("(display-mode: minimal-ui)")) return "minimal-ui";
    return "browser";
  }

  // Numbers to read off a screenshot when iOS lays the page out oddly.
  function fillDisplayInfo() {
    const el = $("#set-display");
    if (!el) return;
    const vv = window.visualViewport;
    const nav = $("#nav");
    const appH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-h")) || 0;
    const parts = [
      simIOS() ? "sim-ios" : displayMode(),
      "app " + Math.round(appH),
      "win " + window.innerHeight,
      vv ? "vv " + Math.round(vv.height) : "vv none",
      vv ? "top " + Math.round(vv.offsetTop) : "",
      "doc " + document.documentElement.clientHeight,
      "screen " + window.screen.height,
      nav ? "bar " + Math.round(nav.getBoundingClientRect().bottom) : "",
      "dpr " + window.devicePixelRatio,
    ];
    el.textContent = parts.filter(Boolean).join(" · ");
  }

  async function fillVersionInfo() {
    const label = $("#set-version");
    const sub = $("#set-update-sub");
    if (!label) return;
    const [installed, latest] = await Promise.all([installedBuild(), latestBuild()]);
    if (!document.body.contains(label)) return; // left Settings while fetching
    label.textContent = versionLabel(installed, latest);
    if (!sub) return;
    if (!latest) sub.textContent = "Couldn't reach the server — you may be offline.";
    else if (installed && latest !== installed) sub.textContent = `A newer build (${latest}) is ready — tap to update.`;
    else sub.textContent = "You're on the latest build. Songs, playlists and lyrics stay on this device.";
  }

  async function checkForUpdates() {
    if (!("serviceWorker" in navigator)) { location.reload(); return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        // Reloading while the new worker is still installing serves the old
        // cache again, so one tap seemed to do nothing. Wait for it to take
        // over (bounded, so an offline phone still reloads).
        const pending = reg.installing || reg.waiting;
        if (pending && pending.state !== "activated") {
          await new Promise((resolve) => {
            const done = () => resolve();
            pending.addEventListener("statechange", () => {
              if (pending.state === "activated" || pending.state === "redundant") done();
            });
            setTimeout(done, 5000);
          });
        }
      }
    } catch (e) { /* offline — the reload below still retries */ }
    location.reload();
  }

  async function fillStorageInfo() {
    const el = $("#set-storage");
    if (!el) return;
    try {
      const est = await navigator.storage.estimate();
      const used = (est.usage || 0) / 1048576;
      const quota = (est.quota || 0) / 1073741824;
      el.textContent = `${used.toFixed(1)} MB used of ~${quota.toFixed(1)} GB`;
    } catch (e) { el.textContent = "Unavailable"; }
  }

  // ---------- Backup ----------
  const BACKUP_KEY = "lastBackupAt";
  let nudgedThisSession = false;

  function backupLabel(at) {
    if (!at) return "Never — everything lives only on this device";
    const d = new Date(Number(at));
    return "Last saved " +
      d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  async function fillBackupInfo() {
    const el = $("#set-lastbackup");
    if (!el) return;
    const at = await db.getSetting(BACKUP_KEY).catch(() => 0);
    if (el.isConnected) el.textContent = backupLabel(at);
  }

  // A gentle reminder only when a library big enough to hurt has no recent
  // backup — the audio itself can never be recovered from one.
  function maybeBackupNudge() {
    if (nudgedThisSession) return;
    db.getSetting(BACKUP_KEY).then((at) => {
      const stale = !at || Date.now() - Number(at) > 14 * 86400000;
      if (!stale || tracks.length < 5 || nudgedThisSession) return;
      nudgedThisSession = true;
      setTimeout(() => toast("Tip: Settings → Export backup saves your lyrics and playlists"), 1400);
    }).catch(() => {});
  }

  async function exportBackup() {
    const data = {
      app: "lyra", version: 2, exportedAt: Date.now(),
      tracks: tracks.map((t) => ({
        title: t.title, artist: t.artist, album: t.album,
        // The names you typed in yourself, so a re-import after a reinstall
        // can be matched even when the file's own tags disagree.
        artistManual: t.artistManual || "", albumManual: t.albumManual || "",
        duration: t.duration || 0,
        liked: !!t.liked, plays: t.plays || 0,
        lyrics: t.lyrics || "", lyricsSynced: t.lyricsSynced || null,
        startAt: t.startAt || 0, endAt: t.endAt || 0,
        addedAt: t.addedAt || 0, lastPlayedAt: t.lastPlayedAt || 0,
      })),
      playlists: playlists.map((p) => ({
        name: p.name, createdAt: p.createdAt,
        tracks: p.trackIds.map((id) => tracks.find((t) => t.id === id)).filter(Boolean)
          .map((t) => ({
            title: t.title, artist: t.artist, artistManual: t.artistManual || "", duration: t.duration || 0,
          })),
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const file = new File([blob], "lyra-backup.json", { type: "application/json" });
    let saved = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Lyra backup" });
        saved = true;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    if (!saved) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "lyra-backup.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      saved = true;
    }
    if (!saved) return;
    await db.setSetting(BACKUP_KEY, Date.now()).catch(() => {});
    fillBackupInfo();
    toast("Backup saved (audio not included)");
  }

  // Match a saved song to one on this device: same title, same length within
  // two seconds, and a name shared between the file's tags and your edits.
  function restoreLookup(saved) {
    const title = normText(saved.title);
    const dur = Math.round(saved.duration || 0);
    const wanted = [saved.artist, saved.artistManual].filter(Boolean).map(normText);
    if (!title) return null;
    for (const t of tracks) {
      if (normText(t.title) !== title) continue;
      if (dur && t.duration && Math.abs(t.duration - dur) > 2) continue;
      const local = [t.artist, artistOf(t)].filter(Boolean).map(normText);
      if (!wanted.length || wanted.some((n) => local.includes(n))) return t;
    }
    return null;
  }

  async function restoreBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) {
      toast("That file is not a valid backup"); return;
    }
    if (!data || !Array.isArray(data.tracks)) {
      toast("That file is not a valid backup"); return;
    }
    let updated = 0, playlistsMade = 0;
    for (const bt of data.tracks) {
      const t = restoreLookup(bt);
      if (!t) continue;
      t.liked = !!bt.liked;
      t.plays = Math.max(t.plays || 0, bt.plays || 0);
      if (bt.lyrics) t.lyrics = bt.lyrics;
      if (bt.lyricsSynced) t.lyricsSynced = bt.lyricsSynced;
      if (bt.artistManual) t.artistManual = bt.artistManual;
      if (bt.albumManual) t.albumManual = bt.albumManual;
      if (bt.startAt) t.startAt = bt.startAt;
      if (bt.endAt) t.endAt = bt.endAt;
      if (bt.lastPlayedAt) t.lastPlayedAt = Math.max(t.lastPlayedAt || 0, bt.lastPlayedAt);
      await db.putTrack(t);
      updated++;
    }
    for (const bp of data.playlists || []) {
      if (playlists.some((p) => p.name === bp.name)) continue;
      const ids = (bp.tracks || []).map((k) => {
        const t = restoreLookup(k);
        return t ? t.id : null;
      }).filter((id) => id != null);
      await db.addPlaylist({ name: bp.name, trackIds: ids, createdAt: bp.createdAt || Date.now() });
      playlistsMade++;
    }
    await refreshData();
    render();
    toast(`Restored ${updated} tracks, ${playlistsMade} playlists`);
  }

  // ---------- Detail pages ----------
  function detailData(params) {
    if (params.kind === "playlist") {
      const p = playlists.find((x) => x.id === Number(params.id));
      if (!p) return null;
      return { title: p.name, list: p.trackIds.map((id) => tracks.find((t) => t.id === id)).filter(Boolean), pl: p };
    }
    if (params.kind === "album") {
      const key = String(params.name || "").toLowerCase();
      const list = tracks.filter((t) => albumName(t).toLowerCase() === key);
      return { title: params.name, list };
    }
    if (params.kind === "artist") {
      const key = String(params.name || "").toLowerCase();
      const list = tracks.filter((t) => artistOf(t).toLowerCase() === key);
      return { title: params.name, list };
    }
    if (params.kind === "liked") {
      return { title: "Liked Songs", list: tracks.filter((t) => t.liked) };
    }
    if (params.kind === "browse") {
      const map = {
        songs: () => ({ title: "Songs", list: sortedTracks() }),
        albums: () => ({ title: "Albums", list: [] }),
        artists: () => ({ title: "Artists", list: [] }),
        playlists: () => ({ title: "Playlists", list: [] }),
        liked: () => ({ title: "Liked Songs", list: tracks.filter((t) => t.liked) }),
        never: () => ({ title: "Never played", list: tracks.filter((t) => !t.plays) }),
      };
      return map[params.name] ? map[params.name]() : null;
    }
    return null;
  }

  function viewDetail(params) {
    // browse collections that are not track lists
    if (params.kind === "browse" && params.name === "albums") {
      return `<div class="screen">${detailHeader("Albums")}<div class="browse">${albumsOf(tracks).map((a) => {
        const cover = a.tracks.find((t) => t.art) || a.tracks[0];
        return `<button class="browse-tile" style="background:var(--surface)" data-detail-kind="album" data-detail-val="${esc(a.name)}">${artHTML(cover, "position:static;transform:none;box-shadow:none;width:100%;height:52px;object-fit:cover;border-radius:6px;margin-bottom:6px")}<div style="font-size:13px">${esc(a.name)}</div></button>`;
      }).join("")}</div></div>`;
    }
    if (params.kind === "browse" && params.name === "artists") {
      const artists = listedArtists(tracks);
      return `<div class="screen">${detailHeader("Artists")}${artists.map((a) =>
        `<button class="sheet-item" data-detail-kind="artist" data-detail-val="${esc(a.name)}"><span class="avatar">${esc(a.name[0] || "?").toUpperCase()}</span>${esc(a.name)}</button>`).join("") || `<div class="empty"><div class="big">No artists yet</div><div class="small">An artist shows up once two or more of their songs are here.</div></div>`}</div>`;
    }
    if (params.kind === "browse" && params.name === "playlists") {
      return `<div class="screen">${detailHeader("Playlists")}${playlists.map((p) =>
        `<button class="sheet-item" data-detail-kind="playlist" data-detail-val="${p.id}">${NOTE_SVG}${esc(p.name)}</button>`).join("") || '<div class="empty"><div class="big">No playlists</div></div>'}</div>`;
    }

    const d = detailData(params);
    if (!d) return `<div class="screen">${detailHeader("Not found")}</div>`;
    const total = d.list.reduce((s, t) => s + (t.duration || 0), 0);
    const rows = d.list.map((t) => songRow(t)).join("") ||
      `<div class="empty"><div class="big">Nothing here yet</div><div class="small">Add songs to see them here.</div></div>`;

    return `<div class="screen">
      ${detailHeader("")}
      <div class="detail-hero">
        <div class="detail-cover" id="detail-cover"></div>
        <div class="detail-title">${esc(d.title)}</div>
        <div class="detail-sub">${d.list.length} song${d.list.length === 1 ? "" : "s"} • ${fmtTotal(total)}</div>
        <div class="detail-actions">
          <button class="icon-btn" id="detail-like-all" aria-label="Like all">${HEART_SVG}</button>
          <button class="icon-btn" id="detail-shuffle" aria-label="Shuffle play">${SHUFFLE_SVG}</button>
          <button class="play-fab" id="detail-play" aria-label="Play">${PLAY_SVG}</button>
        </div>
      </div>
      <div id="detail-rows" data-detail-list>${rows}</div></div>`;
  }

  function detailHeader(title) {
    return `<div class="row-between">
      <button class="icon-btn back-btn" data-back aria-label="Back">${BACK_SVG}</button>
      <span style="font-weight:700">${esc(title)}</span><span style="width:44px"></span>
    </div>`;
  }

  async function paintDetailHero(params) {
    const d = detailData(params);
    const cover = $("#detail-cover");
    if (!d || !cover) return;
    const withArt = d.list.filter((t) => t.art);
    if (withArt.length >= 4) {
      cover.innerHTML = `<div class="collage">${withArt.slice(0, 4).map((t) => artHTML(t)).join("")}</div>`;
    } else {
      const first = withArt[0] || d.list[0];
      // An empty playlist has no song to borrow: use its own name.
      cover.innerHTML = first ? artHTML(first) : phHTML(d.title);
    }
    const c = await dominantColor(withArt[0] || d.list[0]);
    const hero = cover.closest(".detail-hero");
    if (hero) hero.style.background = `linear-gradient(180deg, ${rgba(c, 0.4)}, transparent 70%)`;
  }

  // ---------- Sheets ----------
  function openSheet(html) {
    $("#sheet").innerHTML = html;
    $("#sheet").classList.remove("hidden");
    $("#backdrop").classList.remove("hidden");
  }
  function closeSheet() {
    $("#sheet").classList.add("hidden");
    $("#backdrop").classList.add("hidden");
  }

  // ---------- Up next ----------
  function queueTrackFor(id) {
    const cur = player.state().track;
    if (cur && cur.id === id) return cur;
    return tracks.find((t) => t.id === id) || null;
  }

  function openQueue() {
    const st = player.state();
    if (!st.queue.length) { toast("Nothing queued yet"); return; }
    const rows = st.queue.map((id, i) => {
      const t = queueTrackFor(id);
      const isNow = !!(st.track && st.track.id === id);
      return `<div class="q-row${isNow ? " now" : ""}" data-q-play="${i}">
        ${t ? artHTML(t, "width:40px;height:40px") : `<div class="art-ph" style="width:40px;height:40px">${NOTE_SVG}</div>`}
        <div class="song-info">
          <div class="song-title">${esc(t ? t.title : "Unavailable")}</div>
          <div class="song-sub">${isNow ? "Playing now" : esc(t ? artistOf(t) : "")}</div>
        </div>
        <button class="icon-btn q-btn" data-q-up="${i}"${i === 0 ? " disabled" : ""} aria-label="Move up">${UP_SVG}</button>
        <button class="icon-btn q-btn" data-q-down="${i}"${i === st.queue.length - 1 ? " disabled" : ""} aria-label="Move down">${DOWN_SVG}</button>
        <button class="icon-btn q-btn q-del" data-q-del="${i}" aria-label="Remove from queue">${X_SVG}</button>
      </div>`;
    }).join("");

    openSheet(`<div class="sheet-title">Up next <span class="q-count">${st.queue.length} song${st.queue.length === 1 ? "" : "s"}</span></div>
      <div class="queue-list">${rows}</div>`);

    const sheet = $("#sheet");
    sheet.querySelectorAll("[data-q-play]").forEach((row) => (row.onclick = async (e) => {
      if (e.target.closest(".q-btn")) return;
      const i = Number(row.dataset.qPlay);
      closeSheet();
      if (player.state().index !== i) await player.playAt(i);
    }));
    sheet.querySelectorAll("[data-q-up]").forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const i = Number(b.dataset.qUp);
      player.queueMove(i, i - 1);
      openQueue();
    }));
    sheet.querySelectorAll("[data-q-down]").forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const i = Number(b.dataset.qDown);
      player.queueMove(i, i + 1);
      openQueue();
    }));
    sheet.querySelectorAll("[data-q-del]").forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      await player.queueRemove(Number(b.dataset.qDel));
      if (player.state().queue.length) openQueue(); else closeSheet();
    }));
  }

  function confirmSheet(title, body, okLabel, danger) {
    return new Promise((resolve) => {
      openSheet(`<div class="sheet-title">${esc(title)}</div>
        <div style="padding:0 12px 14px;color:var(--text-dim);font-size:14px">${esc(body)}</div>
        <div class="sheet-actions">
          <button class="btn ghost" id="sh-cancel">Cancel</button>
          <button class="btn ${danger ? "danger" : "primary"}" id="sh-ok">${esc(okLabel)}</button>
        </div>`);
      $("#sh-cancel").onclick = () => { closeSheet(); resolve(false); };
      $("#sh-ok").onclick = () => { closeSheet(); resolve(true); };
    });
  }

  function promptSheet(title, placeholder) {
    return new Promise((resolve) => {
      openSheet(`<div class="sheet-title">${esc(title)}</div>
        <div style="padding:0 12px"><input type="text" id="sh-input" placeholder="${esc(placeholder)}" autocomplete="off"></div>
        <div class="sheet-actions">
          <button class="btn ghost" id="sh-cancel">Cancel</button>
          <button class="btn primary" id="sh-ok">Save</button>
        </div>`);
      const input = $("#sh-input");
      input.focus();
      $("#sh-cancel").onclick = () => { closeSheet(); resolve(null); };
      $("#sh-ok").onclick = () => { closeSheet(); resolve(input.value.trim() || null); };
      input.onkeydown = (e) => { if (e.key === "Enter") $("#sh-ok").click(); };
    });
  }

  async function createPlaylist(name, ids) {
    const id = await db.addPlaylist({ name, trackIds: ids || [], createdAt: Date.now() });
    await refreshData();
    return id;
  }

  // Remove one playlist (held on its tile) or a whole selection. The songs are
  // never touched: a playlist is only a list of ids.
  async function deletePlaylistsSheet(target) {
    const ids = (Array.isArray(target) ? target : [target]).map(Number).filter((n) => !isNaN(n));
    const list = playlists.filter((p) => ids.includes(p.id));
    if (!list.length) return;
    const one = list.length === 1;
    const ok = await confirmSheet(
      one ? "Delete playlist" : `Delete ${list.length} playlists`,
      one
        ? `“${list[0].name}” will be removed. The songs stay in your library.`
        : `${list.length} playlists will be removed. The songs stay in your library.`,
      "Delete", true
    );
    if (!ok) return;
    for (const p of list) await db.deletePlaylist(p.id);
    plSelecting = false;
    plSelected.clear();
    // The open page may be the playlist that just went away.
    const openOne = route.view === "detail" && route.params.kind === "playlist" &&
      list.some((p) => p.id === Number(route.params.id));
    await refreshData();
    if (openOne) { back(); return; }
    render({ keep: true });
    toast(one ? "Playlist deleted" : `${list.length} playlists deleted`);
  }

  // Hold-to-act: a press that lasts HOLD_MS fires without waiting for the
  // release. The click that follows is swallowed by holdSuppress so the tile
  // does not also open, and sliding the finger cancels it (that is a scroll).
  const HOLD_MS = 550;
  let holdSuppress = 0;
  function bindHold(el, onHold) {
    let timer = 0, x0 = 0, y0 = 0;
    const clear = () => { if (timer) { clearTimeout(timer); timer = 0; } };
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      clear();
      x0 = e.clientX; y0 = e.clientY;
      timer = setTimeout(() => {
        timer = 0;
        holdSuppress = Date.now() + 800;
        onHold();
      }, HOLD_MS);
    });
    el.addEventListener("pointermove", (e) => {
      if (timer && (Math.abs(e.clientX - x0) > 9 || Math.abs(e.clientY - y0) > 9)) clear();
    }, { passive: true });
    el.addEventListener("pointerup", clear);
    el.addEventListener("pointercancel", clear);
    el.addEventListener("pointerleave", clear);
  }

  async function addToPlaylistSheet(ids) {
    if (!ids.length) return;
    const items = playlists.map((p) =>
      `<button class="sheet-item" data-pl="${p.id}">${NOTE_SVG}${esc(p.name)}<span class="dim" style="margin-left:auto">${p.trackIds.length}</span></button>`).join("");
    openSheet(`<div class="sheet-title">Add to playlist</div>
      <button class="sheet-item" data-pl="new">${PLUS_SVG}New playlist</button>${items}`);
    $("#sheet").querySelectorAll("[data-pl]").forEach((b) => {
      b.onclick = async () => {
        closeSheet();
        let pl;
        if (b.dataset.pl === "new") {
          const name = await promptSheet("New playlist", "Playlist name");
          if (!name) return;
          const id = await createPlaylist(name, ids);
          pl = { id, name };
        } else {
          pl = playlists.find((p) => p.id === Number(b.dataset.pl));
          if (!pl) return;
          const set = new Set(pl.trackIds);
          ids.forEach((i) => set.add(i));
          pl.trackIds = [...set];
          await db.putPlaylist(pl);
          await refreshData();
        }
        toast(`Added to ${pl.name}`);
        if (selecting) { selecting = false; selected.clear(); render(); }
      };
    });
  }

  async function trackMenu(t) {
    openSheet(`<div class="sheet-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.title)}</div>
      <button class="sheet-item" data-act="next">${PLAY_SVG.replace("<path", '<path fill="currentColor" stroke="none"')}Play next</button>
      <button class="sheet-item" data-act="pl">${PLUS_SVG}Add to playlist</button>
      <button class="sheet-item" data-act="like">${HEART_SVG}${t.liked ? "Remove like" : "Like"}</button>
      <button class="sheet-item" data-act="lyrics"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 10h16M4 14h10M4 18h7"/></svg>Edit lyrics</button>
      <button class="sheet-item" data-act="info"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>Artist &amp; album</button>
      <button class="sheet-item" data-act="rename"><svg viewBox="0 0 24 24"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>Rename</button>
      <button class="sheet-item danger" data-act="del"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/></svg>Delete</button>`);
    $("#sheet").querySelectorAll("[data-act]").forEach((b) => {
      b.onclick = async () => {
        const act = b.dataset.act;
        closeSheet();
        if (act === "next") { player.playNext(t.id); toast("Will play next"); }
        else if (act === "pl") addToPlaylistSheet([t.id]);
        else if (act === "like") await toggleLike(t.id);
        else if (act === "lyrics") openLyricsEditor(t.id);
        else if (act === "info") editInfoSheet(t);
        else if (act === "rename") {
          const name = await promptSheet("Rename", "Title");
          if (name) { t.title = name; await db.putTrack(t); await refreshData(); render(); }
        } else if (act === "del") {
          const ok = await confirmSheet("Delete song", `"${t.title}" will be removed from this device.`, "Delete", true);
          if (!ok) return;
          await deleteTrack(t.id);
        }
      };
    });
  }

  // Set the artist / album by hand (downloads often have neither). Pass one
  // track, or a list to edit a whole selection at once.
  async function editInfoSheet(target) {
    const list = (Array.isArray(target) ? target : [target]).filter(Boolean);
    if (!list.length) return;
    const many = list.length > 1;
    const first = list[0];
    const artistNames = artistsOf(tracks).map((a) => a.name).filter((n) => n !== UNKNOWN_ARTIST);
    const albumNames = albumsOf(tracks).map((a) => a.name);
    const options = (names) => names.map((n) => `<option value="${esc(n)}"></option>`).join("");
    const currentArtist = !many && artistOf(first) !== UNKNOWN_ARTIST ? artistOf(first) : "";
    const currentAlbum = many ? "" : albumName(first);
    const title = many ? `Artist &amp; album · ${list.length} songs` : "Artist &amp; album";

    openSheet(`<div class="sheet-title">${title}</div>
      <div class="edit-fields">
        <label class="edit-field" for="ef-artist"><span>Artist</span>
          <input id="ef-artist" type="text" list="ef-artists" autocomplete="off" autocapitalize="words" enterkeyhint="next"
            value="${esc(currentArtist)}" placeholder="${many ? "Leave empty to keep each one" : "e.g. YFG Fatso"}">
        </label>
        <label class="edit-field" for="ef-album"><span>Album <span class="edit-opt">optional</span></span>
          <input id="ef-album" type="text" list="ef-albums" autocomplete="off" autocapitalize="words" enterkeyhint="done"
            value="${esc(currentAlbum)}" placeholder="${many ? "Leave empty to keep each one" : "Leave empty for none"}">
        </label>
        <datalist id="ef-artists">${options(artistNames)}</datalist>
        <datalist id="ef-albums">${options(albumNames)}</datalist>
        <div class="edit-note">${many
          ? "Everything you fill in is applied to all " + list.length + " songs. Empty fields stay as they are. Songs that share an artist are grouped under Artists."
          : "Songs that share an artist are grouped under Artists. An album only appears in Albums when two or more songs share it, or when you name it here."}</div>
      </div>
      <div class="sheet-actions">
        <button class="btn ghost" id="ef-cancel">Cancel</button>
        <button class="btn primary" id="ef-save">Save</button>
      </div>`);

    const artistInput = $("#ef-artist");
    const albumInput = $("#ef-album");
    $("#ef-cancel").onclick = () => closeSheet();
    artistInput.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); albumInput.focus(); }
    };
    albumInput.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); $("#ef-save").click(); }
    };

    $("#ef-save").onclick = async () => {
      const artist = tagName(artistInput.value);
      const album = tagName(albumInput.value);
      closeSheet();
      if (many && !artist && !album) { toast("Nothing changed"); return; }
      let saved = 0;
      for (const t of list) {
        let changed = false;
        if (artist) {
          t.artist = artist;
          t.artistManual = true;
          changed = true;
        } else if (!many) {
          t.artist = UNKNOWN_ARTIST;
          t.artistManual = false;
          changed = true;
        }
        if (album) {
          t.album = album;
          t.albumManual = true;
          changed = true;
        } else if (!many) {
          t.album = "";
          t.albumManual = false;
          changed = true;
        }
        if (!changed) continue;
        await db.putTrack(t);
        saved++;
      }
      if (!saved) { toast("Nothing changed"); return; }
      await refreshData();
      // If the loaded song was part of the edit, update the player in place.
      const cur = player.state().track;
      const touched = cur && list.some((t) => t.id === cur.id);
      if (touched) {
        const fresh = tracks.find((x) => x.id === cur.id) || cur;
        cur.artist = fresh.artist;
        cur.artistManual = fresh.artistManual;
        cur.album = fresh.album;
        cur.albumManual = fresh.albumManual;
        updatePlayerUI();
        if (player.refreshMediaSession) player.refreshMediaSession();
      }
      if (selecting) { selecting = false; selected.clear(); }
      render({ keep: true });
      toast(many ? `${saved} songs updated` : "Saved");
    };

    artistInput.focus();
    artistInput.setSelectionRange(artistInput.value.length, artistInput.value.length);
  }

  async function deleteTrack(id) {
    if (player.state().track && player.state().track.id === id) player.stop();
    await db.deleteTrack(id);
    for (const p of playlists) {
      if (p.trackIds.includes(id)) {
        p.trackIds = p.trackIds.filter((x) => x !== id);
        await db.putPlaylist(p);
      }
    }
    if (artUrlCache.has(id)) { URL.revokeObjectURL(artUrlCache.get(id)); artUrlCache.delete(id); }
    colorCache.delete(id);
    await refreshData();
    render();
    toast("Deleted");
  }

  async function toggleLike(id) {
    const t = tracks.find((x) => x.id === id);
    if (!t) return;
    t.liked = !t.liked;
    await db.putTrack(t);
    const cur = player.state().track;
    if (cur && cur.id === id) cur.liked = t.liked;
    updateLikeButtons(t);
    if (route.view === "library" || route.view === "home") render();
  }

  function updateLikeButtons(t) {
    document.querySelectorAll(`[data-like="${t.id}"]`).forEach((b) => b.classList.toggle("liked", !!t.liked));
  }

  // ---------- Playback ----------
  let lastSource = "Library";

  function playList(list, startId, source, shuffle) {
    const ids = list.map((t) => t.id);
    let idx = ids.indexOf(startId);
    if (idx < 0) idx = 0;
    lastSource = source || "Library";
    player.playQueue(ids, idx, { shuffle: !!shuffle, firstTrack: list[idx] });
  }

  // Is the player running exactly this collection (order aside, so shuffle
  // does not turn the pause button back into a play button)?
  function sameCollection(st, list) {
    if (!st.track || !list.length || st.queue.length !== list.length) return false;
    const want = new Set(list.map((t) => t.id));
    return st.queue.every((id) => want.has(id));
  }

  // The big button on a playlist/album/artist page: pause while this
  // collection is playing, play otherwise.
  function updateDetailPlayButton() {
    const btn = $("#detail-play");
    if (!btn) return;
    const d = detailData(route.params);
    const list = (d && d.list) || [];
    const st = player.state();
    const playing = list.length > 0 && sameCollection(st, list) && st.playing;
    btn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
    btn.classList.toggle("pause", playing);
    btn.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  // ---------- Mini player / Now Playing ----------
  const mini = $("#mini");
  const np = $("#np");

  function currentTrack() { return player.state().track; }

  // Last track id the library list was drawn for (see updatePlayerUI).
  let lastUiTrackId = null;
  // Last track the mini player / cover swap animation was played for.
  let lastSwapTrackId = null;

  async function tintMini() {
    const t = currentTrack();
    if (!t) return;
    const c = await dominantColor(t);
    mini.style.background = `linear-gradient(${rgba(c, 0.5)}, ${rgba(c, 0.3)}), rgba(38,38,40,0.55)`;
  }

  async function tintNp() {
    const t = currentTrack();
    if (!t) return;
    const c = await dominantColor(t);
    np.style.background = `linear-gradient(180deg, ${rgba(c, 0.85)} 0%, ${rgba(c, 0.35)} 45%, rgba(10,10,10,0) 100%), #0a0a0a`;
    const card = $("#np-lyrics-card");
    if (card) card.style.background = rgba(c, 0.4);
  }

  function updatePlayerUI() {
    const st = player.state();
    const t = st.track;
    if (!t) {
      mini.classList.add("hidden");
      document.body.classList.remove("has-mini");
      return;
    }
    mini.classList.remove("hidden");
    // Tells the selection bar (and anything else floating above the tab bar)
    // that the mini player is on screen and needs the room.
    document.body.classList.add("has-mini");
    $("#mini-art").innerHTML = artHTML(t, "width:40px;height:40px");
    $("#mini-title").textContent = t.title;
    $("#mini-artist").textContent = t.artist;
    if (!$("#mini-like").innerHTML) $("#mini-like").innerHTML = HEART_SVG;
    setHeartState($("#mini-like"), t);
    $("#mini-toggle").innerHTML = st.playing ? PAUSE_SVG : PLAY_SVG;
    $("#mini-toggle").classList.add("fill");

    // Now Playing
    $("#np-source").textContent = "Playing from " + lastSource;
    $("#np-cover").innerHTML = artHTML(t);
    $("#np-title").textContent = t.title;
    $("#np-artist").textContent = t.artist;
    // A different song swaps its text and cover in; play/pause never replays it.
    if (lastSwapTrackId !== null && lastSwapTrackId !== t.id) {
      pulseClass(mini, "swap-in");
      pulseClass($("#np-cover"), "cover-in");
      pulseClass($(".np-text"), "swap-in");
    }
    lastSwapTrackId = t.id;
    if (!$("#np-like").innerHTML) $("#np-like").innerHTML = HEART_SVG;
    setHeartState($("#np-like"), t);
    $("#np-play").innerHTML = st.playing ? PAUSE_SVG : PLAY_SVG;
    const lp = $("#lyrics-play");
    if (lp) {
      lp.innerHTML = st.playing ? PAUSE_SVG : PLAY_SVG;
      lp.classList.toggle("fill", true);
      lp.setAttribute("aria-label", st.playing ? "Pause" : "Play");
    }
    $("#np-shuffle").innerHTML = SHUFFLE_SVG;
    $("#np-shuffle").classList.toggle("active", st.shuffle);
    $("#np-repeat").innerHTML = st.repeat === "one" ? REPEAT_ONE_SVG : REPEAT_SVG;
    $("#np-repeat").classList.toggle("active", st.repeat !== "off");
    updateNpLyricsPreview();
    tintMini();
    tintNp();
    updateProgress();
    renderSleepBadge();
    renderNpTrimZone();
    window.Lyra.lyricsSync?.mountNp();
    if (route.view === "detail") {
      updateDetailPlayButton();
      // The green "now playing" row and its level meter have to move with the
      // player, or an album page keeps pointing at the song you left behind.
      if (lastUiTrackId !== t.id) {
        lastUiTrackId = t.id;
        render({ quiet: true });
      }
    }
    // Re-render the song list only when the song itself changed — play/pause
    // used to rebuild every row, which made the whole app feel sticky.
    if (route.view === "library" && libFilter === "songs" && lastUiTrackId !== t.id) {
      lastUiTrackId = t.id;
      render({ quiet: true });
    }
  }

  // Which song the progress bar currently describes. iOS keeps the previous
  // song's duration/position for a moment after the source changes, so a new
  // song starts painting from zero until its own metadata arrives.
  let progressTrackId = null;

  function updateProgress() {
    const st = player.state();
    const t = st.track;
    if (!t) return;
    const isNew = progressTrackId !== t.id;
    progressTrackId = t.id;
    const duration = isNew ? (Number(t.duration) || 0) : st.duration;
    const time = isNew ? (Number(t.startAt) || 0) : st.currentTime;
    const pct = duration ? (time / duration) * 100 : 0;
    const bar = $("#mini-progress i");
    if (bar) bar.style.width = pct + "%";
    const fill = $("#np-seek-fill i");
    if (fill && !npSeekScrubbing) fill.style.width = pct + "%";
    $("#np-elapsed").textContent = fmtTime(time);
    $("#np-remain").textContent = "-" + fmtTime(Math.max(0, duration - time));
  }

  // The lyrics card on Now Playing previews the song itself: the line that is
  // playing (when the lyrics are timed) plus the one coming up, so you can read
  // along without opening the full lyrics view.
  function npLyricsPreviewText(t) {
    if (!t) return "Tap to add lyrics";
    const lines = t.lyricsSynced && t.lyricsSynced.lines;
    if (lines && lines.length) {
      const now = player.state().currentTime || 0;
      let i = 0;
      while (i + 1 < lines.length && Number(lines[i + 1].t) <= now) i++;
      const cur = (lines[i] && lines[i].text) || "";
      const next = (lines[i + 1] && lines[i + 1].text) || "";
      return [cur, next].filter(Boolean).join("\n") || "Tap to open lyrics";
    }
    if (t.lyrics) {
      return t.lyrics.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).join("\n");
    }
    return "Tap to add lyrics";
  }

  function updateNpLyricsPreview() {
    const el = $("#np-lyrics-preview");
    if (!el) return;
    const text = npLyricsPreviewText(currentTrack());
    if (el.textContent !== text) el.textContent = text;
  }

  function openNp() {
    np.classList.remove("hidden");
    tintNp();
    updateNpLyricsPreview();
  }
  function closeNp() {
    np.classList.add("hidden");
  }

  // ---------- Sleep timer ----------
  const SLEEP_KEY = "sleepUntil";
  let sleepUntil = 0;
  let sleepTick = null;

  function sleepLeft() {
    return Math.max(0, Math.round((sleepUntil - Date.now()) / 1000));
  }

  function renderSleepBadge() {
    const badge = $("#np-sleep-badge");
    const btn = $("#np-sleep");
    const on = sleepUntil > Date.now();
    if (btn) btn.classList.toggle("active", on);
    if (!badge) return;
    if (!on) {
      badge.classList.add("hidden");
      badge.textContent = "";
      return;
    }
    badge.classList.remove("hidden");
    badge.textContent = "Sleep in " + fmtTime(sleepLeft());
  }

  function stopSleepTimer(silent) {
    sleepUntil = 0;
    if (sleepTick) { clearInterval(sleepTick); sleepTick = null; }
    db.setSetting(SLEEP_KEY, 0).catch(() => {});
    renderSleepBadge();
    if (!silent) toast("Sleep timer stopped");
  }

  function armSleepTick() {
    if (sleepTick) clearInterval(sleepTick);
    sleepTick = setInterval(() => {
      renderSleepBadge();
      if (Date.now() < sleepUntil) return;
      if (player.state().playing) player.audio.pause();
      stopSleepTimer(true);
      toast("Sleep timer ended");
    }, 1000);
  }

  function startSleepTimer(seconds) {
    sleepUntil = Date.now() + seconds * 1000;
    db.setSetting(SLEEP_KEY, sleepUntil).catch(() => {});
    armSleepTick();
    renderSleepBadge();
    toast("Sleep timer set for " + fmtTime(seconds));
  }

  // Scroll-wheel picker used by the sleep timer sheet.
  function wheelHTML(id, count) {
    let items = "";
    for (let i = 0; i < count; i++) {
      items += `<div class="wheel-item" data-v="${i}">${String(i).padStart(2, "0")}</div>`;
    }
    return `<div class="wheel" id="${id}" role="listbox" aria-label="${id}">
      <div class="wheel-spacer"></div>${items}<div class="wheel-spacer"></div>
    </div>`;
  }

  function wireWheel(id, initial) {
    const el = $("#" + id);
    if (!el) return;
    const items = [...el.querySelectorAll(".wheel-item")];
    const paint = () => {
      const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / 32)));
      items.forEach((it, n) => it.classList.toggle("on", n === i));
      el.dataset.value = String(i);
    };
    el.addEventListener("scroll", () => {
      clearTimeout(el._t);
      el._t = setTimeout(paint, 40);
    }, { passive: true });
    el.addEventListener("scrollend", paint);
    el.addEventListener("pointerup", () => setTimeout(paint, 80));
    el.addEventListener("touchend", () => setTimeout(paint, 80), { passive: true });
    items.forEach((it, n) => {
      it.addEventListener("click", () => el.scrollTo({ top: n * 32, behavior: "smooth" }));
    });
    el.scrollTop = Math.max(0, Math.min(items.length - 1, initial || 0)) * 32;
    paint();
  }

  function wheelValue(id) {
    const el = $("#" + id);
    if (!el) return 0;
    const n = el.querySelectorAll(".wheel-item").length;
    return Math.min(n - 1, Math.max(0, Math.round(el.scrollTop / 32)));
  }

  function openSleepSheet() {
    const left = sleepLeft();
    openSheet(`<div class="sheet-title">Sleep timer</div>
      <p class="sheet-note">Set the time and the player will turn off automatically.</p>
      <div class="pickers">
        <div class="picker"><span class="picker-label">Hour:</span>${wheelHTML("sleep-h", 13)}</div>
        <div class="picker"><span class="picker-label">Minutes:</span>${wheelHTML("sleep-m", 60)}</div>
      </div>
      ${left > 0 ? `<p class="sheet-note on">Timer running — ${fmtTime(left)} left</p>` : ""}
      <div class="sheet-actions">
        <button class="btn ghost" id="sleep-stop">Stop Timer</button>
        <button class="btn primary" id="sleep-start">Start Timer</button>
      </div>`);
    wireWheel("sleep-h", left > 0 ? Math.floor(left / 3600) : 0);
    wireWheel("sleep-m", left > 0 ? Math.floor((left % 3600) / 60) : 0);
    $("#sleep-start").onclick = () => {
      const total = wheelValue("sleep-h") * 3600 + wheelValue("sleep-m") * 60;
      if (!total) { toast("Set an hour or minutes first"); return; }
      closeSheet();
      startSleepTimer(total);
    };
    $("#sleep-stop").onclick = () => { closeSheet(); stopSleepTimer(); };
  }

  // ---------- Per-song start / end points ----------
  function openTrimSheet() {
    const t = currentTrack();
    if (!t) { toast("Play a song first"); return; }
    const dur = Math.floor(player.state().duration || t.duration || 0);
    if (!(dur > 1)) { toast("Still loading — try again"); return; }
    let s = Math.min(Math.max(0, Number(t.startAt) || 0), dur - 1);
    let e = Number(t.endAt) > 0 ? Math.min(Number(t.endAt), dur) : dur;
    if (e <= s) e = Math.min(dur, s + 1);

    openSheet(`<div class="sheet-title">Start &amp; end</div>
      <p class="sheet-note">Drag the handles to choose where this song always starts and stops.</p>
      <div class="trim-wrap">
        <div class="trim-track" id="trim-track">
          <div class="trim-range" id="trim-range"></div>
          <button class="trim-handle" id="trim-h-start" aria-label="Start of song"></button>
          <button class="trim-handle" id="trim-h-end" aria-label="End of song"></button>
        </div>
        <div class="trim-times">
          <span id="trim-start-label">${fmtTime(s)}</span>
          <span class="mid">${fmtTime(dur)}</span>
          <span id="trim-end-label">${fmtTime(e)}</span>
        </div>
      </div>
      <div class="sheet-actions">
        <button class="btn ghost" id="trim-reset">Reset</button>
        <button class="btn primary" id="trim-save">Save</button>
      </div>`);

    const track = $("#trim-track");
    const hs = $("#trim-h-start");
    const he = $("#trim-h-end");
    const paint = () => {
      const ps = (s / dur) * 100;
      const pe = (e / dur) * 100;
      hs.style.left = ps + "%";
      he.style.left = pe + "%";
      $("#trim-range").style.left = ps + "%";
      $("#trim-range").style.width = Math.max(0, pe - ps) + "%";
      $("#trim-start-label").textContent = fmtTime(s);
      $("#trim-end-label").textContent = fmtTime(e);
    };
    paint();

    const posFromX = (x) => {
      const r = track.getBoundingClientRect();
      return Math.min(dur, Math.max(0, ((x - r.left) / r.width) * dur));
    };
    const setFrom = (which, x) => {
      const v = posFromX(x);
      if (which === "s") s = Math.min(v, e - 1);
      else e = Math.max(v, s + 1);
      paint();
    };
    const beginDrag = (which) => (ev) => {
      ev.preventDefault();
      const move = (mv) => setFrom(which, mv.clientX);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };
    hs.addEventListener("pointerdown", beginDrag("s"));
    he.addEventListener("pointerdown", beginDrag("e"));
    track.addEventListener("pointerdown", (ev) => {
      if (ev.target === hs || ev.target === he) return;
      setFrom(Math.abs(posFromX(ev.clientX) - s) <= Math.abs(posFromX(ev.clientX) - e) ? "s" : "e", ev.clientX);
    });

    $("#trim-reset").onclick = () => { s = 0; e = dur; paint(); };
    $("#trim-save").onclick = async () => {
      closeSheet();
      await saveTrim(t.id, s, e, dur);
    };
  }

  async function saveTrim(id, s, e, dur) {
    const t = tracks.find((x) => x.id === id) || (await db.getTrack(id));
    if (!t) return;
    const startAt = s > 0.5 ? Math.round(s * 10) / 10 : 0;
    const endAt = e < dur - 0.5 ? Math.round(e * 10) / 10 : 0;
    t.startAt = startAt;
    t.endAt = endAt;
    await db.putTrack(t);
    const cur = player.state().track;
    if (cur && cur.id === id) {
      cur.startAt = startAt;
      cur.endAt = endAt;
      if (startAt && player.state().currentTime < startAt) player.seek(startAt);
    }
    await refreshData();
    renderNpTrimZone();
    toast(startAt || endAt ? `Trim saved: ${fmtTime(startAt)} – ${fmtTime(endAt || dur)}` : "Trim cleared");
  }

  // A trimmed song is shown on the scissors button, not as extra stripes
  // across the progress bar (they read as stray hairlines while playing).
  function renderNpTrimZone() {
    const btn = $("#np-trim");
    if (!btn) return;
    const t = player.state().track;
    const trimmed = !!(t && ((Number(t.startAt) || 0) > 0 || (Number(t.endAt) || 0) > 0));
    btn.classList.toggle("active", trimmed);
    btn.setAttribute("aria-label", trimmed ? "Edit this song's start and end (trimmed)" : "Set song start and end");
  }

  // swipe-down-to-dismiss + scrub
  let npSeekScrubbing = false;

  function wireNpGestures() {
    const drag = $("#np-drag");
    let startY = 0, dy = 0, active = false, startedAt = 0;

    const begin = (y) => {
      if (drag.scrollTop > 0) return false; // mid-page: let it scroll normally
      active = true; startY = y; dy = 0; startedAt = Date.now();
      np.classList.add("no-anim");
      return true;
    };
    const moveTo = (y, ev) => {
      if (!active) return;
      if (drag.scrollTop > 0) { finish(); return; }
      const d = y - startY;
      if (d <= 0) { dy = 0; np.style.transform = ""; return; }
      dy = d;
      if (ev && ev.cancelable) ev.preventDefault();
      np.style.transform = `translateY(${Math.min(dy, window.innerHeight * 0.7)}px)`;
    };
    function finish() {
      if (!active) return;
      active = false;
      np.classList.remove("no-anim");
      np.style.transform = "";
      const flick = dy > 55 && Date.now() - startedAt < 320;
      if (dy > 120 || flick) closeNp();
      dy = 0;
    }

    // Touch first: iOS cancels pointer events once it starts scrolling.
    drag.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      // The scrubber owns its own drag: dragging the timeline must never move
      // or scroll the sheet.
      if (e.target.closest(".np-seek") || e.target.closest("button") || e.target.closest("input")) return;
      begin(e.touches[0].clientY);
    }, { passive: true });
    drag.addEventListener("touchmove", (e) => {
      if (!active || e.touches.length !== 1) return;
      moveTo(e.touches[0].clientY, e);
    }, { passive: false });
    drag.addEventListener("touchend", finish);
    drag.addEventListener("touchcancel", finish);

    // Mouse / trackpad, for desktop and the headless tests.
    drag.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return;
      if (e.target.closest("button") || e.target.closest(".np-seek")) return;
      if (!begin(e.clientY)) return;
      try { drag.setPointerCapture(e.pointerId); } catch (err) {}
    });
    drag.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch" || !active) return;
      moveTo(e.clientY, e);
    });
    drag.addEventListener("pointerup", (e) => { if (e.pointerType !== "touch") finish(); });
    drag.addEventListener("pointercancel", (e) => { if (e.pointerType !== "touch") finish(); });

    // Scrub. On iOS a drag inside the sheet is claimed by the sheet's own
    // scroll/dismiss gesture unless we take the touch here and keep it: hence
    // the non-passive touch handlers, stopPropagation, and touch-action: none.
    const seek = $("#np-seek");
    const ratioFromX = (x) => {
      const r = seek.getBoundingClientRect();
      if (!r.width) return 0;
      return Math.min(1, Math.max(0, (x - r.left) / r.width));
    };
    const paintSeek = (ratio) => {
      seek._ratio = ratio;
      const fill = $("#np-seek-fill i");
      if (fill) fill.style.width = ratio * 100 + "%";
    };
    const seekStart = (x, ev) => {
      if (ev && ev.cancelable) ev.preventDefault();
      npSeekScrubbing = true;
      seek.classList.add("scrub");
      paintSeek(ratioFromX(x));
    };
    const seekMove = (x, ev) => {
      if (!npSeekScrubbing) return;
      if (ev && ev.cancelable) ev.preventDefault();
      paintSeek(ratioFromX(x));
    };
    const seekEnd = () => {
      if (!npSeekScrubbing) return;
      npSeekScrubbing = false;
      seek.classList.remove("scrub");
      const dur = player.state().duration || 0;
      if (dur) player.seek((seek._ratio || 0) * dur);
    };

    seek.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      e.stopPropagation();
      seekStart(e.touches[0].clientX, e);
    }, { passive: false });
    seek.addEventListener("touchmove", (e) => {
      if (e.touches.length !== 1) return;
      e.stopPropagation();
      seekMove(e.touches[0].clientX, e);
    }, { passive: false });
    seek.addEventListener("touchend", seekEnd);
    seek.addEventListener("touchcancel", seekEnd);

    // Mouse and pen (desktop, and the headless tests).
    seek.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return;
      try { seek.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      seekStart(e.clientX, e);
    });
    seek.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      seekMove(e.clientX, e);
    });
    seek.addEventListener("pointerup", (e) => { if (e.pointerType !== "touch") seekEnd(); });
    seek.addEventListener("pointercancel", (e) => { if (e.pointerType !== "touch") seekEnd(); });
  }

  // ---------- Lyrics ----------
  let lyricsTrackId = null;
  let autoScrollOn = false;
  let autoScrollTimer = null;
  let autoScrollPauseUntil = 0;

  function parseLrc(text) {
    const lines = text.split("\n");
    const out = [];
    let hasTs = false;
    for (const line of lines) {
      const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
      if (m) {
        hasTs = true;
        out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3] });
      } else {
        out.push({ t: null, text: line });
      }
    }
    return hasTs ? out : null;
  }

  function renderLyricsText(t) {
    const box = $("#lyrics-text");
    if (!box) return;
    if (!t.lyrics) {
      box.className = "lyrics-text empty";
      box.innerHTML = "No lyrics yet.<br>Tap the pencil to paste them in.";
      window.Lyra.lyricsSync?.onLyricsRendered(t);
      return;
    }
    box.className = "lyrics-text";
    const lrc = parseLrc(t.lyrics);
    if (lrc) {
      box.innerHTML = lrc.map((l, i) => `<div class="lrc-line" data-i="${i}">${esc(l.text) || " "}</div>`).join("");
      box._lrc = lrc;
    } else {
      box.textContent = t.lyrics;
      box._lrc = null;
    }
    window.Lyra.lyricsSync?.onLyricsRendered(t);
  }

  function highlightLrc() {
    if (window.Lyra.lyricsSync?.handlesHighlight()) return;
    const box = $("#lyrics-text");
    if (!box || !box._lrc) return;
    const now = player.state().currentTime;
    let active = -1;
    box._lrc.forEach((l, i) => { if (l.t != null && l.t <= now) active = i; });
    box.querySelectorAll(".lrc-line").forEach((el) => {
      el.classList.toggle("now", Number(el.dataset.i) === active);
    });
  }

  async function openLyrics(trackId) {
    lyricsTrackId = trackId;
    const t = tracks.find((x) => x.id === trackId) || player.state().track;
    $("#lyrics").classList.remove("hidden");
    $("#lyrics-heading").textContent = t ? t.title : "Lyrics";
    $("#lyrics-editor").classList.add("hidden");
    autoScrollOn = !!(await db.getSetting("lyricsAutoScroll"));
    $("#lyrics-autoscroll").checked = autoScrollOn;
    renderLyricsText(t);
    startAutoScroll();
  }

  function closeLyrics() {
    $("#lyrics").classList.add("hidden");
    stopAutoScroll();
    window.Lyra.lyricsSync?.onLyricsClosed();
    lyricsTrackId = null;
  }

  function openLyricsEditor(trackId) {
    const t = tracks.find((x) => x.id === trackId) || player.state().track;
    if (!t) return;
    openLyrics(t.id).then(() => {
      $("#lyrics-editor").classList.remove("hidden");
      $("#lyrics-textarea").value = t.lyrics || "";
      $("#lyrics-textarea").focus();
    });
  }

  function startAutoScroll() {
    stopAutoScroll();
    autoScrollTimer = setInterval(() => {
      if (window.Lyra.lyricsSync?.handlesAutoScroll()) return;
      if (!autoScrollOn) return;
      if (Date.now() < autoScrollPauseUntil) return;
      const sc = $("#lyrics-scroll");
      const speed = Number($("#lyrics-speed").value) || 40; // px per second
      sc.scrollTop += speed / 10;
    }, 100);
  }
  function stopAutoScroll() {
    if (autoScrollTimer) clearInterval(autoScrollTimer);
    autoScrollTimer = null;
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 2400);
  }

  // ---------- View binding ----------
  function bindView(view, root) {
    const v = root || hosts.get(screenKey(view)) || $("#view");

    v.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go, {}, b.dataset.go !== "settings")));
    v.querySelectorAll("[data-back]").forEach((b) => (b.onclick = back));
    v.querySelectorAll("[data-detail-kind]").forEach((b) => (b.onclick = () => {
      if (Date.now() < holdSuppress) return; // the press was a hold, not a tap
      go("detail", { kind: b.dataset.detailKind, id: b.dataset.detailVal, name: b.dataset.detailVal });
    }));
    v.querySelectorAll("[data-browse]").forEach((b) => (b.onclick = () =>
      go("detail", { kind: "browse", name: b.dataset.browse })));

    v.querySelectorAll("[data-play-one]").forEach((b) => (b.onclick = () => {
      const id = Number(b.dataset.playOne);
      playList(tracks, id, "Home");
    }));

    v.querySelectorAll("[data-play-track]").forEach((row) => {
      // Hold a song row to open its menu (details, queue, playlist, delete).
      // A tap still plays, and holdSuppress swallows the click a hold leaves.
      if (row.querySelector("[data-dots]")) {
        bindHold(row, () => {
          const dots = row.querySelector("[data-dots]");
          if (dots) dots.click();
        });
      }
      row.onclick = (e) => {
        if (Date.now() < holdSuppress) return;
        if (e.target.closest("[data-dots]")) return;
        const id = Number(row.dataset.playTrack);
        if (selecting) {
          selected.has(id) ? selected.delete(id) : selected.add(id);
          row.querySelector(".checkbox").classList.toggle("on", selected.has(id));
          const c = $("#bulk-count");
          if (c) c.textContent = selected.size + " selected";
          [$("#bulk-add"), $("#bulk-edit"), $("#bulk-del")].forEach((b) => { if (b) b.disabled = selected.size === 0; });
          return;
        }
        const container = row.closest("[data-detail-list]");
        let list = sortedTracks(), source = "Library";
        if (container) {
          const d = detailData(route.params);
          if (d) { list = d.list; source = d.title; }
        } else if (route.view === "search") {
          const res = searchResults(searchQuery);
          if (res) { list = res.tracks; source = "Search"; }
        }
        playList(list, id, source);
      };
    });

    v.querySelectorAll("[data-dots]").forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const t = tracks.find((x) => x.id === Number(b.dataset.dots));
      if (t) trackMenu(t);
    }));

    v.querySelectorAll("[data-like]").forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      toggleLike(Number(b.dataset.like));
    }));

    if (view === "home") {
      v.querySelectorAll("#home-chips .chip").forEach((c) => (c.onclick = () => {
        v.querySelectorAll("#home-chips .chip").forEach((x) => x.classList.remove("on"));
        c.classList.add("on");
        const k = c.dataset.chip;
        $("#home-tiles").style.display = k === "all" ? "" : "none";
        [...$("#home-shelves").children].forEach((s) => {
          const isAlbums = s.id === "shelf-albums";
          s.style.display = k === "all" ? "" : k === "songs" ? (isAlbums ? "none" : "") : (isAlbums ? "" : "none");
        });
      }));
    }

    if (view === "search") {
      const input = $("#search-input");
      input.oninput = () => {
        searchQuery = input.value;
        const res = searchResults(searchQuery);
        const body = $("#search-body");
        if (!res) {
          body.innerHTML = `<h2 class="h-section">Browse all</h2><div class="browse">${BROWSE_TILES.map((b) => {
            const t = tracks.find((x) => x.art);
            return `<button class="browse-tile" style="background:${b.color}" data-browse="${b.key}">${esc(b.label)}${t ? artHTML(t) : `<div class="art-ph">${NOTE_SVG}</div>`}</button>`;
          }).join("")}</div>`;
        } else {
          const rows = res.tracks.map((t) => songRow(t)).join("");
          const pls = res.playlists.map((p) =>
            `<button class="sheet-item" data-detail-kind="playlist" data-detail-val="${p.id}">${NOTE_SVG}${esc(p.name)} • Playlist</button>`).join("");
          body.innerHTML = (rows + pls) || `<div class="empty"><div class="big">No results</div><div class="small">Try a different search.</div></div>`;
        }
        bindView("search", v);
      };
    }

    if (view === "library") {
      v.querySelectorAll("[data-libfilter]").forEach((c) => (c.onclick = () => {
        libFilter = c.dataset.libfilter;
        selecting = false; selected.clear();
        plSelecting = false; plSelected.clear();
        render({ top: true, rows: true });
      }));
      const sel = $("#lib-select");
      if (sel) sel.onclick = () => {
        if (libFilter === "playlists") { plSelecting = !plSelecting; plSelected.clear(); }
        else { selecting = !selecting; selected.clear(); }
        render({ top: true, rows: false });
      };
      // Tapping a playlist while selecting chooses it instead of opening it.
      v.querySelectorAll("[data-pl-tile]").forEach((b) => (b.onclick = () => {
        const id = Number(b.dataset.plTile);
        if (plSelected.has(id)) plSelected.delete(id); else plSelected.add(id);
        render({ keep: true });
      }));
      // Hold a playlist to delete it; a normal tap still opens it.
      v.querySelectorAll("[data-hold-pl]").forEach((b) =>
        bindHold(b, () => deletePlaylistsSheet(Number(b.dataset.holdPl))));
      const bulkPlDel = $("#bulk-pl-del");
      if (bulkPlDel) bulkPlDel.onclick = () => deletePlaylistsSheet([...plSelected]);
      const sortBtn = $("#lib-sort");
      if (sortBtn) sortBtn.onclick = openSortSheet;
      const az = $("#az-strip");
      if (az) az.querySelectorAll("[data-letter]").forEach((b) => (b.onclick = () => {
        const letter = b.dataset.letter;
        const rows = [...document.querySelectorAll("#lib-body .song-row")];
        const row = rows.find((r) => {
          const el = libSort === "artist" ? r.querySelector(".song-sub") : r.querySelector(".song-title");
          return el && el.textContent.trim().toUpperCase().startsWith(letter);
        });
        if (row) row.scrollIntoView({ block: "start", behavior: "smooth" });
      }));
      const tg = $("#lib-toggle");
      if (tg) tg.onclick = () => { libGrid = !libGrid; render({ top: true }); };
      const plus = $("#lib-plus");
      if (plus) plus.onclick = () => {
        openSheet(`<div class="sheet-title">Add</div>
          <button class="sheet-item" data-x="pl">${PLUS_SVG}Create playlist</button>
          <button class="sheet-item" data-x="imp">${NOTE_SVG}Import from Files</button>
          <button class="sheet-item" data-x="res">${HEART_SVG}Restore backup</button>`);
        $("#sheet").querySelectorAll("[data-x]").forEach((b) => (b.onclick = async () => {
          const x = b.dataset.x;
          closeSheet();
          if (x === "pl") {
            const name = await promptSheet("New playlist", "Playlist name");
            if (name) { await createPlaylist(name); toast("Playlist created"); if (libFilter !== "playlists") { libFilter = "playlists"; } render({ top: true }); }
          } else if (x === "imp") $("#file-input").click();
          else if (x === "res") $("#restore-input").click();
        }));
      };
      const bulkAdd = $("#bulk-add");
      if (bulkAdd) bulkAdd.onclick = () => addToPlaylistSheet([...selected]);
      const bulkEdit = $("#bulk-edit");
      if (bulkEdit) bulkEdit.onclick = () => {
        const chosen = [...selected].map((id) => tracks.find((t) => t.id === id)).filter(Boolean);
        editInfoSheet(chosen);
      };
      const bulkDel = $("#bulk-del");
      if (bulkDel) bulkDel.onclick = async () => {
        const ok = await confirmSheet("Delete songs", `${selected.size} songs will be removed from this device.`, "Delete", true);
        if (!ok) return;
        for (const id of [...selected]) {
          await db.deleteTrack(id);
          if (artUrlCache.has(id)) { URL.revokeObjectURL(artUrlCache.get(id)); artUrlCache.delete(id); }
          colorCache.delete(id);
        }
        for (const p of playlists) {
          const filtered = p.trackIds.filter((x) => !selected.has(x));
          if (filtered.length !== p.trackIds.length) { p.trackIds = filtered; await db.putPlaylist(p); }
        }
        selecting = false; selected.clear();
        await refreshData();
        render();
        toast("Deleted");
      };
    }

    if (view === "import") {
      $("#imp-files").onclick = () => $("#file-input").click();
      $("#imp-files-all").onclick = () => $("#file-input-all").click();
      $("#imp-restore").onclick = () => $("#restore-input").click();
      $("#imp-computer").onclick = () => {
        openSheet(`<div class="sheet-title">From my computer</div>
          <div style="padding:0 14px 14px;color:var(--text-dim);font-size:14px;line-height:1.55">
            A Wi-Fi transfer server is not possible inside a web app.<br><br>
            On Windows, use <b>iCloud for Windows</b>, <b>Google Drive</b>, or <b>OneDrive</b> to sync your music folder.
            The files will appear in the Files app on your iPhone — then come back here and tap <b>Files</b> to import them.
          </div>
          <div class="sheet-actions"><button class="btn primary" id="sh-ok">Got it</button></div>`);
        $("#sh-ok").onclick = closeSheet;
      };
    }

    if (view === "settings") {
      fillStorageInfo();
      fillVersionInfo();
      fillDisplayInfo();
      fillBackupInfo();
      const simBox = $("#set-sim");
      if (simBox) {
        simBox.checked = simIOS();
        simBox.onchange = () => applySimIOS(simBox.checked);
      }
      $("#set-update").onclick = checkForUpdates;
      window.Lyra.lyricsSync?.mountSettings(v);
      db.getSetting("lyricsAutoScroll").then((v2) => { $("#set-autoscroll").checked = !!v2; });
      $("#set-autoscroll").onchange = (e) => db.setSetting("lyricsAutoScroll", e.target.checked);
      $("#set-export").onclick = exportBackup;
      $("#set-restore").onclick = () => $("#restore-input").click();
      $("#set-clear").onclick = async () => {
        const ok = await confirmSheet("Clear library", "Every song, playlist, lyric, and setting will be deleted from this device. This cannot be undone.", "Clear everything", true);
        if (!ok) return;
        player.stop();
        await db.clearAll();
        artUrlCache.forEach((u) => URL.revokeObjectURL(u));
        artUrlCache.clear(); colorCache.clear();
        await refreshData();
        render();
        toast("Library cleared");
      };
    }

    if (view === "detail") {
      paintDetailHero(route.params);
      const d = detailData(route.params);
      const playBtn = $("#detail-play");
      if (playBtn && d) playBtn.onclick = () => {
        if (!d.list.length) return;
        const st = player.state();
        // Already playing this collection: the big button is a pause button.
        if (sameCollection(st, d.list)) { player.toggle(); return; }
        // Start from the song that is loaded when it belongs here, so pressing
        // play on the artist you are listening to does not jump to another one.
        const here = st.track && d.list.some((t) => t.id === st.track.id) ? st.track.id : null;
        playList(d.list, here || d.list[0].id, d.title);
      };
      updateDetailPlayButton();
      const shBtn = $("#detail-shuffle");
      if (shBtn && d) shBtn.onclick = () => playList(d.list, d.list[0] && d.list[0].id, d.title, true);
      const likeAll = $("#detail-like-all");
      if (likeAll && d) likeAll.onclick = async () => {
        for (const t of d.list) if (!t.liked) { t.liked = true; await db.putTrack(t); }
        toast("Liked all"); render();
      };
    }
  }

  // ---------- Global wiring ----------
  // One delegated listener gives every tappable row and button a ripple that
  // starts where the finger landed. Rebuilt screens pick it up for free.
  const RIPPLE_SEL = ".song-row, .tile, .card, .browse-tile, .btn, .sheet-item, .big-card, .chip";
  function wireRipples() {
    document.addEventListener("pointerdown", (e) => {
      const el = e.target.closest ? e.target.closest(RIPPLE_SEL) : null;
      if (!el || el.disabled) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      el.style.setProperty("--rx", ((e.clientX - r.left) / r.width) * 100 + "%");
      el.style.setProperty("--ry", ((e.clientY - r.top) / r.height) * 100 + "%");
      el.classList.remove("rippling");
      void el.offsetWidth;
      el.classList.add("rippling");
      clearTimeout(el._ripTimer);
      el._ripTimer = setTimeout(() => el.classList.remove("rippling"), 520);
    }, { passive: true });
  }

  function wireChrome() {
    wireRipples();
    document.querySelectorAll(".nav-btn").forEach((b) => {
      b.onclick = () => {
        const view = b.dataset.tab;
        if (route.view === view) {
          // Tapping the tab you're already on jumps back to the top, like Spotify.
          $("#view").scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        historyStack.length = 0;
        route = { view, params: {} };
        // View Transitions snapshotted the whole screen (including two
        // backdrop-blurred bars) and made tab switches feel stuck on iOS.
        showView();
      };
    });

    let suppressMiniTap = false;
    mini.addEventListener("click", (e) => {
      if (e.target.closest("#mini-toggle") || e.target.closest("#mini-like")) return;
      if (suppressMiniTap) { suppressMiniTap = false; return; }
      openNp();
    });

    // Swipe the mini player left or right for next / previous; hold it for the
    // Up next queue.
    let mg = null;
    mini.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1 || e.target.closest("button")) return;
      const t = e.touches[0];
      mg = { x: t.clientX, y: t.clientY, dx: 0, moved: false, held: false, timer: 0 };
      mg.timer = setTimeout(() => {
        if (!mg || mg.moved) return;
        mg.held = true;
        openQueue();
      }, 520);
    }, { passive: true });
    mini.addEventListener("touchmove", (e) => {
      if (!mg || e.touches.length !== 1) return;
      const t = e.touches[0];
      mg.dx = t.clientX - mg.x;
      if (Math.abs(mg.dx) > 8 || Math.abs(t.clientY - mg.y) > 8) {
        mg.moved = true;
        clearTimeout(mg.timer);
      }
      if (Math.abs(mg.dx) > Math.abs(t.clientY - mg.y)) {
        mini.style.transform = `translateX(${Math.max(-70, Math.min(70, mg.dx))}px)`;
      }
    }, { passive: true });
    const endMiniGesture = () => {
      const g = mg;
      mg = null;
      if (!g) return;
      clearTimeout(g.timer);
      mini.style.transform = "";
      if (g.held) {
        suppressMiniTap = true;
        setTimeout(() => { suppressMiniTap = false; }, 500);
      } else if (g.moved && Math.abs(g.dx) > 40) {
        suppressMiniTap = true;
        setTimeout(() => { suppressMiniTap = false; }, 500);
        if (g.dx < 0) player.next(true); else player.prev();
      }
    };
    mini.addEventListener("touchend", endMiniGesture);
    mini.addEventListener("touchcancel", endMiniGesture);
    mini.addEventListener("keydown", (e) => { if (e.key === "Enter") openNp(); });
    $("#mini-toggle").onclick = (e) => { e.stopPropagation(); player.toggle(); };
    $("#mini-like").onclick = (e) => { e.stopPropagation(); const t = currentTrack(); if (t) toggleLike(t.id); };

    $("#np-close").onclick = closeNp;
    $("#np-play").onclick = () => player.toggle();
    $("#np-next").onclick = () => player.next(true);
    $("#np-prev").onclick = () => player.prev();
    $("#np-shuffle").onclick = () => player.setShuffle(!player.state().shuffle);
    $("#np-repeat").onclick = () => player.cycleRepeat();
    $("#np-like").onclick = () => { const t = currentTrack(); if (t) toggleLike(t.id); };
    $("#np-lyrics-card").onclick = () => { const t = currentTrack(); if (t) openLyrics(t.id); };
    $("#np-queue").onclick = openQueue;
    $("#np-sleep").onclick = openSleepSheet;
    $("#np-trim").onclick = openTrimSheet;

    $("#lyrics-close").onclick = closeLyrics;
    $("#lyrics-play").onclick = () => player.toggle();
    $("#lyrics-edit").onclick = () => {
      const t = tracks.find((x) => x.id === lyricsTrackId) || player.state().track;
      if (!t) return;
      $("#lyrics-editor").classList.remove("hidden");
      $("#lyrics-textarea").value = t.lyrics || "";
      $("#lyrics-textarea").focus();
    };
    $("#lyrics-cancel").onclick = () => $("#lyrics-editor").classList.add("hidden");
    $("#lyrics-save").onclick = async () => {
      const t = tracks.find((x) => x.id === lyricsTrackId) || player.state().track;
      if (!t) return;
      t.lyrics = $("#lyrics-textarea").value;
      await db.putTrack(t);
      const cur = player.state().track;
      if (cur && cur.id === t.id) cur.lyrics = t.lyrics;
      await refreshData();
      $("#lyrics-editor").classList.add("hidden");
      renderLyricsText(t);
      updatePlayerUI();
      toast("Lyrics saved");
    };
    $("#lyrics-autoscroll").onchange = (e) => {
      autoScrollOn = e.target.checked;
      db.setSetting("lyricsAutoScroll", autoScrollOn);
    };
    const sc = $("#lyrics-scroll");
    sc.addEventListener("touchstart", () => { autoScrollPauseUntil = Date.now() + 4000; }, { passive: true });
    sc.addEventListener("pointerdown", () => { autoScrollPauseUntil = Date.now() + 4000; });

    $("#backdrop").onclick = closeSheet;

    const onFilesPicked = (e) => {
      const files = [...e.target.files]; // FileList is live — copy before clearing
      e.target.value = "";
      if (!files.length) return;
      if (route.view !== "import") go("import", {}, false);
      importFiles(files);
    };
    $("#file-input").addEventListener("change", onFilesPicked);
    $("#file-input-all").addEventListener("change", onFilesPicked);
    $("#restore-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) restoreBackup(file);
    });

    // App shell, not a web page: no pinch-zoom (Safari ignores
    // user-scalable=no), and no double-tap zoom.
    const noGesture = (e) => { if (e.cancelable) e.preventDefault(); };
    document.addEventListener("gesturestart", noGesture, { passive: false });
    document.addEventListener("gesturechange", noGesture, { passive: false });
    document.addEventListener("gestureend", noGesture, { passive: false });

    wireNpGestures();
  }

  // ---------- Player events ----------
  player.on("track", () => {
    updatePlayerUI();
    if (!np.classList.contains("hidden")) tintNp();
    mini.classList.add("pop");
    setTimeout(() => mini.classList.remove("pop"), 260);
  });
  player.on("state", updatePlayerUI);
  player.on("time", () => { updateProgress(); updateNpLyricsPreview(); highlightLrc(); });
  // A finished spin only changes two numbers. Patch them in memory and rebuild
  // Home/Library the next time they are shown instead of re-reading every track
  // (and every song's audio) mid-playback, which is what made the app stutter.
  player.on("playcount", (t) => {
    if (!t) return;
    const local = tracks.find((x) => x.id === t.id);
    if (local) {
      local.plays = t.plays;
      local.lastPlayedAt = t.lastPlayedAt;
    }
    dirtyViews.add("home");
    dirtyViews.add("library");
  });
  player.on("queue", updatePlayerUI);
  player.on("needqueue", () => toast("Pick a song first"));

  // ---------- Boot ----------
  // ---------- Viewport ----------
  // iOS sizes the layout viewport and the visual viewport separately: on a cold
  // start, and whenever Safari chrome slides in or out, fixed chrome can end up
  // outside the part you can actually see. Lift the bars by that difference and
  // size the scrolling shell to the visible height, so what you see is what you
  // can tap.
  // ---------- iPhone layout simulation ----------
  // A normal desktop browser has no safe areas, so the floating bars can be
  // checked but not their clearance from the status bar and home indicator.
  // `?sim=ios` (or the Settings switch) adds those insets inside the page.
  const SIM_KEY = "simIOS";

  function simIOS() {
    return document.documentElement.classList.contains("sim-ios");
  }

  function applySimIOS(on, persist) {
    document.documentElement.classList.toggle("sim-ios", !!on);
    if (persist !== false) {
      try { localStorage.setItem(SIM_KEY, on ? "1" : "0"); } catch (e) { /* private mode */ }
    }
    syncViewport();
    const box = $("#set-sim");
    if (box) box.checked = !!on;
    fillDisplayInfo();
  }

  function bootSimIOS() {
    let want = false;
    try { want = localStorage.getItem(SIM_KEY) === "1"; } catch (e) { /* ignore */ }
    const q = (location.search.match(/[?&]sim=([a-z]+)/i) || [])[1];
    if (q === "ios") want = true;
    else if (q === "off") want = false;
    if (want) applySimIOS(true, q ? true : false);
    else if (q === "off") applySimIOS(false);
  }

  function syncViewport() {
    const root = document.documentElement;
    root.style.setProperty("--vv-lift", "0px");

    // In the simulator the browser window *is* the phone screen.
    if (simIOS()) {
      const h = Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
      if (h > 0) root.style.setProperty("--app-h", h + "px");
      return;
    }

    const vv = window.visualViewport;
    // iOS sometimes reports the viewport about one status bar (47px) shorter
    // than the box it actually paints and hit-tests in: the bars then float in
    // the air and taps land above what you touched.
    const measured = Math.round(Math.max(
      (vv && vv.height) || 0, window.innerHeight || 0,
      document.documentElement.clientHeight || 0
    ));
    const screenH = Math.round((window.screen && window.screen.height) || 0);
    const mode = displayMode();
    const portrait = (window.innerHeight || 0) >= (window.innerWidth || 0);
    // From the Home Screen the page fills the display, so the display height is
    // the truth — even on a cold start, where innerHeight can come back one
    // status bar short and only correct itself on the first interaction. That
    // is why the tab bar used to sit too high until the app was tapped.
    const homeScreen = mode === "standalone" || mode === "fullscreen";
    const fromScreen = homeScreen && portrait && screenH > measured && screenH - measured < 140;
    const candidate = fromScreen ? screenH : measured;

    const apply = (h) => {
      if (!(h > 0)) return;
      const next = h + "px";
      if (root.style.getPropertyValue("--app-h") !== next) root.style.setProperty("--app-h", next);
    };

    // In a Home Screen app the screen height is the truth even when the boxes
    // here say otherwise, so there is no reachability fallback: measuring the
    // *reported* viewport is exactly what was wrong on a cold start.
    apply(candidate);
  }

  function watchViewport() {
    bootSimIOS();
    syncViewport();
    window.addEventListener("resize", syncViewport, { passive: true });
    window.addEventListener("orientationchange", () => {
      syncViewport();
      setTimeout(syncViewport, 300);
    });
    // Deliberately not listening to visualViewport resize/scroll: the keyboard
    // also moves that viewport, and the bars should stay put while typing.
    // A cold start on iOS can report the wrong height for a moment; re-measure
    // on the next frames and over the first few seconds.
    if (window.requestAnimationFrame) {
      [0, 1, 2].forEach((n) => window.requestAnimationFrame(() => {
        if (n) syncViewport();
      }));
    }
    [0, 16, 60, 160, 400, 900, 1500, 2500, 4000].forEach((ms) => setTimeout(syncViewport, ms));
    window.addEventListener("pageshow", syncViewport);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) syncViewport(); });
    // First touch also makes iOS settle its viewport; re-measure then.
    document.addEventListener("touchend", function once() {
      document.removeEventListener("touchend", once);
      syncViewport();
    });
  }

  async function boot() {
    await refreshData();
    try {
      const savedSort = await db.getSetting("libSort");
      if (savedSort && SORT_LABELS[savedSort]) libSort = savedSort;
    } catch (e) { /* first run */ }
    window.Lyra.lyricsSync?.init();
    watchViewport();
    wireChrome();
    render({ rows: true });
    // Restore a sleep timer that was still running when the app was closed.
    try {
      const saved = Number(await db.getSetting(SLEEP_KEY)) || 0;
      if (saved > Date.now()) { sleepUntil = saved; armSleepTick(); }
      else if (saved) db.setSetting(SLEEP_KEY, 0);
    } catch (e) { /* first run */ }
    renderSleepBadge();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // exposed for testing
  window.Lyra.app = {
    go, render, toast,
    importFiles, exportBackup, restoreBackup,
    get tracks() { return tracks; },
    get playlists() { return playlists; },
    refreshData,
    _test: {
      viewLibrary, viewHome, viewSearch, dominantColor, searchResults, detailData,
      artistsOf, albumsOf, albumName, artistOf, isRealAlbum, editInfoSheet, trackMenu,
      versionLabel, newestVersion, installedBuild, latestBuild, syncViewport,
      displayMode, fillDisplayInfo, applySimIOS, simIOS,
      get appVersion() { return APP_VERSION; },
    },
  };
})();
