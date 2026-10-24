/* Lyra.app — UI, routing, screens, import, backup, lyrics. */
(function () {
  "use strict";
  window.Lyra = window.Lyra || {};

  const APP_VERSION = "1.0.0";
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

  function artHTML(track, style) {
    const u = artUrl(track);
    if (u) return `<img class="art" style="${style || ""}" src="${u}" alt="" draggable="false">`;
    return `<div class="art-ph" style="${style || ""}">${NOTE_SVG}</div>`;
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
  }

  function albumsOf(list) {
    const map = new Map();
    list.forEach((t) => {
      const key = t.album || "Unknown Album";
      if (!map.has(key)) map.set(key, { name: key, tracks: [] });
      map.get(key).tracks.push(t);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function artistsOf(list) {
    const map = new Map();
    list.forEach((t) => {
      const key = t.artist || "Unknown Artist";
      if (!map.has(key)) map.set(key, { name: key, tracks: [] });
      map.get(key).tracks.push(t);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------- Router ----------
  let route = { view: "home", params: {} };
  const historyStack = [];

  function go(view, params, push) {
    if (push !== false && route.view !== view) historyStack.push(route);
    route = { view, params: params || {} };
    render();
  }

  function back() {
    const prev = historyStack.pop();
    route = prev || { view: "home", params: {} };
    render();
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

  function applyRender() {
    const v = $("#view");
    if (route.view === "home") v.innerHTML = viewHome();
    else if (route.view === "search") v.innerHTML = viewSearch();
    else if (route.view === "library") v.innerHTML = viewLibrary();
    else if (route.view === "import") v.innerHTML = viewImport();
    else if (route.view === "settings") v.innerHTML = viewSettings();
    else if (route.view === "detail") v.innerHTML = viewDetail(route.params);
    bindView(route.view);
    document.querySelectorAll(".nav-btn").forEach((b) =>
      b.classList.toggle("on", b.dataset.tab === route.view));
    positionTabPill();
    v.scrollTop = 0;
  }

  // Always synchronous — callers often query the DOM right after rendering.
  // View Transitions wrap nav tab switches only (see wireChrome).
  function render() {
    applyRender();
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
        <div class="song-sub">${esc(t.artist)}${t.album ? " • " + esc(t.album) : ""}</div>
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
        return `<button class="tile" data-detail-kind="playlist" data-detail-val="${p.id}">${cover ? artHTML(cover, "width:56px;height:56px;border-radius:8px 0 0 8px") : `<div class="art-ph" style="width:56px;height:56px;border-radius:8px 0 0 8px">${NOTE_SVG}</div>`}<span class="tile-name">${esc(p.name)}</span></button>`;
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

  function sortedTracks() {
    return tracks.slice().sort((a, b) => b.addedAt - a.addedAt);
  }

  function viewLibrary() {
    let body = "";
    if (libFilter === "songs") {
      const list = sortedTracks();
      body = list.length
        ? list.map((t) => songRow(t, { selecting, selected })).join("")
        : `<div class="empty"><div class="big">No songs yet</div><div class="small">Import some music first.</div></div>`;
    } else if (libFilter === "playlists") {
      body = `<button class="tile" style="width:100%;margin-bottom:8px" data-detail-kind="liked" data-detail-val="">${likedTile()}<span class="tile-name">Liked Songs</span></button>` +
        playlists.map((p) => {
          const cover = tracks.find((t) => p.trackIds.includes(t.id) && t.art);
          return `<button class="tile" style="width:100%;margin-bottom:8px" data-detail-kind="playlist" data-detail-val="${p.id}">
            ${cover ? artHTML(cover, "width:56px;height:56px;border-radius:8px 0 0 8px") : `<div class="art-ph" style="width:56px;height:56px;border-radius:8px 0 0 8px">${NOTE_SVG}</div>`}
            <span class="tile-name">${esc(p.name)}</span><span class="dim" style="margin-left:auto;padding-right:10px;font-weight:400">${p.trackIds.length} songs</span></button>`;
        }).join("") || `<div class="empty"><div class="big">No playlists</div><div class="small">Tap + to create one.</div></div>`;
    } else if (libFilter === "albums") {
      const albs = albumsOf(tracks);
      body = `<div class="browse">` + albs.map((a) => {
        const cover = a.tracks.find((t) => t.art) || a.tracks[0];
        return `<button class="browse-tile" style="background:var(--surface)" data-detail-kind="album" data-detail-val="${esc(a.name)}">
          ${artHTML(cover, "position:static;transform:none;box-shadow:none;width:100%;height:52px;object-fit:cover;border-radius:6px;margin-bottom:6px")}
          <div style="font-size:13px">${esc(a.name)}</div></button>`;
      }).join("") + `</div>`;
    } else if (libFilter === "artists") {
      body = artistsOf(tracks).map((a) =>
        `<button class="sheet-item" data-detail-kind="artist" data-detail-val="${esc(a.name)}">
          <span class="avatar">${esc(a.name[0] || "?").toUpperCase()}</span>
          ${esc(a.name)}<span class="dim" style="margin-left:auto">${a.tracks.length} songs</span></button>`).join("");
    }

    const bulk = selecting
      ? `<div class="bulk-bar glass">
          <span id="bulk-count">${selected.size} selected</span>
          <button class="btn ghost" id="bulk-add">Add to playlist</button>
          <button class="btn danger" id="bulk-del">Delete</button>
        </div>` : "";

    return `<div class="screen">
      <div class="row-between">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="avatar">L</span><h1 class="h-screen" style="margin:0">Your Library</h1>
        </div>
        <button class="icon-btn" id="lib-plus" aria-label="Add">${PLUS_SVG}</button>
      </div>
      <div class="chips">
        ${["songs", "playlists", "albums", "artists"].map((f) =>
          `<button class="chip ${libFilter === f ? "on" : ""}" data-libfilter="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}
      </div>
      <div class="row-between" style="margin-bottom:4px">
        <button class="chip" style="background:none;color:var(--text-dim);padding-left:0" disabled>Recents</button>
        <div style="display:flex;gap:2px">
          ${libFilter === "songs" ? `<button class="chip" id="lib-select">${selecting ? "Done" : "Select"}</button>` : ""}
          <button class="icon-btn" id="lib-toggle" aria-label="Toggle list or grid">
            <svg viewBox="0 0 24 24">${libGrid ? '<path d="M4 6h16M4 12h16M4 18h16"/>' : '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'}</svg>
          </button>
        </div>
      </div>
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

    let persisted = false;
    for (const file of files) {
      if (!isAudioFile(file)) {
        skipped++; line(file.name, "not audio"); continue;
      }
      try {
        const [tags, duration] = await Promise.all([
          window.Lyra.id3.readTags(file),
          window.Lyra.id3.readDuration(file),
        ]);
        await db.addTrack({
          title: tags.title, artist: tags.artist, album: tags.album,
          duration: duration || 0, addedAt: Date.now(),
          plays: 0, liked: false, lyrics: "",
          art: tags.art, audio: file,
        });
        imported++; line(tags.title, "added");
        if (!persisted) {
          persisted = true;
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        }
      } catch (e) {
        skipped++; line(file.name, "couldn't read");
      }
    }
    await refreshData();
    if (prog) prog.insertAdjacentHTML("beforeend",
      `<div class="import-summary">${imported} song${imported === 1 ? "" : "s"} imported${skipped ? `, ${skipped} skipped` : ""}</div>`);
    if (out && !imported) out.insertAdjacentHTML("afterbegin",
      `<div class="import-hint">Nothing was imported. If the picker would not let you select your songs, try “Browse all files”.</div>`);
    toast(`${imported} imported${skipped ? `, ${skipped} skipped` : ""}`);
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
      <div class="set-row">
        <div><div class="l">Lyrics auto-scroll</div><div class="s">Default for the lyrics view</div></div>
        <input type="checkbox" class="ios" id="set-autoscroll">
      </div>
      <button class="set-row" id="set-clear" style="width:100%;text-align:left">
        <div><div class="l" style="color:#ff6b6b">Clear library</div><div class="s">Delete every song, playlist, and setting on this device.</div></div>
      </button>
      <div class="set-row"><div><div class="l">Version</div><div class="s">Lyra ${APP_VERSION}</div></div></div>
    </div>`;
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
  async function exportBackup() {
    const data = {
      app: "lyra", version: 1, exportedAt: Date.now(),
      tracks: tracks.map((t) => ({
        title: t.title, artist: t.artist, album: t.album, duration: t.duration,
        liked: !!t.liked, plays: t.plays || 0, lyrics: t.lyrics || "", addedAt: t.addedAt,
      })),
      playlists: playlists.map((p) => ({
        name: p.name, createdAt: p.createdAt,
        tracks: p.trackIds.map((id) => tracks.find((t) => t.id === id)).filter(Boolean)
          .map((t) => ({ title: t.title, artist: t.artist, duration: t.duration })),
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const file = new File([blob], "lyra-backup.json", { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Lyra backup" }); return; } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "lyra-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("Backup downloaded (audio not included)");
  }

  const keyOf = (o) => `${(o.title || "").toLowerCase()}|${(o.artist || "").toLowerCase()}|${Math.round(o.duration || 0)}`;

  async function restoreBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) {
      toast("That file is not a valid backup"); return;
    }
    if (!data || !Array.isArray(data.tracks)) {
      toast("That file is not a valid backup"); return;
    }
    let updated = 0, playlistsMade = 0;
    const byKey = new Map(tracks.map((t) => [keyOf(t), t]));
    for (const bt of data.tracks) {
      const t = byKey.get(keyOf(bt));
      if (!t) continue;
      t.liked = !!bt.liked;
      t.plays = Math.max(t.plays || 0, bt.plays || 0);
      if (bt.lyrics) t.lyrics = bt.lyrics;
      await db.putTrack(t);
      updated++;
    }
    for (const bp of data.playlists || []) {
      if (playlists.some((p) => p.name === bp.name)) continue;
      const ids = (bp.tracks || []).map((k) => {
        const t = byKey.get(keyOf(k));
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
      const list = tracks.filter((t) => (t.album || "Unknown Album") === params.name);
      return { title: params.name, list };
    }
    if (params.kind === "artist") {
      const list = tracks.filter((t) => (t.artist || "Unknown Artist") === params.name);
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
      return `<div class="screen">${detailHeader("Artists")}${artistsOf(tracks).map((a) =>
        `<button class="sheet-item" data-detail-kind="artist" data-detail-val="${esc(a.name)}"><span class="avatar">${esc(a.name[0] || "?").toUpperCase()}</span>${esc(a.name)}</button>`).join("")}</div>`;
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
      cover.innerHTML = artHTML(withArt[0] || d.list[0]);
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

  async function deleteTrack(id) {
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
    player.playQueue(ids, idx, { shuffle: !!shuffle });
  }

  // ---------- Mini player / Now Playing ----------
  const mini = $("#mini");
  const np = $("#np");

  function currentTrack() { return player.state().track; }

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
      return;
    }
    mini.classList.remove("hidden");
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
    if (!$("#np-like").innerHTML) $("#np-like").innerHTML = HEART_SVG;
    setHeartState($("#np-like"), t);
    $("#np-play").innerHTML = st.playing ? PAUSE_SVG : PLAY_SVG;
    $("#np-shuffle").innerHTML = SHUFFLE_SVG;
    $("#np-shuffle").classList.toggle("active", st.shuffle);
    $("#np-repeat").innerHTML = st.repeat === "one" ? REPEAT_ONE_SVG : REPEAT_SVG;
    $("#np-repeat").classList.toggle("active", st.repeat !== "off");
    const prev = $("#np-lyrics-preview");
    if (prev) prev.textContent = t.lyrics ? t.lyrics.split("\n").slice(0, 2).join("\n") : "Tap to add lyrics";
    tintMini();
    tintNp();
    updateProgress();
    renderSleepBadge();
    renderNpTrimZone();
    if (route.view === "library" && libFilter === "songs") render();
  }

  function updateProgress() {
    const st = player.state();
    const pct = st.duration ? (st.currentTime / st.duration) * 100 : 0;
    const bar = $("#mini-progress i");
    if (bar) bar.style.width = pct + "%";
    const fill = $("#np-seek-fill i");
    if (fill && !npSeekScrubbing) fill.style.width = pct + "%";
    $("#np-elapsed").textContent = fmtTime(st.currentTime);
    $("#np-remain").textContent = "-" + fmtTime(Math.max(0, st.duration - st.currentTime));
  }

  function openNp() {
    np.classList.remove("hidden");
    tintNp();
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

  function renderNpTrimZone() {
    const zone = $("#np-seek-zone");
    if (!zone) return;
    const st = player.state();
    const t = st.track;
    const dur = st.duration || (t && t.duration) || 0;
    const s = Number(t && t.startAt) || 0;
    const e = Number(t && t.endAt) || 0;
    if (!t || !dur || (!s && !e)) {
      zone.classList.add("hidden");
      return;
    }
    zone.classList.remove("hidden");
    zone.style.left = (s / dur) * 100 + "%";
    zone.style.width = Math.max(0, (((e || dur) - s) / dur) * 100) + "%";
  }

  // drag-to-dismiss + scrub
  let npDrag = null;
  let npSeekScrubbing = false;

  function wireNpGestures() {
    const drag = $("#np-drag");
    drag.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || e.target.closest(".np-seek")) return;
      if (drag.scrollTop > 2) return;
      npDrag = { y: e.clientY, dy: 0 };
      np.classList.add("no-anim");
      try { drag.setPointerCapture(e.pointerId); } catch (err) {}
    });
    drag.addEventListener("pointermove", (e) => {
      if (!npDrag) return;
      npDrag.dy = Math.max(0, e.clientY - npDrag.y);
      np.style.transform = `translateY(${npDrag.dy}px)`;
    });
    const end = () => {
      if (!npDrag) return;
      np.classList.remove("no-anim");
      np.style.transform = "";
      if (npDrag.dy > 130) closeNp();
      npDrag = null;
    };
    drag.addEventListener("pointerup", end);
    drag.addEventListener("pointercancel", end);

    const seek = $("#np-seek");
    const ratioFromEvent = (e) => {
      const r = seek.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };
    seek.addEventListener("pointerdown", (e) => {
      npSeekScrubbing = true;
      seek.classList.add("scrub");
      seek.setPointerCapture(e.pointerId);
      const st = player.state();
      $("#np-seek-fill i").style.width = ratioFromEvent(e) * 100 + "%";
      seek._ratio = ratioFromEvent(e);
      void st;
    });
    seek.addEventListener("pointermove", (e) => {
      if (!npSeekScrubbing) return;
      seek._ratio = ratioFromEvent(e);
      $("#np-seek-fill i").style.width = seek._ratio * 100 + "%";
    });
    seek.addEventListener("pointerup", () => {
      if (!npSeekScrubbing) return;
      npSeekScrubbing = false;
      seek.classList.remove("scrub");
      const st = player.state();
      player.seek((seek._ratio || 0) * (st.duration || 0));
    });
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
  }

  function highlightLrc() {
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
  function bindView(view) {
    const v = $("#view");

    v.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go, {}, b.dataset.go !== "settings")));
    v.querySelectorAll("[data-back]").forEach((b) => (b.onclick = back));
    v.querySelectorAll("[data-detail-kind]").forEach((b) => (b.onclick = () =>
      go("detail", { kind: b.dataset.detailKind, id: b.dataset.detailVal, name: b.dataset.detailVal })));
    v.querySelectorAll("[data-browse]").forEach((b) => (b.onclick = () =>
      go("detail", { kind: "browse", name: b.dataset.browse })));

    v.querySelectorAll("[data-play-one]").forEach((b) => (b.onclick = () => {
      const id = Number(b.dataset.playOne);
      playList(tracks, id, "Home");
    }));

    v.querySelectorAll("[data-play-track]").forEach((row) => {
      row.onclick = (e) => {
        if (e.target.closest("[data-dots]")) return;
        const id = Number(row.dataset.playTrack);
        if (selecting) {
          selected.has(id) ? selected.delete(id) : selected.add(id);
          row.querySelector(".checkbox").classList.toggle("on", selected.has(id));
          const c = $("#bulk-count");
          if (c) c.textContent = selected.size + " selected";
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
        bindView("search-results");
      };
    }

    if (view === "library") {
      v.querySelectorAll("[data-libfilter]").forEach((c) => (c.onclick = () => {
        libFilter = c.dataset.libfilter; selecting = false; selected.clear(); render();
      }));
      const sel = $("#lib-select");
      if (sel) sel.onclick = () => { selecting = !selecting; selected.clear(); render(); };
      const tg = $("#lib-toggle");
      if (tg) tg.onclick = () => { libGrid = !libGrid; render(); };
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
            if (name) { await createPlaylist(name); toast("Playlist created"); if (libFilter !== "playlists") { libFilter = "playlists"; } render(); }
          } else if (x === "imp") $("#file-input").click();
          else if (x === "res") $("#restore-input").click();
        }));
      };
      const bulkAdd = $("#bulk-add");
      if (bulkAdd) bulkAdd.onclick = () => addToPlaylistSheet([...selected]);
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
      db.getSetting("lyricsAutoScroll").then((v2) => { $("#set-autoscroll").checked = !!v2; });
      $("#set-autoscroll").onchange = (e) => db.setSetting("lyricsAutoScroll", e.target.checked);
      $("#set-export").onclick = exportBackup;
      $("#set-restore").onclick = () => $("#restore-input").click();
      $("#set-clear").onclick = async () => {
        const ok = await confirmSheet("Clear library", "Every song, playlist, lyric, and setting will be deleted from this device. This cannot be undone.", "Clear everything", true);
        if (!ok) return;
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
      if (playBtn && d) playBtn.onclick = () => playList(d.list, d.list[0] && d.list[0].id, d.title);
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
  function wireChrome() {
    document.querySelectorAll(".nav-btn").forEach((b) => {
      b.onclick = () => {
        historyStack.length = 0;
        route = { view: b.dataset.tab, params: {} };
        if (document.startViewTransition) {
          try { document.startViewTransition(applyRender); return; } catch (e) {}
        }
        applyRender();
      };
    });

    mini.addEventListener("click", (e) => {
      if (e.target.closest("#mini-toggle") || e.target.closest("#mini-like")) return;
      openNp();
    });
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
    $("#np-sleep").onclick = openSleepSheet;
    $("#np-trim").onclick = openTrimSheet;

    $("#lyrics-close").onclick = closeLyrics;
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
  player.on("time", () => { updateProgress(); highlightLrc(); });
  player.on("playcount", () => { refreshData(); });
  player.on("queue", updatePlayerUI);
  player.on("needqueue", () => toast("Pick a song first"));

  // ---------- Boot ----------
  async function boot() {
    await refreshData();
    wireChrome();
    render();
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
    _test: { viewLibrary, viewHome, viewSearch, dominantColor, searchResults, detailData },
  };
})();
