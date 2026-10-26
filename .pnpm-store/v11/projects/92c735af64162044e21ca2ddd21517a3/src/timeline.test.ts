import { describe, it, expect } from "vitest";
import { PerformanceClock, timeline, validWords } from "./timeline";
import { createSong, editLine } from "./model";

describe("monotonic accompaniment clock", () => {
  it.each([0.8, 1, 1.2])(
    "moves at %s, pauses, resumes and seeks without accumulating timer drift",
    (speed) => {
      let now = 10;
      const c = new PerformanceClock(() => now);
      c.seek(20);
      c.setSpeed(speed);
      c.start(3);
      now = 12;
      expect(c.position()).toBe(20);
      now = 18;
      expect(c.position()).toBeCloseTo(20 + 5 * speed);
      c.pause();
      now = 100;
      expect(c.position()).toBeCloseTo(20 + 5 * speed);
      c.start();
      now = 102;
      expect(c.position()).toBeCloseTo(20 + 7 * speed);
      c.seek(50);
      now = 104;
      expect(c.position()).toBeCloseTo(50 + 2 * speed);
    },
  );
  it("accounts for captured time; ignores obsolete generations and duplicate hypotheses", () => {
    let now = 0;
    const c = new PerformanceClock(() => now);
    c.start();
    now = 5;
    expect(c.correct({ songTime: 3, audioTime: 3, capturedAt: 3 }, 0)).toBe(
      true,
    );
    expect(c.correction).toBe(0); // NOT pulled back two seconds by the late response
    c.seek(30);
    now = 6;
    expect(c.correct({ songTime: 4, audioTime: 4, capturedAt: 4 }, 0)).toBe(
      false,
    );
    expect(c.position()).toBe(31);
    expect(c.correct({ songTime: 31, audioTime: 6, capturedAt: 6 }, 1)).toBe(
      true,
    );
    now = 7;
    expect(c.correct({ songTime: 31, audioTime: 6, capturedAt: 6 }, 1)).toBe(
      false,
    );
  });
  it("slews gently, requires repeated evidence for a large jump, rejects ancient audio", () => {
    let now = 0;
    const c = new PerformanceClock(() => now);
    c.start();
    now = 1;
    c.correct({ songTime: 1.5, audioTime: 1, capturedAt: 1 }, 0);
    expect(c.position()).toBe(1);
    now = 2;
    expect(c.position()).toBeCloseTo(2.15);
    expect(c.correct({ songTime: 20, audioTime: 2, capturedAt: 2 }, 0)).toBe(
      false,
    );
    now = 3;
    expect(c.correct({ songTime: 21, audioTime: 3, capturedAt: 3 }, 0)).toBe(
      true,
    );
    expect(c.position()).toBe(21);
    now = 10;
    expect(c.correct({ songTime: 22, audioTime: 4, capturedAt: 4 }, 0)).toBe(
      false,
    );
  });
  it("crosses expected instrumental gaps, but bounds prediction across missing vocals", () => {
    let now = 0;
    const c = new PerformanceClock(() => now);
    c.start();
    const line = createSong(true).sections[0].lines[0];
    const map = [
      { line, start: 0, end: 2, vocal: true },
      { line, start: 20, end: 40, vocal: true },
    ];
    now = 15;
    c.tick(map, true);
    expect(c.running).toBe(true);
    expect(c.state).toContain("проигрыш");
    now = 25;
    c.tick(map, true);
    expect(c.running).toBe(false);
    const held = c.position();
    now = 30;
    expect(c.tick(map, true)).toBe(held);
  });
  it("never treats partial/mismatched or edited word timing as a precise map", () => {
    const song = createSong(true),
      line = song.sections[0].lines[0];
    line.start = 1;
    line.end = 5;
    line.words = [{ text: "другой", start: 1, end: 2 }];
    expect(validWords(line)).toBe(false);
    expect(timeline(song)[0].end).toBe(5);
    song.sections[0].lines[0] = editLine(line, "Новый текст");
    expect(song.sections[0].lines[0].timingReview).toBe(true);
    expect(timeline(song)).toHaveLength(0);
  });
});
