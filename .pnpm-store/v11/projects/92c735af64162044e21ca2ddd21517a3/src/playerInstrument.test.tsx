// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InstrumentSequence } from "./playerInstrument";
import { createSong, id } from "./model";
let frames: Map<number, FrameRequestCallback>,
  serial = 0;
beforeEach(() => {
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++serial, fn);
    return serial;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fixture() {
  const song = createSong(true),
    line = song.sections[0].lines[0];
  line.text = "}x4";
  line.chords = song.palette
    .slice(0, 3)
    .map((p, i) => ({
      id: id(),
      paletteId: p.id,
      offset: i,
      source: "manual",
      start: i * 4,
      end: (i + 1) * 4,
    }));
  return { song, line };
}
it("paints actual chord intervals and progress, freezes on pause, seeks immediately and clears loops", () => {
  const { song, line } = fixture();
  let time = 2;
  const read = () => time;
  const view = render(
    <InstrumentSequence
      line={line}
      song={song}
      position={time}
      playing
      readPosition={read}
    />,
  );
  const active = () =>
    view.container.querySelector<HTMLElement>('[aria-current="true"]');
  expect(active()?.textContent).toBe("Am");
  expect(active()?.style.getPropertyValue("--chord-progress")).toBe("50%");
  time = 6;
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn(100));
  });
  expect(active()?.textContent).toBe("F");
  expect(active()?.style.getPropertyValue("--chord-progress")).toBe("50%");
  view.rerender(
    <InstrumentSequence
      line={line}
      song={song}
      position={6}
      playing={false}
      readPosition={read}
    />,
  );
  expect(frames.size).toBe(0);
  time = 20;
  expect(active()?.textContent).toBe("F");
  view.rerender(
    <InstrumentSequence
      line={line}
      song={song}
      position={10}
      playing={false}
      readPosition={read}
    />,
  );
  expect(active()?.textContent).toBe("C");
  view.rerender(
    <InstrumentSequence
      line={line}
      song={song}
      position={2}
      playing
      readPosition={() => 2}
    />,
  );
  view.unmount();
  expect(frames.size).toBe(0);
});
it("never animates untimed repetitions and never paints disabled highlighting", () => {
  const { song, line } = fixture();
  line.chords = line.chords.map(
    ({ start: _start, end: _end, ...chord }) => chord,
  );
  const view = render(
    <InstrumentSequence
      line={line}
      song={song}
      position={20}
      playing
      readPosition={() => 20}
    />,
  );
  expect(frames.size).toBe(0);
  expect(view.container.querySelector("[aria-current]")).toBeNull();
  expect(view.container.querySelectorAll(".instrument-chord")).toHaveLength(3);
  const timed = fixture();
  view.rerender(
    <InstrumentSequence
      line={timed.line}
      song={timed.song}
      position={2}
      playing
      highlighting={false}
      readPosition={() => 2}
    />,
  );
  expect(frames.size).toBe(0);
  expect(view.container.querySelector("[aria-current]")).toBeNull();
});
it("uses static chord indication under reduced motion rather than a moving fill", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const { song, line } = fixture();
  const view = render(
    <InstrumentSequence
      line={line}
      song={song}
      position={2}
      readPosition={() => 2}
    />,
  );
  expect(
    view.container
      .querySelector<HTMLElement>("[aria-current]")
      ?.style.getPropertyValue("--chord-progress"),
  ).toBe("100%");
});
