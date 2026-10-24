/* Unit tests for alignLyrics — invented sentences only. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { alignLyrics, similarity } = require("../../lyrics-sync.js");

/** Build transcript words from a compact list: ["hello", 0, 0.4] */
function words(list) {
  return list.map(([word, start, end, probability]) => ({
    word,
    start,
    end: end == null ? start + 0.3 : end,
    probability: probability == null ? null : probability,
  }));
}

const HELLO = words([
  ["hello", 1.0, 1.4],
  ["brave", 1.4, 1.8],
  ["new", 1.8, 2.0],
  ["world", 2.0, 2.6],
]);

function assertMonotonic(lines) {
  let last = -Infinity;
  for (const line of lines) {
    if (line.t == null) continue;
    assert.ok(line.t >= last, `line time went backwards: ${line.t} after ${last}`);
    last = line.t;
    let wlast = -Infinity;
    for (const w of line.words || []) {
      if (w.t == null) continue;
      assert.ok(w.t >= wlast, `word time went backwards: ${w.t} after ${wlast}`);
      wlast = w.t;
    }
  }
}

test("exact match: every word matches, times come from the transcript", () => {
  const res = alignLyrics("hello brave new world", HELLO);
  assert.equal(res.total, 4);
  assert.equal(res.matched, 4);
  assert.equal(res.matchRate, 1);
  assert.equal(res.lines.length, 1);
  assert.equal(res.lines[0].t, 1.0);
  assert.equal(res.lines[0].words[0].t, 1.0);
  assert.equal(res.lines[0].words[3].t, 2.0);
  assertMonotonic(res.lines);
});

test("misheard word: 'word' still matches 'world' above the threshold", () => {
  const res = alignLyrics("hello brave new word", HELLO);
  assert.ok(similarity("word", "world") >= 0.7);
  assert.equal(res.matched, 4);
  assert.equal(res.matchRate, 1);
  assert.equal(res.lines[0].words[3].t, 2.0);
});

test("missing word: an extra word is interpolated between its neighbours", () => {
  const res = alignLyrics("hello there brave new world", HELLO);
  assert.equal(res.total, 5);
  assert.equal(res.matched, 4);
  assert.ok(Math.abs(res.matchRate - 0.8) < 1e-9);
  const extra = res.lines[0].words[1];
  assert.equal(extra.text, "there");
  assert.ok(extra.t >= 1.4 && extra.t <= 1.8, `interpolated ${extra.t}`);
  assertMonotonic(res.lines);
});

test("repeated chorus: lines map to successive occurrences, not the same one", () => {
  const transcript = words([
    ["la", 1.0, 1.2], ["la", 1.2, 1.4], ["la", 1.4, 1.6],
    ["la", 3.0, 3.2], ["la", 3.2, 3.4], ["la", 3.4, 3.6],
  ]);
  const res = alignLyrics("la la la\nla la la", transcript);
  assert.equal(res.matched, 6);
  assert.equal(res.matchRate, 1);
  assert.equal(res.lines[0].t, 1.0);
  assert.equal(res.lines[1].t, 3.0);
  assert.ok(res.lines[1].t > res.lines[0].t);
  assertMonotonic(res.lines);
});

test("total mismatch: no invented timings and a 0% match", () => {
  const res = alignLyrics("completely different words here", words([["zzz", 1, 2], ["qqq", 2, 3]]));
  assert.equal(res.matched, 0);
  assert.equal(res.matchRate, 0);
  for (const line of res.lines) assert.equal(line.t, null);
  assertMonotonic(res.lines);
});

test("word probabilities are carried through and can be null", () => {
  const transcript = words([["hello", 1, 1.4, 0.42], ["world", 2, 2.4, 0.93]]);
  const res = alignLyrics("hello world", transcript);
  assert.equal(res.lines[0].words[0].p, 0.42);
  assert.equal(res.lines[0].words[1].p, 0.93);
});

test("empty input is safe", () => {
  const a = alignLyrics("", HELLO);
  assert.equal(a.matchRate, 0);
  assert.equal(a.lines.length, 1);
  const b = alignLyrics("hello", []);
  assert.equal(b.matchRate, 0);
  assert.equal(b.lines[0].t, null);
});
