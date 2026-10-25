/* Unit tests for the chunked-transcription helpers: the plan, the stitcher and
 * the timing spread. Invented words only, no audio. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chunkPlan,
  finalizeWords,
  spreadSegmentWords,
  chunkScore,
  syllables,
} = require("../../lyrics-sync.js");

test("a 100 s song becomes four overlapping chunks that cover all of it", () => {
  const plan = chunkPlan(100);
  assert.equal(plan.length, 4);
  assert.deepEqual(plan[0], { start: 0, end: 28 });
  assert.deepEqual(plan[1], { start: 25, end: 53 });
  assert.deepEqual(plan[3], { start: 75, end: 100 });
  assert.equal(plan[0].start, 0, "starts at the top of the song");
  assert.equal(plan[plan.length - 1].end, 100, "reaches the end");
  for (let i = 1; i < plan.length; i++) {
    assert.ok(plan[i].start < plan[i - 1].end, "chunk " + i + " overlaps the one before it");
    assert.equal(plan[i].start, plan[i - 1].end - 3, "3 s of shared audio");
  }
});

test("a short song is a single upload, and a sliver is folded into the previous chunk", () => {
  assert.deepEqual(chunkPlan(20), [{ start: 0, end: 20 }]);
  assert.deepEqual(chunkPlan(28), [{ start: 0, end: 28 }]);
  assert.deepEqual(chunkPlan(29), [{ start: 0, end: 29 }], "the 4 s tail does not cost its own request");
  assert.deepEqual(chunkPlan(0), []);
});

test("chunk size and overlap are settable, for tests and long files", () => {
  const plan = chunkPlan(60, { chunkSeconds: 10, overlap: 2 });
  assert.deepEqual(plan, [
    { start: 0, end: 12 },
    { start: 10, end: 22 },
    { start: 20, end: 32 },
    { start: 30, end: 42 },
    { start: 40, end: 52 },
    { start: 50, end: 60 },
  ]);
});

test("each chunk's words are shifted onto the song's clock and kept once", () => {
  const words = finalizeWords([
    {
      chunk: { start: 0, end: 28 },
      words: [
        { word: "alpha", start: 1, end: 1.4, probability: 0.9 },
        { word: "beta", start: 26.5, end: 26.9, probability: 0.8 },
      ],
    },
    {
      chunk: { start: 25, end: 53 },
      words: [
        { word: "beta", start: 26.5, end: 27.1, probability: 0.6 },
        { word: "gamma", start: 30, end: 30.4, probability: 0.9 },
      ],
    },
  ]);
  assert.deepEqual(words.map((w) => w.word), ["alpha", "beta", "gamma"], "the shared word survives once");
  // 26.7 s sits in the second half of the 25-28 s overlap, and a word is owned
  // by the chunk that heard it with the audio that follows it.
  assert.equal(words[1].probability, 0.6, "the later chunk owns the second half of the overlap");
  assert.deepEqual(words.map((w) => w.start), [1, 26.5, 30]);
});

test("a word the owner heard differently in the overlap is not doubled", () => {
  const words = finalizeWords([
    { chunk: { start: 0, end: 28 }, words: [{ word: "Im", start: 26.4, end: 26.8 }] },
    { chunk: { start: 25, end: 53 }, words: [{ word: "I'm", start: 26.5, end: 26.9 }] },
  ]);
  assert.equal(words.length, 1, "Im and I'm are the same word: " + JSON.stringify(words));
});

test("timings are forced monotonic even when two decodes disagree", () => {
  const words = finalizeWords([
    { chunk: { start: 0, end: 28 }, words: [
      { word: "one", start: 3.0, end: 3.2 },
      { word: "two", start: 2.0, end: 2.2 },
    ] },
  ]);
  assert.equal(words.length, 2);
  assert.ok(words[1].start > words[0].start, "later word never starts before an earlier one");
  assert.ok(words[1].end > words[1].start, "every word has length");
});

test("no runs means no words, and junk entries are skipped", () => {
  assert.deepEqual(finalizeWords([]), []);
  assert.deepEqual(finalizeWords([{ chunk: { start: 0, end: 10 }, words: [{ start: 1, end: 2 }] }]), []);
});

test("bunched word times are spread across the segment by syllables", () => {
  const seg = [{ start: 0, end: 4 }];
  const bunched = [
    { word: "murder", start: 0, end: 0.1 },
    { word: "one", start: 0, end: 0.1 },
    { word: "aint", start: 0, end: 0.1 },
    { word: "time", start: 0, end: 0.1 },
  ];
  const out = spreadSegmentWords(bunched, seg);
  assert.equal(out[0].start, 0);
  assert.equal(out[out.length - 1].end, 4, "the line ends with its segment");
  // 2 + 1 + 1 + 1 syllables over 4 s: the first word gets 1.6 s.
  assert.ok(Math.abs(out[0].end - 1.6) < 0.01, "got " + out[0].end);
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].start >= out[i - 1].end - 0.001, "no overlap between words");
  }
});

test("word times that already fit the segment are left alone", () => {
  const seg = [{ start: 0, end: 5 }];
  const real = [
    { word: "keep", start: 0.3, end: 0.9 },
    { word: "these", start: 1.2, end: 1.8 },
    { word: "exactly", start: 2.4, end: 3.6 },
  ];
  const out = spreadSegmentWords(real, seg);
  assert.deepEqual(out.map((w) => [w.start, w.end]), [[0.3, 0.9], [1.2, 1.8], [2.4, 3.6]]);
});

test("without segments the timings are untouched", () => {
  const words = [{ word: "only", start: 2, end: 2.4 }];
  assert.deepEqual(spreadSegmentWords(words, []), words);
});

test("a repetition loop scores worse than a clean chunk", () => {
  assert.equal(chunkScore([]), 0);
  assert.equal(chunkScore([{ compression_ratio: 1.4, avg_logprob: -0.1 }]), 0);
  assert.equal(chunkScore([{ compression_ratio: 1.4, avg_logprob: -1.2 }]), 1);
  assert.equal(chunkScore([{ compression_ratio: 3.2, avg_logprob: -0.1 }]), 2);
  assert.equal(chunkScore([{ compression_ratio: 9, avg_logprob: -2 }]), 3);
});

test("syllables are counted the way a rapper says them", () => {
  assert.equal(syllables("a"), 1);
  assert.equal(syllables("the"), 1);
  assert.equal(syllables("time"), 1, "silent e");
  assert.equal(syllables("murder"), 2);
  assert.equal(syllables("crazy"), 2);
  assert.equal(syllables("rhythm"), 1);
  assert.equal(syllables(""), 1);
});
