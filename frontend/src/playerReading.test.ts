import { expect, it } from "vitest";
import { createSong, id, type Line } from "./model";
import {
  chordIntervals,
  readingRows,
  readingState,
  vocalEnd,
} from "./playerReading";
import { linePresentation, sectionPresentation } from "./songPresentation";
import { wordPlan } from "./wordTiming";

function fixture() {
  const song = createSong(true),
    [a, b, c, d] = song.sections[0].lines;
  a.start = 30;
  a.end = 34;
  b.start = 37;
  b.end = 40;
  c.start = 70;
  c.end = 75;
  d.start = 80;
  d.end = 85;
  const intro: Line = {
    id: id(),
    text: "       }х4",
    chords: song.palette.slice(0, 3).map((p, i) => ({
      id: id(),
      paletteId: p.id,
      offset: i * 3,
      source: "manual",
    })),
  };
  const strum: Line = {
    id: id(),
    text: "Бой: ↓ * ↓↑ — x",
    start: 2,
    chords: [],
  };
  const solo: Line = { ...intro, id: id(), text: "       }x2" };
  song.sections = [
    { id: id(), name: "Песня", lines: [strum] },
    { id: id(), name: "Вступление х4", lines: [intro] },
    { id: id(), name: "Куплет", lines: [a, b] },
    { id: id(), name: "Проигрыш х2", lines: [solo] },
    { id: id(), name: "Куплет 2", lines: [c, d] },
  ];
  return { song, a, b, c, d, intro, strum, solo };
}
it("derives repetition and chord metadata without modifying source text or anchors", () => {
  const { song, intro } = fixture(),
    before = JSON.stringify(song);
  expect(linePresentation(intro)).toMatchObject({
    kind: "instrumental",
    repeats: 4,
  });
  expect(sectionPresentation(song.sections[1])).toEqual({
    name: "Вступление",
    repeats: 4,
  });
  expect(
    linePresentation({ ...intro, text: "E5 G5 F#5 G5 }x2", chords: [] }),
  ).toMatchObject({
    kind: "instrumental",
    names: ["E5", "G5", "F#5", "G5"],
    repeats: 2,
  });
  expect(linePresentation({ ...intro, text: "Бой за нами" }).kind).toBe(
    "vocal",
  );
  expect(JSON.stringify(song)).toBe(before);
});
it("shows instrumental intro and upcoming vocals without needing an active word", () => {
  const { song, a, intro, strum } = fixture(),
    state = readingState(readingRows(song), 0);
  expect(state.activeId).toBeNull();
  expect(state.focusId).toBe(a.id);
  expect(state.next?.line).toBe(a);
  expect(state.afterNext?.line.text).toBe(song.sections[2].lines[1].text);
  expect(state.countdown).toBe(30);
  expect(state.strum).toBe(strum);
  expect(state.instrument[0].line).toBe(intro);
  expect(wordPlan(strum, 2, 30, true)).toBeUndefined();
});
it("clears sung highlighting exactly at a known phrase end and previews the next line", () => {
  const { song, a, b } = fixture(),
    rows = readingRows(song);
  expect(readingState(rows, 33.9).activeId).toBe(a.id);
  const gap = readingState(rows, 34);
  expect(gap.activeId).toBeNull();
  expect(gap.current?.line).toBe(a);
  expect(gap.next?.line).toBe(b);
  expect(gap.focusId).toBe(b.id);
  expect(gap.countdown).toBe(3);
  expect(readingState(rows, 37).activeId).toBe(b.id);
});
it("holds an instrumental group for a long break rather than advancing fictional chord cycles", () => {
  const { song, c, solo } = fixture(),
    rows = readingRows(song);
  for (const time of [40, 48, 69.9]) {
    const state = readingState(rows, time);
    expect(state.activeId).toBeNull();
    expect(state.focusId).toBe(c.id);
    expect(state.instrument.map((r) => r.line)).toEqual([solo]);
  }
  expect(chordIntervals(solo)).toEqual([]);
});
it("does not invent phrase endings or skip untimed upcoming vocals in a partial map", () => {
  const { song, a, b } = fixture();
  delete a.end;
  delete b.start;
  delete b.end;
  const rows = readingRows(song),
    before = JSON.stringify(song);
  for (const time of [32, 45, 68]) {
    const state = readingState(rows, time);
    expect(state.phase).toBe("uncertain");
    expect(state.activeId).toBeNull();
    expect(state.next?.line).toBe(b);
    expect(state.countdown).toBeUndefined();
  }
  expect(vocalEnd(a)).toBeUndefined();
  expect(JSON.stringify(song)).toBe(before);
});
it("restores the correct context on backward and forward seeks", () => {
  const { song, a, c } = fixture(),
    rows = readingRows(song);
  expect(readingState(rows, 72).activeId).toBe(c.id);
  expect(readingState(rows, 10).next?.line).toBe(a);
  expect(readingState(rows, 31).activeId).toBe(a.id);
});
it("does not assign an untimed outro to a last lyric ending at the file boundary", () => {
  const { song, d, intro } = fixture();
  song.audio = { filename: "own.mp3", url: "/own.mp3", duration: 90 };
  d.end = 90;
  song.sections.push({
    id: id(),
    name: "Концовка х16",
    lines: [{ ...intro, id: id() }],
  });
  const before = JSON.stringify(song),
    state = readingState(readingRows(song), 87);
  expect(state.activeId).toBeNull();
  expect(state.endNeedsReview).toBe(true);
  expect(state.phase).toBe("uncertain");
  expect(state.instrumentPreview).toBe(true);
  expect(state.instrument[0].section.name).toBe("Концовка х16");
  expect(JSON.stringify(song)).toBe(before);
});
it("uses complete source word endings but never estimates them from another line", () => {
  const { a } = fixture();
  delete a.end;
  a.words = a.text
    .split(/\s+/)
    .map((text, i) => ({ text, start: 30 + i, end: 31 + i }));
  expect(vocalEnd(a)).toBe(a.words.at(-1)?.end);
  delete a.words;
  a.wordStarts = a.text
    .split(/\s+/)
    .map((text, i) => ({ text, start: 30 + i }));
  expect(vocalEnd(a)).toBeUndefined();
});
it("uses only actual chord intervals, preserving order and repeated occurrences", () => {
  const { intro } = fixture();
  intro.chords[0].start = 2;
  intro.chords[1].start = 5;
  intro.chords[1].end = 7;
  intro.chords[2].start = 9;
  expect(chordIntervals(intro)).toEqual([
    { id: intro.chords[0].id, start: 2, end: 5 },
    { id: intro.chords[1].id, start: 5, end: 7 },
  ]);
  intro.timingReview = true;
  expect(chordIntervals(intro)).toEqual([]);
});
