import { expect, it } from "vitest";
import { wordPhase, wordPlan } from "./wordTiming";
import type { Line } from "./model";

const line: Line = { id: "line", text: "Тихий свет, иди", chords: [] };
it("paints verified starts while keeping estimated ends out of the document", () => {
  const source = {
    ...line,
    start: 1,
    end: 20,
    wordStarts: [
      { text: "Тихий", start: 1 },
      { text: "свет,", start: 3 },
      { text: "иди", start: 5 },
    ],
  };
  const before = JSON.stringify(source);
  const plan = wordPlan(source, 1, 20, false)!;
  expect(plan.kind).toBe("word-starts");
  expect(plan.words.map((w) => w.start)).toEqual([1, 3, 5]);
  expect(plan.words.at(-1)?.end).toBe(7.5);
  expect(JSON.stringify(source)).toBe(before);
});
it("uses verified source word intervals and preserves gaps", () => {
  const words = [
    { text: "Тихий", start: 1, end: 2 },
    { text: "свет,", start: 2.5, end: 3 },
    { text: "иди", start: 4, end: 5 },
  ];
  expect(wordPlan({ ...line, words, start: 1, end: 6 }, 1, 6, true)).toEqual({
    kind: "exact",
    words,
  });
  expect(wordPhase(2.2, words[0])).toBe("past");
  expect(wordPhase(2.2, words[1])).toBe("future");
});
it("estimates only bounded line intervals without saving fabricated word timings", () => {
  const original = JSON.stringify(line);
  const plan = wordPlan(line, 2, 6, true)!;
  expect(plan.kind).toBe("approximate");
  expect(plan.words[0].start).toBe(2);
  expect(plan.words.at(-1)?.end).toBe(6);
  expect(plan.words[1].end - plan.words[1].start).toBeGreaterThan(
    plan.words[2].end - plan.words[2].start,
  );
  expect(JSON.stringify(line)).toBe(original);
  expect(wordPlan(line, 2, 6, false)).toBeUndefined();
  expect(wordPlan(line, 2, 50, true)).toBeUndefined();
  expect(wordPlan(line, 2, undefined, true)).toBeUndefined();
  expect(wordPlan({ ...line, timingReview: true }, 2, 6, true)).toBeUndefined();
  expect(wordPlan({ ...line, text: "↓ ↑ × ↓ ↑" }, 2, 6, true)).toBeUndefined();
});
it("changes phases on exact boundaries and when seeking backwards", () => {
  const word = { start: 2, end: 4 };
  expect([1, 2, 3.9, 4, 2.5, 0].map((time) => wordPhase(time, word))).toEqual([
    "future",
    "active",
    "active",
    "past",
    "active",
    "future",
  ]);
});
