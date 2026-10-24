/* Unit tests for normalizeTranscript — the Groq response shape, invented content. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeTranscript } = require("../../lyrics-sync.js");

test("reads words and text from a verbose_json payload", () => {
  const out = normalizeTranscript({
    text: "hello there",
    language: "en",
    words: [
      { word: "hello", start: 1, end: 1.4 },
      { word: "there", start: 1.4, end: 1.8 },
    ],
    segments: [{ start: 1, end: 1.8, avg_logprob: -0.1, text: "hello there" }],
  }, "en");
  assert.equal(out.text, "hello there");
  assert.equal(out.words.length, 2);
  assert.equal(out.words[0].strip, undefined);
  assert.equal(out.words[1].start, 1.4);
  assert.equal(out.language, "en");
});

test("falls back to words nested in segments", () => {
  const out = normalizeTranscript({
    segments: [
      { start: 0, end: 2, avg_logprob: -0.2, words: [{ word: "alpha", start: 0.2, end: 0.6 }] },
      { start: 2, end: 4, avg_logprob: -0.2, words: [{ word: "beta", start: 2.2, end: 2.6 }] },
    ],
  }, "es");
  assert.deepEqual(out.words.map((w) => w.word), ["alpha", "beta"]);
  assert.equal(out.language, "es", "language falls back to the requested one");
});

test("segment avg_logprob becomes a probability estimate below 0.5 when unsure", () => {
  const out = normalizeTranscript({
    words: [
      { word: "clear", start: 0.2, end: 0.6 },
      { word: "mumbled", start: 2.2, end: 2.6 },
    ],
    segments: [
      { start: 0, end: 1, avg_logprob: -0.05 },
      { start: 2, end: 3, avg_logprob: -1.2 },
    ],
  }, "en");
  assert.ok(out.words[0].probability > 0.9, "confident word: " + out.words[0].probability);
  assert.ok(out.words[1].probability < 0.5, "unsure word: " + out.words[1].probability);
});

test("an explicit word probability wins over the segment estimate", () => {
  const out = normalizeTranscript({
    words: [{ word: "explicit", start: 0.2, end: 0.6, probability: 0.31 }],
    segments: [{ start: 0, end: 1, avg_logprob: -0.01 }],
  }, "en");
  assert.equal(out.words[0].probability, 0.31);
});

test("no segment data leaves probability null instead of guessing", () => {
  const out = normalizeTranscript({ words: [{ word: "only", start: 1, end: 1.2 }] }, "en");
  assert.equal(out.words[0].probability, null);
});

test("empty payload is safe", () => {
  const out = normalizeTranscript(null, "en");
  assert.deepEqual(out.words, []);
  assert.equal(out.text, "");
});
