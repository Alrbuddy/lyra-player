/* Unit tests for linesFromWords — turning a transcript into synced lines. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "..", "lyrics-sync.js"), "utf8");
const match = SRC.match(/const LINE_WORDS = 7;[\s\S]*?function linesFromWords\(words\)[\s\S]*?\n  }\n/);
if (!match) throw new Error("linesFromWords not found in lyrics-sync.js");
// eslint-disable-next-line no-new-func
const linesFromWords = new Function(match[0] + "\n return linesFromWords;")();

const w = (word, start, end, probability) => ({ word, start, end, probability });

test("groups words into lines and keeps every word", () => {
  const words = [
    w("one", 0, 0.4, 0.9), w("two", 0.4, 0.8, 0.9), w("three", 0.8, 1.2, 0.9),
    w("four", 1.2, 1.6, 0.9), w("five", 1.6, 2.0, 0.9), w("six", 2.0, 2.4, 0.9),
    w("seven", 2.4, 2.8, 0.9), w("eight", 2.8, 3.2, 0.9), w("nine", 3.2, 3.6, 0.9),
  ];
  const lines = linesFromWords(words);
  assert.ok(lines.length >= 2, "wraps rather than one endless line");
  assert.equal(lines.flatMap((l) => l.words).length, words.length, "no words dropped");
  for (const l of lines) {
    assert.ok(l.text.length > 0);
    assert.ok(l.words.length <= 7, "line has " + l.words.length + " words");
    assert.equal(typeof l.t, "number");
    assert.ok(l.end >= l.t);
    for (const wd of l.words) {
      assert.equal(typeof wd.text, "string");
      assert.ok(Number.isFinite(wd.t) && Number.isFinite(wd.e), "word timing present");
      assert.ok(wd.t <= wd.e);
    }
  }
});

test("a pause starts a new line", () => {
  const lines = linesFromWords([w("hello", 0, 0.5), w("there", 0.5, 1.0), w("again", 2.2, 2.6)]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "hello there");
  assert.equal(lines[1].text, "again");
  assert.ok(lines[1].t > 2);
});

test("punctuation ends a line", () => {
  const lines = linesFromWords([w("stop.", 0, 0.5), w("Next", 0.5, 0.9), w("line", 0.9, 1.2)]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "stop.");
  assert.equal(lines[1].text, "Next line");
});

test("timestamps are monotonic even when the transcript jitters", () => {
  const lines = linesFromWords([w("a", 5, 5.4), w("b", 1, 1.4), w("c", 9, 9.4)]);
  let last = -Infinity;
  for (const l of lines) {
    assert.ok(l.t > last, "line start must move forward");
    assert.ok(l.end > l.t);
    last = l.t;
  }
});

test("a word without timing still lands somewhere sane", () => {
  const lines = linesFromWords([w("one", 2, 2.5), { word: "two" }, w("three", 6, 6.4)]);
  const all = lines.flatMap((l) => l.words);
  assert.equal(all.length, 3);
  assert.ok(Number.isFinite(all[1].t) && Number.isFinite(all[1].e));
  assert.ok(all[1].t >= 2.5, "inherits a time after the previous word");
});

test("empty input is safe", () => {
  assert.deepEqual(linesFromWords([]), []);
  assert.deepEqual(linesFromWords(null), []);
});
