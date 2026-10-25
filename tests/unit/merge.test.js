/* Unit tests for mergeTranscripts — voting between passes, invented content. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeTranscripts } = require("../../lyrics-sync.js");

// Each run is what one Groq pass returned.
function run(...words) {
  return {
    text: words.map((w) => (Array.isArray(w) ? w[0] : w)).join(" "),
    words: words.map((w, i) => {
      const [word, start, end] = Array.isArray(w) ? w : [w, i * 0.5, i * 0.5 + 0.4];
      return { word, start, end };
    }),
  };
}

function texts(merged) {
  return merged.words.map((w) => w.word);
}

test("identical passes merge to the same words and full agreement", () => {
  const a = run(["one", 0, 0.4], ["two", 0.4, 0.8], ["three", 0.8, 1.2]);
  const b = run(["one", 0, 0.4], ["two", 0.4, 0.8], ["three", 0.8, 1.2]);
  const c = run(["one", 0, 0.4], ["two", 0.4, 0.8], ["three", 0.8, 1.2]);
  const merged = mergeTranscripts([a, b, c]);
  assert.deepEqual(texts(merged), ["one", "two", "three"]);
  assert.equal(merged.passes, 3);
  assert.equal(merged.agreement, 1);
  assert.equal(merged.conflicts, 0);
  assert.equal(merged.fixed, 0);
});

test("a word two passes heard wins over the odd one out", () => {
  const a = run(["say", 0, 0.4], ["bottle", 0.4, 0.9], ["now", 0.9, 1.2]);
  const b = run(["say", 0, 0.4], ["battle", 0.4, 0.9], ["now", 0.9, 1.2]);
  const c = run(["say", 0, 0.4], ["battle", 0.4, 0.9], ["now", 0.9, 1.2]);
  const merged = mergeTranscripts([a, b, c]);
  assert.deepEqual(texts(merged), ["say", "battle", "now"]);
  assert.equal(merged.fixed, 1, "the skeleton's word was corrected");
  assert.equal(merged.conflicts, 1);
  assert.equal(merged.agreement < 1, true);
});

test("punctuation differences are not counted as disagreements", () => {
  // Two passes drop the apostrophe; that is the same word to a listener, so the
  // cleaner spelling is kept rather than the merge inventing a second word.
  const a = run(["I'm", 0, 0.3], ["gone", 0.3, 0.7]);
  const b = run(["Im", 0, 0.3], ["gone", 0.3, 0.7]);
  const c = run(["Im", 0, 0.3], ["gone", 0.3, 0.7]);
  const merged = mergeTranscripts([a, b, c]);
  assert.deepEqual(texts(merged), ["I'm", "gone"]);
  assert.equal(merged.fixed, 0);
  assert.equal(merged.agreement, 1, "all three passes heard the same words");
  assert.equal(merged.added, 0);
});

test("a word two passes heard and one missed is added back with a time", () => {
  const a = run(["down", 0, 0.5], ["the", 1.6, 1.9], ["road", 1.9, 2.3]);
  const b = run(["down", 0, 0.5], ["the", 0.9, 1.2], ["long", 1.2, 1.6], ["road", 1.9, 2.3]);
  const c = run(["down", 0, 0.5], ["the", 1.6, 1.9], ["long", 1.9, 2.1], ["road", 2.1, 2.3]);
  const merged = mergeTranscripts([a, b, c]);
  assert.ok(texts(merged).includes("long"), "added: " + texts(merged).join(" "));
  assert.equal(merged.added, 1);
  const long = merged.words.find((w) => w.word === "long");
  assert.ok(long.start >= 0 && long.end > long.start);
});

test("a word only one pass heard is not invented", () => {
  const a = run(["keep", 0, 0.5], ["this", 0.5, 1]);
  const b = run(["keep", 0, 0.5], ["ghost", 0.5, 0.8], ["this", 0.9, 1.2]);
  const c = run(["keep", 0, 0.5], ["this", 0.5, 1]);
  const merged = mergeTranscripts([a, b, c]);
  assert.equal(texts(merged).includes("ghost"), false);
  assert.equal(merged.added, 0);
});

test("timestamps stay monotonic across the merged result", () => {
  const a = run(["a", 3, 3.4], ["b", 3.4, 3.8], ["c", 3.8, 4.2]);
  const b = run(["a", 1, 1.4], ["x", 1.4, 1.8], ["b", 2.4, 2.8], ["c", 2.8, 3.2]);
  const c = run(["a", 3, 3.4], ["b", 3.4, 3.8], ["c", 3.8, 4.2]);
  const merged = mergeTranscripts([a, b, c]);
  let last = -1;
  merged.words.forEach((w) => {
    assert.ok(w.start >= last, "start went backwards at " + w.word);
    assert.ok(w.end > w.start, "end is after start at " + w.word);
    last = w.start;
  });
});

test("one good pass is used as it is", () => {
  const merged = mergeTranscripts([run(["only", 0, 0.4], ["one", 0.4, 0.8])]);
  assert.deepEqual(texts(merged), ["only", "one"]);
  assert.equal(merged.passes, 1);
  assert.equal(merged.agreement, 1);
});

test("a failed pass is ignored, empty input is safe", () => {
  const only = run(["kept", 0, 0.4]);
  const merged = mergeTranscripts([null, only, { words: [] }]);
  assert.deepEqual(texts(merged), ["kept"]);
  assert.equal(merged.passes, 1);
  assert.equal(mergeTranscripts([]), null);
  assert.equal(mergeTranscripts(null), null);
});

test("a hallucinated extra-long pass is not used as the skeleton", () => {
  const clean = run(["real", 0, 0.4], ["words", 0.4, 0.9], ["here", 0.9, 1.3]);
  const noisy = run(
    ["real", 0, 0.4], ["words", 0.4, 0.9], ["here", 0.9, 1.3],
    ["real", 1.4, 1.8], ["words", 1.8, 2.2], ["here", 2.2, 2.6], ["real", 2.6, 3.0]
  );
  const merged = mergeTranscripts([clean, noisy, clean]);
  assert.deepEqual(texts(merged), ["real", "words", "here"], "the repeated tail is not kept");
});
