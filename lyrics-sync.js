/* Lyra Lyrics Lab (beta)
 * Optional synced lyrics. Everything runs in the browser:
 *  - auto-transcribe a song with Groq Whisper (your own key, stored on-device)
 *  - align pasted lyrics to the transcript
 *  - import / export .lrc
 *  - line or karaoke word highlighting with follow-scroll
 * Off by default; gated by the "Lyrics Lab (beta)" switch in Settings.
 * No build step, no dependencies.
 */
(function () {
  "use strict";

  const W = typeof window !== "undefined" ? window : globalThis;
  const doc = () => (typeof document !== "undefined" ? document : null);

  const SETTING = {
    enabled: "llab.enabled",
    key: "llab.groqKey",
    lang: "llab.lang",
    mode: "llab.mode",
    autoscroll: "llab.autoscroll",
  };
  const TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
  const MODELS_URL = "https://api.groq.com/openai/v1/models";
  const MAX_UPLOAD = 24 * 1024 * 1024; // Groq free-tier request limit
  const MIN_SIMILARITY = 0.7;          // a word counts as matched at/above this
  const MAX_ALIGN_CELLS = 4e6;

  const LANGS = [
    ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"],
    ["pt", "Portuguese"], ["it", "Italian"], ["nl", "Dutch"], ["hi", "Hindi"],
    ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"], ["ar", "Arabic"],
    ["ru", "Russian"], ["tr", "Turkish"], ["pl", "Polish"], ["sv", "Swedish"],
  ];

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function toast(msg) {
    if (W.Lyra && W.Lyra.app && W.Lyra.app.toast) W.Lyra.app.toast(msg);
  }

  function db() {
    return W.Lyra && W.Lyra.db;
  }

  function player() {
    return W.Lyra && W.Lyra.player;
  }

  function appTracks() {
    return (W.Lyra && W.Lyra.app && W.Lyra.app.tracks) || [];
  }

  async function refreshTracks() {
    if (W.Lyra && W.Lyra.app && W.Lyra.app.refreshData) await W.Lyra.app.refreshData();
  }

  class LlabError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  // ------------------------------------------------------------ text utils
  const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

  function normalizeWord(word) {
    return String(word == null ? "" : word)
      .toLowerCase()
      .replace(/[’]/g, "'")
      .replace(/^'+|'+$/g, "");
  }

  function tokenize(line) {
    const out = [];
    const text = String(line == null ? "" : line);
    let m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(text))) out.push({ text: m[0], norm: normalizeWord(m[0]) });
    return out;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const tmp = prev; prev = cur; cur = tmp;
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const max = Math.max(a.length, b.length);
    return Math.max(0, 1 - levenshtein(a, b) / max);
  }

  // ------------------------------------------------------------ alignment
  /**
   * Global (Needleman-Wunsch) alignment of user tokens to transcript tokens.
   * Returns Map<userIndex, transcriptIndex>.
   */
  function alignTokens(userNorms, transcriptNorms) {
    const n = userNorms.length;
    const m = transcriptNorms.length;
    const map = new Map();
    if (!n || !m) return map;
    if (n * m > MAX_ALIGN_CELLS) {
      // Pathological input: fall back to a single forward sweep.
      let j = 0;
      for (let i = 0; i < n && j < m; i++) {
        if (similarity(userNorms[i], transcriptNorms[j]) >= MIN_SIMILARITY) { map.set(i, j); j++; }
      }
      return map;
    }

    const GAP = -1;
    const MISMATCH = -1;
    const MATCH = 2;
    const cols = m + 1;
    const score = new Float32Array((n + 1) * cols);
    const dir = new Uint8Array((n + 1) * cols); // 0 diag, 1 up, 2 left

    for (let j = 1; j <= m; j++) {
      score[j] = score[j - 1] + GAP;
      dir[j] = 2;
    }
    for (let i = 1; i <= n; i++) {
      score[i * cols] = score[(i - 1) * cols] + GAP;
      dir[i * cols] = 1;
      for (let j = 1; j <= m; j++) {
        const sim = similarity(userNorms[i - 1], transcriptNorms[j - 1]);
        const diag = score[(i - 1) * cols + (j - 1)] + (sim >= MIN_SIMILARITY ? MATCH : MISMATCH);
        const up = score[(i - 1) * cols + j] + GAP;
        const left = score[i * cols + (j - 1)] + GAP;
        let best = diag;
        let d = 0;
        if (up > best) { best = up; d = 1; }
        if (left > best) { best = left; d = 2; }
        score[i * cols + j] = best;
        dir[i * cols + j] = d;
      }
    }

    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
      const d = dir[i * cols + j];
      if (d === 0) {
        if (similarity(userNorms[i - 1], transcriptNorms[j - 1]) >= MIN_SIMILARITY) map.set(i - 1, j - 1);
        i--; j--;
      } else if (d === 1) {
        i--;
      } else {
        j--;
      }
    }
    return new Map([...map.entries()].sort((a, b) => a[0] - b[0]));
  }

  /**
   * alignLyrics(userText, words) -> { lines, matchRate }
   * words: [{ word|text, start, end, probability? }]
   * lines: [{ t, end, text, words: [{ text, t, e, p }] }]
   * With no matched words at all, lines get t: null (no invented timing).
   */
  /**
   * linesFromWords(words) -> synced lines.
   * After transcribing there is no user text to align, so the transcript is
   * grouped into readable lines: break on pauses, punctuation, or length.
   */
  const LINE_WORDS = 7;
  function linesFromWords(words) {
    const list = Array.isArray(words) ? words.filter((w) => w && (w.word || w.text)) : [];
    const out = [];
    let cur = null;
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const start = Number.isFinite(Number(w.start)) ? Number(w.start) : (cur ? cur.end : 0);
      const end = Number.isFinite(Number(w.end)) ? Number(w.end) : start + 0.3;
      const word = String(w.word != null ? w.word : w.text).trim();
      const prev = cur && cur.words.length ? cur.words[cur.words.length - 1] : null;
      const gap = prev ? start - prev.e : 0;
      const longEnough = cur && (cur.words.length >= LINE_WORDS || cur.text.length > 42);
      const punctuation = prev && /[.!?]$/.test(prev.text);
      if (cur && (gap > 0.65 || longEnough || punctuation)) { out.push(cur); cur = null; }
      if (!cur) cur = { t: start, end, text: "", words: [] };
      cur.words.push({ text: word, t: start, e: Math.max(start + 0.05, end), p: w.probability != null ? w.probability : null });
      cur.text = cur.text ? cur.text + " " + word : word;
      cur.end = Math.max(cur.end, end);
    }
    if (cur) out.push(cur);
    // Keep times monotonic even if the transcript jitters.
    let last = -1;
    return out.map((l) => {
      const t = Math.max(l.t, last + 0.01);
      last = t;
      return { t, end: Math.max(l.end, t + 0.3), text: l.text, words: l.words };
    });
  }

  function alignLyrics(userText, words) {
    const transcript = (Array.isArray(words) ? words : []).map((w) => {
      const start = Number(w.start);
      const end = Number(w.end);
      return {
        norm: normalizeWord(w.word != null ? w.word : w.text),
        start: Number.isFinite(start) ? start : 0,
        end: Number.isFinite(end) ? end : (Number.isFinite(start) ? start + 0.3 : 0),
        p: w.probability != null && Number.isFinite(Number(w.probability)) ? Number(w.probability) : null,
      };
    }).filter((w) => w.norm);

    const rawLines = String(userText == null ? "" : userText).split(/\r?\n/);
    const lines = rawLines.map((raw) => ({ raw, toks: tokenize(raw) }));
    const flat = [];
    lines.forEach((ln, li) => {
      ln.toks.forEach((tk, wi) => flat.push({ norm: tk.norm, text: tk.text, li, wi }));
    });

    const total = flat.length;
    if (!total || !transcript.length) {
      return {
        lines: lines.map((ln) => ({ t: null, end: null, text: ln.raw, words: ln.toks.map((tk) => ({ text: tk.text, t: null, e: null, p: null })) })),
        matchRate: 0,
        matched: 0,
        total,
      };
    }

    const map = alignTokens(flat.map((f) => f.norm), transcript.map((t) => t.norm));
    const times = new Array(total).fill(null);

    for (const [ui, ti] of map) {
      const tr = transcript[ti];
      times[ui] = { start: tr.start, end: Math.max(tr.start + 0.05, tr.end), p: tr.p, matched: true };
    }

    // Interpolate unmatched runs between their matched neighbours.
    let i = 0;
    while (i < total) {
      if (times[i]) { i++; continue; }
      let j = i;
      while (j < total && !times[j]) j++;
      const prev = i > 0 ? times[i - 1] : null;
      const next = j < total ? times[j] : null;
      const gap = j - i;
      const from = prev ? prev.end : (next ? Math.max(0, next.start - gap * 0.35) : 0);
      const to = next ? next.start : (prev ? prev.end + gap * 0.35 : 0);
      const step = gap > 0 ? Math.max(0, (to - from) / gap) : 0;
      for (let k = 0; k < gap; k++) {
        const st = from + step * k;
        times[i + k] = { start: st, end: st + Math.max(0.08, step * 0.8), p: null, matched: false };
      }
      i = j;
    }

    // Monotonic starts.
    let last = 0;
    for (const tt of times) {
      if (!tt) continue;
      if (tt.start < last) tt.start = last;
      if (tt.end <= tt.start) tt.end = tt.start + 0.05;
      last = tt.start;
    }

    const matchRate = map.size / total;
    if (!map.size) {
      return {
        lines: lines.map((ln) => ({ t: null, end: null, text: ln.raw, words: ln.toks.map((tk) => ({ text: tk.text, t: null, e: null, p: null })) })),
        matchRate: 0,
        matched: 0,
        total,
      };
    }

    const outLines = lines.map((ln, li) => {
      const toks = flat.map((f, idx) => ({ f, idx })).filter((x) => x.f.li === li);
      const words = toks.map((x) => {
        const tt = times[x.idx];
        return { text: x.f.text, t: tt ? tt.start : null, e: tt ? tt.end : null, p: tt ? tt.p : null };
      });
      const timed = words.filter((w) => w.t != null);
      return {
        t: timed.length ? timed[0].t : null,
        end: timed.length ? timed[timed.length - 1].e : null,
        text: ln.raw,
        words,
      };
    });

    // Blank/unmatched lines inherit the previous line time (never fabricated forward).
    let carry = null;
    for (const ln of outLines) {
      if (ln.t == null && carry != null) { ln.t = carry; ln.end = carry; }
      if (ln.t != null) carry = ln.end != null ? ln.end : ln.t;
    }

    return { lines: outLines, matchRate, matched: map.size, total };
  }

  // ------------------------------------------------------------------ LRC
  function lrcStamp(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(s / 60);
    const rest = s - m * 60;
    return String(m).padStart(2, "0") + ":" + rest.toFixed(2).padStart(5, "0");
  }

  function parseLrcTime(min, sec, frac) {
    const f = frac == null ? 0 : Number("0." + String(frac).padEnd(3, "0").slice(0, 3));
    return Number(min) * 60 + Number(sec) + f;
  }

  /**
   * parseLrc(text) -> { lines, offset, meta, warnings }
   * Handles multiple [mm:ss.xx] stamps per line and optional <mm:ss.xx> word tags.
   */
  function parseLrc(text) {
    const meta = {};
    const lines = [];
    let offset = 0;
    const src = String(text == null ? "" : text).split(/\r?\n/);

    for (const raw of src) {
      const line = raw.trim();
      if (!line) continue;

      const metaMatch = line.match(/^\[(ar|ti|al|by|offset|length|re|ve):([^\]]*)\]$/i);
      if (metaMatch) {
        const k = metaMatch[1].toLowerCase();
        if (k === "offset") offset = (Number(metaMatch[2]) || 0) / 1000;
        else meta[k] = metaMatch[2].trim();
        continue;
      }

      const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
      if (!stamps.length) {
        // Plain line without a timestamp — keep it, with no timing.
        lines.push({ t: null, end: null, text: line, words: null });
        continue;
      }

      const last = stamps[stamps.length - 1];
      const body = line.slice(last.index + last[0].length).trim();

      // Word-level tags: <mm:ss.xx>word
      const wordTags = [...body.matchAll(/<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g)];
      let words = null;
      let textOnly = body;
      if (wordTags.length) {
        words = [];
        const base = parseLrcTime(stamps[0][1], stamps[0][2], stamps[0][3]);
        for (let i = 0; i < wordTags.length; i++) {
          const tag = wordTags[i];
          const startPos = tag.index + tag[0].length;
          const endPos = i + 1 < wordTags.length ? wordTags[i + 1].index : body.length;
          const word = body.slice(startPos, endPos).trim();
          const at = parseLrcTime(tag[1], tag[2], tag[3]);
          if (word) words.push({ text: word, dt: at - base });
        }
        textOnly = body.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").replace(/\s+/g, " ").trim();
      }

      for (const s of stamps) {
        const t = parseLrcTime(s[1], s[2], s[3]) - offset;
        lines.push({
          t: Math.max(0, t),
          end: null,
          text: textOnly,
          words: words && words.length ? words.map((w) => ({ text: w.text, t: Math.max(0, t + w.dt) })) : null,
        });
      }
    }

    lines.sort((a, b) => (a.t == null ? -1 : a.t) - (b.t == null ? -1 : b.t));
    for (let i = 0; i < lines.length; i++) {
      const next = lines[i + 1];
      if (lines[i].t != null) lines[i].end = next && next.t != null ? next.t : lines[i].t + 4;
    }
    return { lines, offset, meta };
  }

  /** toLrc(lines, meta) -> string (word tags when word times exist) */
  function toLrc(lines, meta) {
    const out = [];
    const m = meta || {};
    if (m.title) out.push("[ti:" + m.title + "]");
    if (m.artist) out.push("[ar:" + m.artist + "]");
    if (m.album) out.push("[al:" + m.album + "]");
    const sorted = (lines || []).slice().filter((l) => l && l.t != null).sort((a, b) => a.t - b.t);
    for (const line of sorted) {
      let body = String(line.text == null ? "" : line.text);
      if (Array.isArray(line.words) && line.words.length && line.words.every((w) => w.t != null)) {
        body = line.words.map((w) => "<" + lrcStamp(w.t) + ">" + w.text).join(" ");
      }
      out.push("[" + lrcStamp(line.t) + "]" + body);
    }
    return out.join("\n") + "\n";
  }

  // --------------------------------------------------------------- audio
  /** 16-bit PCM WAV from an AudioBuffer (mono). */
  function encodeWav16(audioBuffer) {
    const ch = audioBuffer.numberOfChannels;
    const frames = audioBuffer.length;
    const rate = audioBuffer.sampleRate;
    const data = new DataView(new ArrayBuffer(44 + frames * 2));
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) data.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF");
    data.setUint32(4, 36 + frames * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    data.setUint32(16, 16, true);
    data.setUint16(20, 1, true);          // PCM
    data.setUint16(22, 1, true);          // mono
    data.setUint32(24, rate, true);
    data.setUint32(28, rate * 2, true);   // byte rate
    data.setUint16(32, 2, true);          // block align
    data.setUint16(34, 16, true);         // bits
    writeStr(36, "data");
    data.setUint32(40, frames * 2, true);

    const channels = [];
    for (let c = 0; c < ch; c++) channels.push(audioBuffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < frames; i++) {
      let v = 0;
      for (let c = 0; c < ch; c++) v += channels[c][i];
      v = v / ch;
      v = Math.max(-1, Math.min(1, v));
      data.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
    return data.buffer;
  }

  async function prepareAudioForUpload(blob, opts) {
    const limit = (opts && Number(opts.limit)) || MAX_UPLOAD;
    if (!blob || !blob.size) throw new LlabError("empty", "This song has no audio stored on the device.");
    if (blob.size <= limit) return { blob, converted: false };
    const AC = W.AudioContext || W.webkitAudioContext;
    if (!AC || !W.OfflineAudioContext) {
      throw new LlabError("unsupported", "This browser can't shrink the audio. Try a shorter song.");
    }
    let ctx = null;
    let decoded = null;
    try {
      ctx = new AC();
      decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch (e) {
      if (ctx && ctx.close) ctx.close();
      throw new LlabError("decode", "Couldn't decode this file to shrink it.");
    }
    try {
      const rate = 16000;
      const frames = Math.max(1, Math.ceil(decoded.duration * rate));
      const off = new W.OfflineAudioContext(1, frames, rate);
      const src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(off.destination);
      src.start();
      const rendered = await off.startRendering();
      const wav = new Blob([encodeWav16(rendered)], { type: "audio/wav" });
      if (wav.size > limit) {
        throw new LlabError("too-long", "This song is too long for the free tier (still over 24 MB after shrinking). Try a shorter one.");
      }
      return { blob: wav, converted: true, seconds: decoded.duration };
    } finally {
      if (ctx && ctx.close) ctx.close();
    }
  }

  // ---------------------------------------------------------------- Groq
  function xhrRequest(url, opts) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(opts.method || "GET", url, true);
      xhr.timeout = opts.timeout || 300000;
      Object.entries(opts.headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.onerror = () => reject(new LlabError("cors", "The request was blocked (CORS or network)."));
      xhr.ontimeout = () => reject(new LlabError("timeout", "The request timed out."));
      xhr.onload = () => {
        let body = xhr.responseText;
        let json = null;
        try { json = body ? JSON.parse(body) : null; } catch (e) { json = null; }
        resolve({ status: xhr.status, json, text: body });
      };
      if (opts.upload && xhr.upload) {
        xhr.upload.onload = () => { if (opts.onUploaded) opts.onUploaded(); };
      }
      xhr.send(opts.body || null);
    });
  }

  async function testKey(key) {
    if (!key) throw new LlabError("nokey", "Add your Groq API key first.");
    const res = await xhrRequest(MODELS_URL, {
      method: "GET",
      headers: { Authorization: "Bearer " + key },
      timeout: 20000,
    });
    if (res.status === 200) return { ok: true, models: (res.json && res.json.data ? res.json.data.length : 0) };
    if (res.status === 401 || res.status === 403) throw new LlabError("key", "That key was rejected (401). Check it and try again.");
    throw new LlabError("status", "Groq answered " + res.status + ".");
  }

  function describeHttpError(status, json) {
    const apiMsg = json && json.error && json.error.message;
    if (status === 401 || status === 403) return new LlabError("key", "That key was rejected (" + status + ")." + (apiMsg ? " " + apiMsg : ""));
    if (status === 429) return new LlabError("rate", "Groq is rate limiting this key (429).");
    if (status === 413) return new LlabError("too-long", "Groq says the file is too large (413).");
    if (status === 400 && /multipart|NextPart|EOF/i.test(apiMsg || "")) {
      return new LlabError("upload", "The audio didn't upload in one piece. Try again on Wi-Fi." + (apiMsg ? " (Groq: " + apiMsg + ")" : ""));
    }
    return new LlabError("status", "Groq answered " + status + "." + (apiMsg ? " " + apiMsg : ""));
  }

  /**
   * normalizeTranscript(payload, fallbackLang) -> { text, words, segments, language, duration }
   * Groq's verbose_json has no per-word probability, so a word without one
   * inherits exp(avg_logprob) of the segment it falls in — an estimate used
   * only for the "proofread this" underline, never for timing.
   */
  function normalizeTranscript(payload, fallbackLang) {
    const data = payload || {};
    const segments = Array.isArray(data.segments) ? data.segments : [];
    let raw = Array.isArray(data.words) ? data.words : [];
    if (!raw.length && segments.length) {
      raw = segments.flatMap((s) => (Array.isArray(s.words) ? s.words : []));
    }

    const segmentAt = (start) => segments.find((s) => (
      typeof s.avg_logprob === "number" &&
      Number.isFinite(s.start) && Number.isFinite(s.end) &&
      start >= s.start - 0.01 && start < s.end + 0.01
    ));

    const words = raw.map((w) => {
      const start = Number(w.start) || 0;
      const end = Number(w.end) || start + 0.3;
      let probability = null;
      if (w.probability != null && Number.isFinite(Number(w.probability))) {
        probability = Number(w.probability);
      } else {
        const seg = segmentAt(start);
        if (seg) probability = Math.max(0, Math.min(1, Math.exp(seg.avg_logprob)));
      }
      return {
        word: String(w.word != null ? w.word : w.text == null ? "" : w.text).trim(),
        start,
        end,
        probability,
      };
    }).filter((w) => w.word);

    return {
      text: String(data.text || "").trim(),
      words,
      segments,
      language: data.language || fallbackLang || "en",
      duration: data.duration || null,
    };
  }

  /**
   * transcribeBlob(blob, {key, language, onStage}) -> { text, words, segments, language }
   * Stages: "uploading" | "transcribing".
   */
  const EXT_BY_TYPE = {
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
    "audio/m4a": "m4a", "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/wave": "wav", "audio/ogg": "ogg", "audio/opus": "opus", "audio/webm": "webm",
    "audio/flac": "flac", "audio/x-flac": "flac", "audio/aiff": "aiff", "audio/x-aiff": "aiff",
  };

  /**
   * A File whose bytes are already in memory.
   * Tracks store the picked File, and Safari can hand a multipart upload a
   * partly-unreadable stream from it — Groq then answers 400 "multipart:
   * NextPart: EOF" because the body ended early. Copying the bytes gives the
   * browser an exact Content-Length and turns an unreadable file into a clear
   * message instead of an API error.
   */
  async function uploadFileFrom(blob) {
    const bytes = await blob.arrayBuffer();
    if (!bytes.byteLength) {
      throw new LlabError("empty-audio", "This song's audio is empty on this device. Re-import it from the Files app.");
    }
    const type = blob.type && /^audio\//.test(blob.type) ? blob.type : "audio/mpeg";
    const ext = EXT_BY_TYPE[type] || "mp3";
    let name = String(blob.name || "lyra-upload").replace(/[\\/:*?"<>|]+/g, " ").trim() || "lyra-upload";
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += "." + ext;
    return new File([bytes], name, { type });
  }

  async function transcribeBlob(blob, opts) {
    opts = opts || {};
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new LlabError("offline", "No internet connection.");
    }
    if (!opts.key) throw new LlabError("nokey", "Add your Groq API key in Settings first.");

    const file = await uploadFileFrom(blob);
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("model", "whisper-large-v3");
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    form.append("language", opts.language || "en");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");

    const send = async () => {
      if (opts.onStage) opts.onStage("uploading");
      return xhrRequest(opts.endpoint || TRANSCRIBE_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + opts.key },
        body: form,
        upload: true,
        timeout: 300000,
        onUploaded: () => { if (opts.onStage) opts.onStage("transcribing"); },
      });
    };

    // Same body, sent by fetch instead of XHR. Used when the XHR body is
    // reported truncated, so the phone still gets its transcript.
    const sendFetch = async () => {
      if (opts.onStage) opts.onStage("uploading");
      let r;
      try {
        r = await fetch(opts.endpoint || TRANSCRIBE_URL, {
          method: "POST",
          headers: { Authorization: "Bearer " + opts.key },
          body: form,
        });
      } catch (e) {
        throw new LlabError("cors", "The request was blocked (CORS or network).");
      }
      const text = await r.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
      if (opts.onStage) opts.onStage("transcribing");
      return { status: r.status, json, text };
    };

    let res = await send();
    if (res.status === 400 && /multipart|nextpart|eof/i.test((res.json && res.json.error && res.json.error.message) || "")) {
      res = await sendFetch();
    }
    if (res.status === 429) {
      // one retry, per spec
      await new Promise((r) => setTimeout(r, 1500));
      res = await send();
    }
    if (res.status !== 200) throw describeHttpError(res.status, res.json);

    return normalizeTranscript(res.json, opts.language);
  }

  // --------------------------------------------------------------- state
  let ready = null;
  let enabled = false;
  let apiKey = "";
  let language = "en";
  let mode = "line";
  let autoDefault = false;

  let viewTrack = null;
  let viewLines = [];
  let viewOffset = 0;
  let rendered = false;
  let follow = false;
  let activeLine = -1;
  let rafId = 0;
  let expectedTop = 0;

  async function loadSettings() {
    if (!db()) return;
    try {
      enabled = !!(await db().getSetting(SETTING.enabled));
      apiKey = (await db().getSetting(SETTING.key)) || "";
      language = (await db().getSetting(SETTING.lang)) || "en";
      mode = (await db().getSetting(SETTING.mode)) || "line";
      autoDefault = !!(await db().getSetting(SETTING.autoscroll));
    } catch (e) { /* first run */ }
  }

  function init() {
    if (!ready) ready = loadSettings();
    return ready;
  }

  function ensure() {
    if (!ready) return init();
    return ready;
  }

  async function saveSetting(key, value) {
    try { await db().setSetting(key, value); } catch (e) { /* non-fatal */ }
  }

  // ------------------------------------------------------- Now Playing UI
  function npTrack() {
    const p = player();
    return p && p.state ? p.state().track : null;
  }

  function findTrack(id) {
    return appTracks().find((t) => t.id === id) || null;
  }

  function hasTiming(t) {
    return !!(t && t.lyricsSynced && Array.isArray(t.lyricsSynced.lines) && t.lyricsSynced.lines.some((l) => l && l.t != null));
  }

  function setStatus(text, cls) {
    const el = doc() && doc().getElementById("llab-status");
    if (!el) return;
    el.textContent = text || "";
    el.className = "llab-status" + (cls ? " " + cls : "");
  }

  function mountNp() {
    ensure().then(() => {
      if (!doc()) return;
      const row = doc().getElementById("llab-np");
      const track = npTrack();
      if (!enabled || !track) {
        if (row) row.remove();
        return;
      }
      const drag = doc().getElementById("np-drag");
      if (!drag) return;

      let el = row;
      if (!el) {
        el = doc().createElement("div");
        el.id = "llab-np";
        el.className = "llab-np";
        el.innerHTML = `
          <button class="btn ghost" id="llab-auto" type="button">Auto-sync lyrics</button>
          <button class="btn ghost" id="llab-align" type="button">Sync my lyrics</button>
          <button class="btn ghost" id="llab-import" type="button">Import .lrc</button>
          <button class="btn ghost" id="llab-export" type="button">Export .lrc</button>
          <div class="llab-hint" id="llab-tip"></div>
          <div class="llab-status" id="llab-status"></div>`;
        drag.appendChild(el);
        doc().getElementById("llab-auto").onclick = () => runAutoSync();
        doc().getElementById("llab-align").onclick = () => runAlign();
        doc().getElementById("llab-import").onclick = () => pickLrc();
        doc().getElementById("llab-export").onclick = () => exportLrcAction();
      }
      const alignBtn = doc().getElementById("llab-align");
      const exportBtn = doc().getElementById("llab-export");
      const hasWords = !!(track.lyricsWords && track.lyricsWords.length);
      const hasLyrics = !!(track.lyrics && track.lyrics.trim());
      if (alignBtn) {
        const readyToAlign = hasWords && hasLyrics;
        alignBtn.disabled = !readyToAlign;
        alignBtn.title = readyToAlign ? "" : hasWords ? "Paste lyrics in Edit lyrics first" : "Auto-sync this song first";
      }
      const tip = doc().getElementById("llab-tip");
      if (tip) {
        if (!hasWords) tip.textContent = "Auto-sync transcribes this song and syncs the lyrics for you.";
        else if (!hasLyrics) tip.textContent = "Paste your own words in Edit lyrics, then Sync my lyrics matches them to the audio.";
        else tip.textContent = "";
      }
      if (exportBtn) {
        const canExport = hasTiming(track);
        exportBtn.disabled = !canExport;
        exportBtn.title = canExport ? "" : "Nothing synced yet";
      }
    });
  }

  // ------------------------------------------------------- sync actions
  function currentTrack() {
    return npTrack() || viewTrack || null;
  }

  async function runAutoSync() {
    await ensure();
    const t = currentTrack();
    if (!t) { toast("Play a song first"); return; }
    if (!apiKey) { toast("Add your Groq API key in Settings"); return; }
    setStatus("Preparing…", "");
    try {
      const prepared = await prepareAudioForUpload(t.audio);
      if (prepared.converted) setStatus("Preparing… (shrunk to 16 kHz mono)", "");
      const out = await transcribeBlob(prepared.blob, {
        key: apiKey,
        language,
        onStage: (stage) => setStatus(stage === "uploading" ? "Uploading…" : "Transcribing…", ""),
      });
      if (!out.words.length) throw new LlabError("empty", "Groq returned no words.");
      const fresh = findTrack(t.id) || t;
      fresh.lyricsWords = out.words;
      fresh.lyricsTranscript = out.text;
      fresh.transcriptLang = out.language;
      fresh.transcribedAt = Date.now();
      await db().putTrack(fresh);
      const live = npTrack();
      if (live && live.id === fresh.id) {
        live.lyricsWords = fresh.lyricsWords;
        live.lyricsTranscript = fresh.lyricsTranscript;
        live.transcriptLang = fresh.transcriptLang;
        live.transcribedAt = fresh.transcribedAt;
      }
      // With no lyrics of your own, the transcript becomes the lyrics right
      // away, already synced — no second tap.
      const hasOwnLyrics = !!(fresh.lyrics && fresh.lyrics.trim());
      if (!hasOwnLyrics) {
        const lines = linesFromWords(out.words);
        fresh.lyrics = lines.map((l) => l.text).join("\n");
        fresh.lyricsSynced = { lines, matchRate: 1, source: "transcript", createdAt: Date.now() };
        await db().putTrack(fresh);
        if (live && live.id === fresh.id) {
          live.lyrics = fresh.lyrics;
          live.lyricsSynced = fresh.lyricsSynced;
        }
      }
      await refreshTracks();
      const low = out.words.filter((w) => w.probability != null && w.probability < 0.5).length;
      const lowNote = low ? " · " + Math.round((low / out.words.length) * 100) + "% low-confidence" : "";
      setStatus(out.words.length + " words saved" + (hasOwnLyrics ? lowNote : " · lyrics synced" + lowNote), "ok");
      toast(hasOwnLyrics ? "Transcript saved — tap Sync my lyrics" : "Lyrics synced from the transcript");
      mountNp();
      if (!hasOwnLyrics) refreshLyricsView();
    } catch (e) {
      const msg = e && e.code === "cors"
        ? "Blocked: this browser couldn't reach Groq (CORS or network)."
        : (e && e.message) || "Transcription failed.";
      setStatus(msg, "bad");
      toast(msg);
    }
  }

  async function runAlign() {
    await ensure();
    const t = currentTrack();
    if (!t) return;
    if (!t.lyrics) { toast("Paste your lyrics first"); return; }
    if (!t.lyricsWords || !t.lyricsWords.length) { toast("Transcribe this song first"); return; }
    const res = alignLyrics(t.lyrics, t.lyricsWords);
    if (!res.lines.length) { toast("Nothing to align"); return; }
    const fresh = findTrack(t.id) || t;
    fresh.lyricsSynced = {
      lines: res.lines,
      matchRate: res.matchRate,
      source: "transcript",
      createdAt: Date.now(),
    };
    await db().putTrack(fresh);
    const live = npTrack();
    if (live && live.id === fresh.id) live.lyricsSynced = fresh.lyricsSynced;
    await refreshTracks();
    const pct = Math.round(res.matchRate * 100);
    setStatus(pct + "% of your words matched" + (pct < 50 ? " — proofread before trusting it" : ""), pct < 50 ? "bad" : "ok");
    toast(pct + "% of your words matched");
    if (hasTiming(fresh)) refreshLyricsView();
  }

  // --------------------------------------------------------- lrc import
  function pickLrc() {
    let input = doc().getElementById("llab-lrc-input");
    if (!input) {
      input = doc().createElement("input");
      input.type = "file";
      input.id = "llab-lrc-input";
      input.accept = ".lrc,text/plain";
      input.hidden = true;
      doc().body.appendChild(input);
      input.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        await importLrcFile(file);
      });
    }
    input.click();
  }

  async function importLrcFile(file) {
    const t = currentTrack();
    if (!t) { toast("Play a song first"); return; }
    const text = await file.text();
    const parsed = parseLrc(text);
    const timed = parsed.lines.filter((l) => l.t != null);
    if (!timed.length) { toast("No timestamps found in that .lrc"); return; }
    const fresh = findTrack(t.id) || t;
    fresh.lyrics = text.trim();
    fresh.lyricsSynced = { lines: parsed.lines, matchRate: null, source: "lrc", createdAt: Date.now() };
    await db().putTrack(fresh);
    const live = npTrack();
    if (live && live.id === fresh.id) { live.lyrics = fresh.lyrics; live.lyricsSynced = fresh.lyricsSynced; }
    await refreshTracks();
    setStatus(timed.length + " timed lines imported", "ok");
    toast("Lyrics attached");
    if (doc().getElementById("lyrics") && !doc().getElementById("lyrics").classList.contains("hidden")) refreshLyricsView();
  }

  function lrcTextFor(t) {
    if (!hasTiming(t)) return null;
    return toLrc(t.lyricsSynced.lines, { title: t.title, artist: t.artist, album: t.album });
  }

  async function exportLrcAction() {
    const t = currentTrack();
    const text = t && lrcTextFor(t);
    if (!text) { toast("Nothing synced to export"); return; }
    const name = (t.title || "lyrics").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "lyrics";
    const file = new File([text], name + ".lrc", { type: "text/plain" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name + ".lrc" }); return; } catch (e) { /* cancelled */ }
    }
    const url = URL.createObjectURL(file);
    const a = doc().createElement("a");
    a.href = url;
    a.download = name + ".lrc";
    doc().body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ------------------------------------------------------- lyrics view UI
  function lyricsOpen() {
    const el = doc() && doc().getElementById("lyrics");
    return !!(el && !el.classList.contains("hidden"));
  }

  function handlesHighlight() {
    return enabled && rendered && viewLines.length > 0 && lyricsOpen();
  }

  function handlesAutoScroll() {
    return handlesHighlight();
  }

  function offsetFor(t) {
    return Number(t && t.lrcOffset) || 0;
  }

  function withOffset(lines, offset) {
    return lines.map((l) => ({
      t: l.t == null ? null : l.t + offset,
      end: l.end == null ? null : l.end + offset,
      text: l.text,
      words: Array.isArray(l.words) ? l.words.map((w) => ({
        text: w.text,
        t: w.t == null ? null : w.t + offset,
        e: w.e == null ? (w.t == null ? null : w.t + offset) : w.e + offset,
        p: w.p == null ? null : w.p,
      })) : null,
    }));
  }

  function onLyricsRendered(t) {
    ensure().then(() => {
      if (!doc()) return;
      if (!enabled || !hasTiming(t) || !lyricsOpen()) { teardownLyrics(); return; }
      viewTrack = t;
      refreshLyricsView();
    });
  }

  function onLyricsClosed() {
    teardownLyrics();
  }

  function refreshLyricsView() {
    if (!doc()) return;
    const t = viewTrack && findTrack(viewTrack.id) ? findTrack(viewTrack.id) : viewTrack;
    if (!t || !enabled || !hasTiming(t)) { teardownLyrics(); return; }
    const view = doc().getElementById("lyrics");
    const box = doc().getElementById("lyrics-text");
    if (!view || !box || view.classList.contains("hidden")) return;

    viewTrack = t;
    viewOffset = offsetFor(t);
    const base = t.lyricsSynced.lines.map((l) => ({
      t: l.t,
      end: l.end,
      text: String(l.text == null ? "" : l.text),
      words: Array.isArray(l.words) ? l.words.map((w) => ({ text: w.text, t: w.t, e: w.e, p: w.p })) : null,
    }));
    viewLines = withOffset(base, viewOffset);

    renderLines(box);
    mountBar(view);
    view.classList.add("llab-active");
    rendered = true;
    activeLine = -1;
    follow = !!(autoDefault || view.dataset.llabFollow === "1");
    syncFollowUi();
    wireScrollGuards();
    wireLineTaps();
    startLoop();
  }

  function renderLines(box) {
    box.className = "lyrics-text llab-text";
    box.innerHTML = viewLines.map((l, i) => {
      const cls = "llab-line tap";
      if (mode === "word" && l.words && l.words.length) {
        const words = l.words.map((w, j) => {
          const lowP = w.p != null && w.p < 0.5 ? " low" : "";
          const dt = w.t != null ? Number(w.t) : "";
          return '<span class="llab-word' + lowP + '" data-w="' + j + '" data-wt="' + dt + '">' + esc(w.text || "") + "</span>";
        }).join(" ");
        return '<div class="' + cls + '" data-i="' + i + '" data-t="' + (l.t == null ? "" : l.t) + '">' + words + "</div>";
      }
      return '<div class="' + cls + '" data-i="' + i + '" data-t="' + (l.t == null ? "" : l.t) + '">' + (esc(l.text) || "&nbsp;") + "</div>";
    }).join("");
  }

  function mountBar(view) {
    const top = view.querySelector(".lyrics-top");
    if (!top) return;
    let bar = doc().getElementById("llab-bar");
    if (!bar) {
      bar = doc().createElement("div");
      bar.id = "llab-bar";
      bar.className = "llab-bar";
      top.insertAdjacentElement("afterend", bar);
    }
    bar.innerHTML = `
      <div class="llab-seg" role="group" aria-label="Highlight mode">
        <button type="button" data-mode="line" class="${mode === "line" ? "on" : ""}">Line</button>
        <button type="button" data-mode="word" class="${mode === "word" ? "on" : ""}">Word</button>
      </div>
      <button type="button" class="llab-chip" data-nudge="-1" aria-label="Shift lyrics 0.1s earlier">−0.1s</button>
      <span class="llab-offset" id="llab-offset">${(viewOffset || 0).toFixed(1)}s</span>
      <button type="button" class="llab-chip" data-nudge="1" aria-label="Shift lyrics 0.1s later">+0.1s</button>
      <button type="button" class="llab-chip ${follow ? "on" : ""}" id="llab-auto-scroll">Auto-scroll</button>
      <button type="button" class="llab-chip" id="llab-export-view">Export</button>`;

    bar.querySelectorAll("[data-mode]").forEach((b) => {
      b.onclick = () => {
        mode = b.dataset.mode;
        saveSetting(SETTING.mode, mode);
        const box = doc().getElementById("lyrics-text");
        if (box) renderLines(box);
        activeLine = -1;
        if (follow) scrollToActive(true);
      };
    });
    bar.querySelectorAll("[data-nudge]").forEach((b) => {
      b.onclick = () => nudgeOffset(Number(b.dataset.nudge) * 0.1);
    });
    const auto = doc().getElementById("llab-auto-scroll");
    if (auto) auto.onclick = () => setFollow(!follow);
    const exp = doc().getElementById("llab-export-view");
    if (exp) exp.onclick = () => exportLrcAction();

    let fb = doc().getElementById("llab-follow");
    if (!fb) {
      fb = doc().createElement("button");
      fb.id = "llab-follow";
      fb.className = "llab-follow hidden";
      fb.type = "button";
      fb.textContent = "Follow";
      view.appendChild(fb);
      fb.onclick = () => setFollow(true);
    }
  }

  async function nudgeOffset(delta) {
    if (!viewTrack) return;
    const t = findTrack(viewTrack.id) || viewTrack;
    const next = Math.round(((Number(t.lrcOffset) || 0) + delta) * 10) / 10;
    t.lrcOffset = next;
    if (viewTrack.id === t.id) viewTrack = t;
    await db().putTrack(t);
    const live = npTrack();
    if (live && live.id === t.id) live.lrcOffset = next;
    viewOffset = next;
    viewLines = withOffset(viewTrack.lyricsSynced.lines, viewOffset);
    const box = doc().getElementById("lyrics-text");
    if (box) renderLines(box);
    const label = doc().getElementById("llab-offset");
    if (label) label.textContent = next.toFixed(1) + "s";
    activeLine = -1;
    if (follow) scrollToActive(true);
  }

  function teardownLyrics() {
    stopLoop();
    const d = doc();
    if (!d) return;
    const view = d.getElementById("lyrics");
    if (view) view.classList.remove("llab-active");
    ["llab-bar", "llab-follow"].forEach((id) => {
      const el = d.getElementById(id);
      if (el) el.remove();
    });
    rendered = false;
    viewLines = [];
    viewTrack = null;
    activeLine = -1;
    follow = false;
  }

  // ------------------------------------------------------------ highlight
  function findActiveIndex(lines, now) {
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = lines[mid].t;
      if (t != null && t <= now) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  function startLoop() {
    stopLoop();
    if (!rendered) return;
    const step = () => {
      rafId = W.requestAnimationFrame(step);
      const p = player();
      if (!p || !rendered) return;
      const now = p.audio ? p.audio.currentTime : 0;
      const idx = findActiveIndex(viewLines, now);
      if (idx !== activeLine) {
        activeLine = idx;
        paintActive(idx);
      }
      paintWords(idx, now);
      if (follow) easeTowardActive();
    };
    rafId = W.requestAnimationFrame(step);
  }

  function stopLoop() {
    if (rafId) W.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function paintActive(idx) {
    const box = doc() && doc().getElementById("lyrics-text");
    if (!box) return;
    box.querySelectorAll(".llab-line").forEach((el) => {
      const i = Number(el.dataset.i);
      el.classList.toggle("now", i === idx);
      el.classList.toggle("past", i < idx);
    });
  }

  function paintWords(idx, now) {
    if (mode !== "word") return;
    const box = doc() && doc().getElementById("lyrics-text");
    if (!box) return;
    const lineEl = box.querySelector('.llab-line[data-i="' + idx + '"]');
    box.querySelectorAll(".llab-word.cur").forEach((el) => {
      if (!lineEl || !lineEl.contains(el)) { el.classList.remove("cur"); el.style.removeProperty("--fill"); }
    });
    box.querySelectorAll(".llab-word.on").forEach((el) => {
      if (!lineEl || !lineEl.contains(el)) el.classList.remove("on");
    });
    if (!lineEl) return;
    lineEl.querySelectorAll(".llab-word").forEach((el) => {
      const wt = el.dataset.wt === "" ? null : Number(el.dataset.wt);
      if (wt == null) return;
      if (now >= wt) {
        el.classList.add("on");
        el.classList.remove("cur");
        el.style.removeProperty("--fill");
      } else {
        el.classList.remove("on");
      }
    });
    // karaoke fill on the word being sung
    const words = lineEl.querySelectorAll(".llab-word");
    let activeWord = null;
    let nextT = null;
    words.forEach((el) => {
      const wt = el.dataset.wt === "" ? null : Number(el.dataset.wt);
      if (wt == null) return;
      if (wt <= now) activeWord = el;
      else if (nextT == null) nextT = wt;
    });
    if (activeWord) {
      const start = Number(activeWord.dataset.wt);
      const end = nextT != null ? nextT : start + 0.4;
      const pct = end > start ? Math.max(0, Math.min(1, (now - start) / (end - start))) : 1;
      if (pct < 1) {
        activeWord.classList.add("cur");
        activeWord.classList.remove("on");
        activeWord.style.setProperty("--fill", (pct * 100).toFixed(1) + "%");
      }
    }
  }

  // -------------------------------------------------------------- scroll
  function lyricsScroller() {
    return doc() && doc().getElementById("lyrics-scroll");
  }

  function targetForActive() {
    const sc = lyricsScroller();
    const box = doc() && doc().getElementById("lyrics-text");
    if (!sc || !box || activeLine < 0) return null;
    const line = box.querySelector('.llab-line[data-i="' + activeLine + '"]');
    if (!line) return null;
    const scRect = sc.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const offsetInContent = lineRect.top - scRect.top + sc.scrollTop;
    return Math.max(0, offsetInContent - sc.clientHeight * 0.4 + lineRect.height / 2);
  }

  function scrollToActive() {
    const sc = lyricsScroller();
    const target = targetForActive();
    if (!sc || target == null) return;
    sc.scrollTop = target;
    expectedTop = sc.scrollTop;
  }

  // Smooth follow that we control, so programmatic writes stay distinguishable
  // from the user's own scrolling.
  function easeTowardActive() {
    const sc = lyricsScroller();
    const target = targetForActive();
    if (!sc || target == null) return;
    const reduce = W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const diff = target - sc.scrollTop;
    if (Math.abs(diff) < 0.6) return;
    sc.scrollTop = reduce ? target : sc.scrollTop + diff * 0.18;
    expectedTop = sc.scrollTop;
  }

  function setFollow(on, silent) {
    follow = !!on;
    syncFollowUi();
    if (follow) {
      startLoop();
      const p = player();
      const now = p && p.audio ? p.audio.currentTime : 0;
      activeLine = findActiveIndex(viewLines, now);
      paintActive(activeLine);
      const sc = lyricsScroller();
      const box = doc() && doc().getElementById("lyrics-text");
      if (sc && box && activeLine >= 0) {
        const line = box.querySelector('.llab-line[data-i="' + activeLine + '"]');
        if (line) {
          sc.scrollTop = Math.max(0, line.offsetTop - sc.clientHeight * 0.4 + line.offsetHeight / 2);
          expectedTop = sc.scrollTop;
        }
      }
    }
    if (!silent) saveSetting(SETTING.autoscroll, follow);
  }

  function syncFollowUi() {
    const fb = doc() && doc().getElementById("llab-follow");
    if (fb) fb.classList.toggle("hidden", follow || !rendered);
    const chip = doc() && doc().getElementById("llab-auto-scroll");
    if (chip) chip.classList.toggle("on", follow);
    const view = doc() && doc().getElementById("lyrics");
    if (view) view.dataset.llabFollow = follow ? "1" : "0";
    const cb = doc() && doc().getElementById("llab-autoscroll");
    if (cb) cb.checked = autoDefault;
  }

  function userScrollIntent() {
    if (follow) setFollow(false);
  }

  function wireScrollGuards() {
    const sc = lyricsScroller();
    if (!sc || sc.dataset.llabWired === "1") return;
    sc.dataset.llabWired = "1";
    sc.addEventListener("scroll", () => {
      if (!rendered) return;
      if (Math.abs(sc.scrollTop - expectedTop) > 3) userScrollIntent();
    }, { passive: true });
    ["wheel", "touchstart", "touchmove", "pointerdown", "keydown"].forEach((evt) => {
      sc.addEventListener(evt, () => userScrollIntent(), { passive: true });
    });
  }

  function wireLineTaps() {
    const box = doc() && doc().getElementById("lyrics-text");
    if (!box || box.dataset.llabTaps === "1") return;
    box.dataset.llabTaps = "1";
    box.addEventListener("click", (e) => {
      const line = e.target.closest(".llab-line");
      if (!line) return;
      const t = line.dataset.t === "" ? null : Number(line.dataset.t);
      if (t == null) return;
      const p = player();
      if (p) p.seek(Math.max(0, t));
    });
  }

  // -------------------------------------------------------------- settings
  function mountSettings(root) {
    ensure().then(() => {
      if (!doc()) return;
      const host = root || doc().getElementById("view");
      if (!host || host.querySelector("#llab-card")) return;
      const anchor = host.querySelector("#set-storage");
      const card = doc().createElement("div");
      card.id = "llab-card";
      card.className = "llab-card";
      card.innerHTML = `
        <div class="set-row">
          <div><div class="l">Lyrics Lab (beta)</div><div class="s">Auto-transcribe, sync pasted lyrics, import .lrc</div></div>
          <input type="checkbox" class="ios" id="llab-enabled" aria-label="Lyrics Lab beta">
        </div>
        <div id="llab-extra">
          <div class="llab-field">
            <label class="l" for="llab-key">Groq API key</label>
            <input class="llab-input" type="password" id="llab-key" placeholder="gsk_…" autocomplete="off" spellcheck="false" autocapitalize="off">
            <div class="llab-row">
              <button class="btn ghost" id="llab-test" type="button">Test key</button>
              <span class="llab-hint" id="llab-key-state"></span>
            </div>
          </div>
          <div class="set-row">
            <div><div class="l">Lyrics language</div><div class="s">What Whisper should expect</div></div>
            <select class="llab-select" id="llab-lang" aria-label="Lyrics language">
              ${LANGS.map(([v, label]) => `<option value="${v}">${label}</option>`).join("")}
            </select>
          </div>
          <div class="set-row">
            <div><div class="l">Auto-scroll lyrics</div><div class="s">Default for the lyrics view</div></div>
            <input type="checkbox" class="ios" id="llab-autoscroll" aria-label="Auto-scroll lyrics">
          </div>
          <p class="llab-note">Uploads this song's audio to Groq. Free tier. Needs internet. The key stays on this device.</p>
        </div>`;
      if (anchor && anchor.closest(".set-row")) anchor.closest(".set-row").before(card);
      else host.appendChild(card);

      const en = doc().getElementById("llab-enabled");
      const extra = doc().getElementById("llab-extra");
      const keyEl = doc().getElementById("llab-key");
      const keyState = doc().getElementById("llab-key-state");
      const langEl = doc().getElementById("llab-lang");
      const autoEl = doc().getElementById("llab-autoscroll");

      en.checked = enabled;
      extra.classList.toggle("hidden", !enabled);
      keyEl.value = apiKey;
      langEl.value = language;
      autoEl.checked = autoDefault;

      en.onchange = async () => {
        enabled = en.checked;
        extra.classList.toggle("hidden", !enabled);
        await saveSetting(SETTING.enabled, enabled);
        mountNp();
        if (!enabled) teardownLyrics();
        else refreshLyricsView();
      };

      keyEl.addEventListener("change", async () => {
        apiKey = keyEl.value.trim();
        await saveSetting(SETTING.key, apiKey);
        keyState.textContent = apiKey ? "Saved on this device" : "";
        keyState.className = "llab-hint" + (apiKey ? " ok" : "");
      });

      doc().getElementById("llab-test").onclick = async () => {
        keyState.textContent = "Testing…";
        keyState.className = "llab-hint";
        const typed = keyEl.value.trim();
        if (typed !== apiKey) {
          apiKey = typed;
          await saveSetting(SETTING.key, apiKey);
        }
        try {
          const res = await testKey(apiKey);
          keyState.textContent = "Key works (" + res.models + " models)";
          keyState.className = "llab-hint ok";
        } catch (e) {
          keyState.textContent = e && e.code === "cors"
            ? "Couldn't reach Groq (CORS or network)"
            : (e && e.message) || "That key didn't work";
          keyState.className = "llab-hint bad";
        }
      };

      langEl.onchange = async () => {
        language = langEl.value;
        await saveSetting(SETTING.lang, language);
      };

      autoEl.onchange = async () => {
        autoDefault = autoEl.checked;
        await saveSetting(SETTING.autoscroll, autoDefault);
        if (autoDefault) setFollow(true); else setFollow(false);
      };
    });
  }

  // ----------------------------------------------------------------- api
  const api = {
    init,
    mountNp,
    mountSettings,
    onLyricsRendered,
    onLyricsClosed,
    refreshLyricsView,
    handlesHighlight,
    handlesAutoScroll,
    alignLyrics,
    parseLrc,
    toLrc,
    normalizeWord,
    tokenize,
    similarity,
    levenshtein,
    alignTokens,
    encodeWav16,
    prepareAudioForUpload,
    transcribeBlob, uploadFileFrom,
    normalizeTranscript,
    testKey,
    importLrcFile,
    lrcTextFor,
    LrcError: LlabError,
    _state() {
      return { enabled, mode, language, follow, activeLine, offset: viewOffset, lines: viewLines, rendered, hasKey: !!apiKey };
    },
  };

  W.Lyra = W.Lyra || {};
  W.Lyra.lyricsSync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
