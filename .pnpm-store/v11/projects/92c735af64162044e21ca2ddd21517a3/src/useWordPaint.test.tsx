// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useWordPaint } from "./useWordPaint";
import type { WordPlan } from "./wordTiming";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const plan: WordPlan = {
  kind: "exact",
  words: [
    { text: "Тихий", start: 1, end: 2 },
    { text: "свет", start: 2, end: 4 },
  ],
};
function Row({
  position,
  playing,
  read,
}: {
  position: number;
  playing: boolean;
  read: () => number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useWordPaint(ref, plan, position, true, playing, read);
  return (
    <div ref={ref}>
      <span className="lyric-word">
        <span className="letter">Тихий</span>
      </span>
      <span className="lyric-word">
        <span className="letter">свет</span>
      </span>
    </div>
  );
}
it("paints from media time, freezes on pause, handles seek/rate and cancels every frame on close", () => {
  let time = 1.5,
    next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((fn: FrameRequestCallback) => {
      frames.set(++next, fn);
      return next;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
  const read = () => time;
  const view = render(<Row position={time} playing={false} read={read} />);
  const words = () =>
    view.container.querySelectorAll<HTMLElement>(".lyric-word");
  expect(words()[0].classList.contains("word-active")).toBe(true);
  expect(frames.size).toBe(0);
  view.rerender(<Row position={time} playing read={read} />);
  time = 3; // A faster playbackRate advances currentTime, not an independent UI clock.
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((fn) => fn(100));
  });
  expect(words()[0].classList.contains("word-past")).toBe(true);
  expect(words()[1].classList.contains("word-active")).toBe(true);
  expect(words()[1].style.getPropertyValue("--word-progress")).toBe("50.0%");
  view.rerender(<Row position={3} playing={false} read={read} />);
  expect(frames.size).toBe(0);
  time = 1.25;
  view.rerender(<Row position={time} playing={false} read={read} />);
  expect(words()[0].classList.contains("word-active")).toBe(true);
  expect(words()[1].classList.contains("word-future")).toBe(true);
  view.rerender(<Row position={time} playing read={read} />);
  time = 3.5;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(words()[1].classList.contains("word-active")).toBe(true);
  expect(words()[1].style.getPropertyValue("--word-progress")).toBe("75.0%");
  view.unmount();
  expect(frames.size).toBe(0);
});
