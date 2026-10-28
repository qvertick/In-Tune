import { describe, expect, it } from "vitest";
import { createSong } from "./model";
import {
  activeAt,
  mapDuration,
  markEnd,
  markStart,
  playerMap,
  shiftTimings,
  TextClock,
} from "./playerTiming";

describe("manual timing and map", () => {
  it("does not generate timing for an untimed song or consume review/nonfinite boundaries", () => {
    const song = createSong(true);
    expect(playerMap(song, 90)).toEqual([]);
    expect(mapDuration(song)).toBe(0);
    song.sections[0].lines[0].start = NaN;
    song.sections[0].lines[0].end = 2;
    song.sections[0].lines[1].start = 3;
    song.sections[0].lines[1].end = 5;
    song.sections[0].lines[1].timingReview = true;
    expect(playerMap(song, 90)).toEqual([]);
  });
  it("highlights only inside known intervals, including gaps and exact boundaries", () => {
    const song = createSong(true),
      line = song.sections[0].lines[0];
    line.start = 2;
    line.end = 4;
    const map = playerMap(song, 90);
    expect(activeAt(map, 1)).toBeNull();
    expect(activeAt(map, 2)).toBe(line.id);
    expect(activeAt(map, 4)).toBeNull();
  });
  it("marks actual times, closes the previous line, preserves chord temporal anchors and finishes the last line", () => {
    const song = createSong(true),
      [a, b] = song.sections[0].lines;
    a.chords[0].start = 2.75;
    a.chords[0].end = 7;
    const marked = markStart(markStart(song, a.id, 2), b.id, 8, a.id);
    expect(marked.sections[0].lines[0].end).toBe(8);
    expect(marked.sections[0].lines[0].chords).toBe(a.chords);
    expect(markEnd(marked, b.id, 12).sections[0].lines[1].end).toBe(12);
    expect(song.sections[0].lines[0].start).toBeUndefined();
    expect(() => markStart(marked, b.id, 1)).toThrow(/порядок/);
    expect(() => markEnd(marked, b.id, 7)).toThrow();
  });
  it("shifts line, word and chord anchors explicitly and rejects negative timestamps", () => {
    const song = createSong(true),
      line = song.sections[0].lines[0];
    line.start = 2;
    line.end = 8;
    line.chords[0].start = 3;
    line.words = [{ text: "word", start: 2.5, end: 4 }];
    const shifted = shiftTimings(song, -1).sections[0].lines[0];
    expect(shifted.start).toBe(1);
    expect(shifted.words?.[0].start).toBe(1.5);
    expect(shifted.chords[0].start).toBe(2);
    expect(() => shiftTimings(song, -3)).toThrow();
    expect(line.start).toBe(2);
  });
  it("uses monotonic elapsed time for text, rebasing pauses, seeks and speed changes", () => {
    let now = 1000;
    const clock = new TextClock(() => now);
    clock.play();
    now += 2000;
    expect(clock.position()).toBe(2);
    clock.setRate(0.5);
    now += 2000;
    expect(clock.position()).toBe(3);
    clock.pause();
    now += 3000;
    expect(clock.position()).toBe(3);
    clock.seek(10);
    clock.play();
    now += 1000;
    expect(clock.position()).toBe(10.5);
  });
});
