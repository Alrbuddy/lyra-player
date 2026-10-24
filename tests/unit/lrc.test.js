/* Unit tests for parseLrc / toLrc — invented lines only. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseLrc, toLrc } = require("../../lyrics-sync.js");

test("parses simple timestamps", () => {
  const { lines } = parseLrc("[00:01.00]first line\n[00:03.50]second line\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0].t, 1);
  assert.equal(lines[0].text, "first line");
  assert.equal(lines[1].t, 3.5);
});

test("multiple timestamps on one line repeat the text", () => {
  const { lines } = parseLrc("[00:10.00][01:20.00]chorus line");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.text), ["chorus line", "chorus line"]);
  assert.deepEqual(lines.map((l) => l.t), [10, 80]);
});

test("word-level tags are parsed and removed from the text", () => {
  const { lines } = parseLrc("[00:05.00]<00:05.00>hold <00:05.40>the <00:05.80>line");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "hold the line");
  assert.equal(lines[0].words.length, 3);
  assert.equal(lines[0].words[0].t, 5);
  assert.ok(Math.abs(lines[0].words[1].t - 5.4) < 1e-9);
  assert.ok(Math.abs(lines[0].words[2].t - 5.8) < 1e-9);
});

test("metadata and offset are honoured, order is sorted", () => {
  const { lines, meta, offset } = parseLrc("[ar:Test Artist]\n[ti:Test Song]\n[offset:500]\n[00:10.00]late\n[00:02.00]early");
  assert.equal(meta.ar, "Test Artist");
  assert.equal(meta.ti, "Test Song");
  assert.equal(offset, 0.5);
  assert.deepEqual(lines.map((l) => l.text), ["early", "late"]);
  assert.ok(Math.abs(lines[0].t - 1.5) < 1e-9);
  assert.ok(Math.abs(lines[1].t - 9.5) < 1e-9);
});

test("timestamps are monotonic and lines get an end", () => {
  const { lines } = parseLrc("[00:00.00]a\n[00:02.00]b\n[00:02.00]b again\n[00:04.00]c");
  for (let i = 1; i < lines.length; i++) assert.ok(lines[i].t >= lines[i - 1].t);
  assert.equal(lines[0].end, 2);
  assert.ok(lines[3].end > lines[3].t);
});

test("untimed lines are kept but never given a time", () => {
  const { lines } = parseLrc("[00:01.00]timed\nplain text\n");
  const plain = lines.find((l) => l.text === "plain text");
  assert.ok(plain);
  assert.equal(plain.t, null);
});

test("toLrc round-trips text and word tags", () => {
  const lines = [
    { t: 1, text: "one two", words: [{ text: "one", t: 1 }, { text: "two", t: 1.5 }] },
    { t: 5.25, text: "three", words: null },
  ];
  const out = toLrc(lines, { title: "T", artist: "A" });
  assert.match(out, /\[ti:T\]/);
  assert.match(out, /\[ar:A\]/);
  assert.match(out, /\[00:01\.00\]<00:01\.00>one <00:01\.50>two/);
  assert.match(out, /\[00:05\.25\]three/);
  const back = parseLrc(out);
  assert.equal(back.lines.length, 2);
  assert.equal(back.lines[0].text, "one two");
  assert.equal(back.lines[1].t, 5.25);
});
