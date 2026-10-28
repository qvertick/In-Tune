import { expect, it } from "vitest";
import { REWIND_MS, shouldRewind, VisualSeekClock } from "./visualSeek";

it.each([5, 7, 10])(
  "animates a backward jump of %s seconds inclusively",
  (distance) => {
    expect(shouldRewind(30, 30 - distance, true, false)).toBe(true);
  },
);
it.each([3, 20, 0, -7, 4.999, 10.001])(
  "does not animate a jump of %s seconds",
  (distance) => {
    expect(shouldRewind(30, 30 - distance, true, false)).toBe(false);
  },
);
it("handles start jumps, reduced motion and disabled highlighting", () => {
  expect(shouldRewind(8, 0, true, false)).toBe(true);
  expect(shouldRewind(60, 0, true, false)).toBe(false);
  expect(shouldRewind(8, 1, false, false)).toBe(false);
  expect(shouldRewind(8, 1, true, true)).toBe(false);
});
it("only interpolates presentation, landing on the live audio time even while it advances", () => {
  let now = 1000;
  const clock = new VisualSeekClock(() => now);
  clock.begin(15, 8, true, false);
  expect(clock.read(8)).toBe(15);
  now += REWIND_MS / 2;
  expect(clock.read(8.175)).toBeCloseTo(9.88125);
  now += REWIND_MS / 2;
  expect(clock.read(8.35)).toBe(8.35);
  expect(clock.moving).toBe(false);
  clock.begin(8, 1, true, false);
  now += REWIND_MS;
  expect(clock.read(1)).toBe(1); // paused audio
});
it("replaces earlier transitions and cancels without seeking anything", () => {
  let now = 0;
  const clock = new VisualSeekClock(() => now);
  clock.begin(20, 13, true, false);
  now = 100;
  const displayed = clock.read(13);
  clock.begin(13, 6, true, false, displayed);
  expect(clock.read(6)).toBe(displayed);
  clock.cancel();
  expect(clock.read(6)).toBe(6);
  clock.begin(13, 6, false, false);
  expect(clock.moving).toBe(false);
});
