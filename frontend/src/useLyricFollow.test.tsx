// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef, useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLyricFollow } from "./useLyricFollow";
import type { LyricFollowOptions } from "./useLyricFollow";

type Result = ReturnType<typeof useLyricFollow>;
let resizeCallbacks: ResizeObserverCallback[];
let disconnect: ReturnType<typeof vi.fn>;
let fonts: EventTarget & { ready: Promise<void> };
let frames: Map<number, FrameRequestCallback>;
let frameId: number;

beforeEach(() => {
  resizeCallbacks = [];
  disconnect = vi.fn();
  frames = new Map();
  frameId = 0;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  // Keep initial font readiness pending until a test explicitly resolves it.
  fonts = Object.assign(new EventTarget(), {
    ready: new Promise<void>(() => {}),
  });
  vi.stubGlobal("innerHeight", 1000);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: fonts,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "fonts");
});

function box(top: number, height = 24, left = 100, width = 100) {
  return new DOMRect(left, top, width, height);
}

function draw(timestamp: number) {
  act(() => {
    const callbacks = Array.from(frames.values());
    frames.clear();
    callbacks.forEach((callback) => callback(timestamp));
  });
}

function fixture(
  initial: Partial<Omit<LyricFollowOptions, "root" | "reader">> = {},
) {
  const root = createRef<HTMLDivElement>();
  const reader = createRef<HTMLDivElement>();
  let result: Result;
  let rowTop = 900;
  let wordTop = 900;
  let readerTop = 100;
  let transportTop = 650;
  let glyphTops = [900, 900, 900, 900];
  let tools = false;
  let props = {
    playing: false,
    disabled: false,
    activeId: "a" as string | null,
    fontSize: 32,
    moving: false,
    ...initial,
  };
  let main: HTMLElement;
  let row: HTMLElement;
  let word: HTMLElement;
  let glyphs: HTMLElement[];
  const readerScroll = vi.fn((settings: ScrollToOptions) => {
    reader.current!.scrollTop = settings.top ?? 0;
    reader.current!.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const mainScroll = vi.fn((settings: ScrollToOptions) => {
    main.scrollTop = settings.top ?? 0;
    main.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const shift = () => (tools ? main.scrollTop : reader.current!.scrollTop);
  function Host() {
    useLayoutEffect(() => {
      const surface = root.current!;
      const lyrics = reader.current!;
      main = surface.querySelector(".player-main")!;
      row = surface.querySelector(".player-line")!;
      word = surface.querySelector(".lyric-word")!;
      glyphs = Array.from(surface.querySelectorAll(".letter"));
      surface.getBoundingClientRect = () => box(50, 800, 0, 800);
      main.getBoundingClientRect = () => box(100, 600, 0, 600);
      lyrics.getBoundingClientRect = () =>
        box(readerTop - (tools ? main.scrollTop : 0), 600, 0, 600);
      const transport =
        surface.querySelector<HTMLElement>(".player-transport")!;
      transport.getBoundingClientRect = () => box(transportTop, 200, 0, 800);
      row.getBoundingClientRect = () => box(rowTop - shift(), 1000);
      word.getBoundingClientRect = () => box(wordTop - shift(), 900);
      glyphs.forEach((glyph, index) => {
        glyph.getBoundingClientRect = vi.fn(() =>
          box(glyphTops[index] - shift()),
        );
      });
      Object.defineProperties(lyrics, {
        clientHeight: { configurable: true, value: 600 },
        clientWidth: { configurable: true, value: 580 },
        scrollHeight: { configurable: true, value: 4000 },
      });
      Object.defineProperties(main, {
        clientHeight: { configurable: true, value: 600 },
        clientWidth: { configurable: true, value: 580 },
        scrollHeight: { configurable: true, value: 5000 },
      });
      lyrics.style.overflowY = "auto";
      main.style.overflowY = "auto";
      Object.defineProperty(lyrics, "scrollTo", {
        configurable: true,
        value: readerScroll,
      });
      Object.defineProperty(main, "scrollTo", {
        configurable: true,
        value: mainScroll,
      });
    }, []);
    result = useLyricFollow({ reader, root, ...props });
    return (
      <div ref={root}>
        <div className="player-main" tabIndex={0}>
          <div ref={reader} className="player-lyrics" tabIndex={0}>
            <button className="player-line" aria-current="step">
              <span
                className="lyric-word word-active"
                style={{ "--word-progress": "0%" } as React.CSSProperties}
              >
                {["a", "b", "c", "d"].map((letter) => (
                  <span className="letter" key={letter}>
                    {letter}
                  </span>
                ))}
              </span>
            </button>
          </div>
        </div>
        <footer className="player-transport" />
      </div>
    );
  }
  const view = render(<Host />);
  return {
    view,
    readerScroll,
    mainScroll,
    root,
    get api() {
      return result!;
    },
    get reader() {
      return reader.current!;
    },
    get main() {
      return main;
    },
    get row() {
      return row;
    },
    get word() {
      return word;
    },
    get glyphs() {
      return glyphs;
    },
    layout(settings: {
      rowTop?: number;
      wordTop?: number;
      glyphTops?: number[];
      readerTop?: number;
      transportTop?: number;
    }) {
      rowTop = settings.rowTop ?? rowTop;
      wordTop = settings.wordTop ?? wordTop;
      glyphTops = settings.glyphTops ?? glyphTops;
      readerTop = settings.readerTop ?? readerTop;
      transportTop = settings.transportTop ?? transportTop;
    },
    tools() {
      tools = true;
      reader.current!.style.overflowY = "visible";
    },
    rerender(settings: Partial<typeof props>) {
      props = { ...props, ...settings };
      view.rerender(<Host />);
    },
  };
}

it("anchors the active glyph at 30% of the reader clipped by transport, with no repeated scrolling", () => {
  const f = fixture({ playing: true });
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 635,
    behavior: "instant",
  });
  expect(f.mainScroll).not.toHaveBeenCalled();
  for (let i = 0; i < 20; i++) act(() => f.api.update());
  expect(f.readerScroll).toHaveBeenCalledTimes(1);
  expect(f.api.suspended).toBe(false);
});

it("follows an upcoming row through an instrumental gap without an active word or sung aria-current", () => {
  const f = fixture({ playing: true });
  f.row.removeAttribute("aria-current");
  f.row.dataset.followRow = "true";
  f.word.classList.remove("word-active");
  f.word.removeAttribute("data-follow-word");
  f.layout({ glyphTops: [1200, 1200, 1200, 1200] });
  act(() => f.api.update({ force: true }));
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 935,
    behavior: "instant",
  });
  expect(f.row.hasAttribute("aria-current")).toBe(false);
});

it("reanchors a new row but only follows word movement when it leaves the reading zone", () => {
  const f = fixture({ playing: true });
  f.layout({ glyphTops: [1050, 1050, 1050, 1050] });
  act(() => f.api.update()); // 415 remains within the reading zone (155..457.5).
  expect(f.readerScroll).toHaveBeenCalledTimes(1);
  f.rerender({ activeId: "b" });
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 785,
    behavior: "instant",
  });
  f.layout({ glyphTops: [1300, 1300, 1300, 1300] });
  act(() => f.api.update());
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 1035,
    behavior: "instant",
  });
});

it("tracks progress glyphs of a word wrapping inside a much taller row, including reverse movement", () => {
  const f = fixture({ playing: true });
  f.layout({ rowTop: 100, wordTop: 100, glyphTops: [900, 1000, 1400, 1800] });
  f.word.style.setProperty("--word-progress", "60%");
  act(() => f.api.update());
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 1135,
    behavior: "instant",
  });
  f.word.style.setProperty("--word-progress", "100%");
  act(() => f.api.update());
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 1535,
    behavior: "instant",
  });
  f.rerender({ playing: false, moving: true });
  f.word.style.setProperty("--word-progress", "0%");
  act(() => f.api.update());
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 635,
    behavior: "instant",
  });
});

it("prefers logical follow markers when word highlighting is off", () => {
  const f = fixture();
  const logical = document.createElement("span");
  logical.dataset.followWord = "true";
  logical.style.setProperty("--word-progress", "0%");
  const glyph = document.createElement("span");
  glyph.className = "letter";
  glyph.textContent = "z";
  glyph.getBoundingClientRect = () => box(1200 - f.reader.scrollTop);
  logical.append(glyph);
  f.row.append(logical);
  f.rerender({ playing: true });
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 935,
    behavior: "instant",
  });
});

it("does not measure or move while paused, including layout/font/fullscreen notifications", () => {
  const f = fixture();
  act(() => {
    f.api.update();
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("fullscreenchange"));
    fonts.dispatchEvent(new Event("loadingdone"));
    resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
  });
  f.rerender({ activeId: "b", fontSize: 60 });
  expect(f.glyphs[0].getBoundingClientRect).not.toHaveBeenCalled();
  expect(f.readerScroll).not.toHaveBeenCalled();
  act(() => f.api.resume({ force: true }));
  draw(0);
  expect(f.readerScroll).toHaveBeenCalledTimes(1);
  f.layout({ glyphTops: [2000, 2000, 2000, 2000] });
  act(() => {
    f.api.update();
    window.dispatchEvent(new Event("resize"));
  });
  expect(f.readerScroll).toHaveBeenCalledTimes(1);
});

it.each(["wheel", "touchstart"])(
  "suspends immediately on %s until explicit resume, regardless of playback toggles",
  (type) => {
    const f = fixture({ playing: true });
    act(() => f.glyphs[0].dispatchEvent(new Event(type, { bubbles: true })));
    expect(f.api.suspended).toBe(true);
    f.layout({ glyphTops: [2000, 2000, 2000, 2000] });
    act(() => {
      f.api.update({ force: true });
      window.dispatchEvent(new Event("resize"));
      fonts.dispatchEvent(new Event("loadingdone"));
    });
    f.rerender({ playing: false });
    f.rerender({ playing: true });
    expect(f.readerScroll).toHaveBeenCalledTimes(1);
    act(() => f.api.resume());
    draw(0);
    expect(f.api.suspended).toBe(false);
    expect(f.readerScroll).toHaveBeenCalledTimes(2);
  },
);

it("does not mistake scroll events, row clicks or transport wheel input for manual browsing", () => {
  const f = fixture({ playing: true });
  fireEvent.scroll(f.reader);
  fireEvent.click(f.row);
  fireEvent.wheel(f.root.current!.querySelector(".player-transport")!);
  expect(f.api.suspended).toBe(false);
});

it("suspends for scrollbar drags but not pointer clicks on lyric content", () => {
  const f = fixture({ playing: true });
  // jsdom has no PointerEvent constructor; dispatch a mouse-shaped pointer event.
  act(() =>
    f.reader.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 200,
        clientY: 300,
        button: 0,
      }),
    ),
  );
  expect(f.api.suspended).toBe(false);
  act(() =>
    f.reader.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 590,
        clientY: 300,
        button: 0,
      }),
    ),
  );
  expect(f.api.suspended).toBe(true);
});

it.each(["PageUp", "PageDown", "Home", "End"])(
  "suspends %s only on focused scroll surfaces, preserving arrow seeking and child controls",
  (key) => {
    const f = fixture({ playing: true });
    f.row.focus();
    fireEvent.keyDown(f.row, { key });
    expect(f.api.suspended).toBe(false);
    f.reader.focus();
    fireEvent.keyDown(f.reader, { key: "ArrowUp" });
    fireEvent.keyDown(f.reader, { key: "ArrowDown" });
    fireEvent.keyDown(f.reader, { key: " " }); // Space belongs to the player's play/pause shortcut.
    expect(f.api.suspended).toBe(false);
    fireEvent.keyDown(f.reader, { key });
    expect(f.api.suspended).toBe(true);
  },
);

it("uses the actual parent owner with tools, even when the reader initially lies offscreen", () => {
  const f = fixture();
  f.tools();
  f.layout({ readerTop: 800, glyphTops: [1200, 1200, 1200, 1200] });
  f.rerender({ playing: true });
  expect(f.mainScroll).toHaveBeenLastCalledWith({
    top: 935,
    behavior: "instant",
  });
  expect(f.readerScroll).not.toHaveBeenCalled();
  fireEvent.wheel(f.main);
  expect(f.api.suspended).toBe(true);
});

it("resets to zero explicitly on pause, even before an active row exists", () => {
  const f = fixture({ activeId: null });
  f.reader.scrollTop = 420;
  fireEvent.wheel(f.reader);
  act(() => f.api.resume({ start: true }));
  draw(0);
  expect(f.api.suspended).toBe(false);
  expect(f.reader.scrollTop).toBe(0);
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 0,
    behavior: "instant",
  });
  act(() => f.api.update());
  expect(f.readerScroll).toHaveBeenCalledTimes(1);
});

it("plain resume returns to the active glyph on pause and remains still afterward", () => {
  const f = fixture();
  fireEvent.wheel(f.reader);
  act(() => f.api.resume());
  draw(0);
  expect(f.api.suspended).toBe(false);
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 635,
    behavior: "instant",
  });
  expect(frames.size).toBe(0);
  f.layout({ glyphTops: [1800, 1800, 1800, 1800] });
  act(() => f.api.update());
  expect(f.readerScroll).toHaveBeenCalledTimes(1);
});

it("polls visual time at most every 80 ms, follows paused transitions and cancels on stop/suspension", () => {
  let position = 1;
  const readPosition = vi.fn(() => position);
  const f = fixture({ playing: true, readPosition });
  expect(frames.size).toBe(1);
  draw(0);
  const measured = vi.mocked(f.glyphs[0].getBoundingClientRect).mock.calls
    .length;
  for (const timestamp of [16, 32, 48, 64]) draw(timestamp);
  expect(readPosition).toHaveBeenCalledTimes(1);
  expect(f.glyphs[0].getBoundingClientRect).toHaveBeenCalledTimes(measured);
  draw(80); // Unchanged visual clock: no redundant DOM geometry reads.
  expect(f.glyphs[0].getBoundingClientRect).toHaveBeenCalledTimes(measured);
  position = 2;
  f.layout({ glyphTops: [1400, 1400, 1400, 1400] });
  draw(160);
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 1135,
    behavior: "instant",
  });
  f.rerender({ playing: false, moving: true });
  position = 1;
  f.layout({ glyphTops: [900, 900, 900, 900] });
  draw(176);
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 635,
    behavior: "instant",
  });
  f.rerender({ moving: false });
  expect(frames.size).toBe(0);
  f.rerender({ playing: true });
  expect(frames.size).toBe(1);
  fireEvent.wheel(f.reader);
  expect(frames.size).toBe(0);
  act(() => f.api.resume());
  draw(200);
  expect(frames.size).toBe(1);
  f.view.unmount();
  expect(frames.size).toBe(0);
});

it("suspends frame work while the document is hidden and restarts on visibility", () => {
  const f = fixture({ playing: true });
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(frames.size).toBe(0);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(frames.size).toBe(1);
  f.view.unmount();
  expect(frames.size).toBe(0);
});

it("disables automatic and explicit following without suspending manual input", () => {
  const f = fixture({ playing: true, disabled: true });
  fireEvent.wheel(f.reader);
  act(() => f.api.resume({ force: true }));
  draw(0);
  expect(f.readerScroll).not.toHaveBeenCalled();
  expect(f.api.suspended).toBe(false);
  f.rerender({ disabled: false });
  expect(f.readerScroll).toHaveBeenCalledTimes(1);
});

it("remeasures while playing after resize, font loading and fullscreen changes", () => {
  const f = fixture({ playing: true });
  f.layout({ transportTop: 500 });
  act(() => fonts.dispatchEvent(new Event("loadingdone")));
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 680,
    behavior: "instant",
  });
  f.layout({ transportTop: 600 });
  act(() => document.dispatchEvent(new Event("fullscreenchange")));
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 650,
    behavior: "instant",
  });
  f.layout({ transportTop: 650 });
  act(() =>
    resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)),
  );
  expect(f.readerScroll).toHaveBeenLastCalledWith({
    top: 635,
    behavior: "instant",
  });
});

it("clamps at scroll boundaries and never tries scrolling an invisible viewport", () => {
  const f = fixture();
  f.layout({ glyphTops: [9000, 9000, 9000, 9000] });
  act(() => f.api.update({ force: true }));
  expect(f.reader.scrollTop).toBe(3400);
  f.layout({ glyphTops: [0, 0, 0, 0] });
  act(() => f.api.update({ force: true }));
  expect(f.reader.scrollTop).toBe(0);
  f.layout({ transportTop: 50 });
  act(() => f.api.update({ force: true }));
  expect(f.readerScroll).toHaveBeenCalledTimes(2);
});

it("removes event listeners, font callbacks and observers on unmount", () => {
  const f = fixture({ playing: true });
  const update = f.api.update;
  const resume = f.api.resume;
  const detached = f.reader;
  f.view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
  act(() => {
    fireEvent.wheel(detached);
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("fullscreenchange"));
    fonts.dispatchEvent(new Event("loadingdone"));
    resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
    update({ force: true });
    resume({ force: true });
  });
  expect(f.readerScroll).toHaveBeenCalledTimes(1);
});

it("animates toward the target over 220 ms and retargets from the actual intermediate position", () => {
  vi.mocked(window.matchMedia).mockReturnValue({
    matches: false,
  } as MediaQueryList);
  const f = fixture({ playing: true });
  expect(f.readerScroll).not.toHaveBeenCalled();
  draw(0);
  draw(110);
  const halfway = f.reader.scrollTop;
  expect(halfway).toBeGreaterThan(0);
  expect(halfway).toBeLessThan(635);
  f.layout({ glyphTops: [1400, 1400, 1400, 1400] });
  act(() => f.api.update());
  expect(f.reader.scrollTop).toBe(halfway);
  draw(120);
  expect(f.reader.scrollTop).toBe(halfway);
  draw(230);
  expect(f.reader.scrollTop).toBeGreaterThan(halfway);
  expect(f.reader.scrollTop).toBeLessThan(1135);
  draw(340);
  expect(f.reader.scrollTop).toBe(1135);
  const calls = f.readerScroll.mock.calls.length;
  draw(500);
  expect(f.readerScroll).toHaveBeenCalledTimes(calls);
});

it.each(["pause", "wheel", "touchstart", "disable"])(
  "cancels a tween immediately on %s, freezing the actual scroll position",
  (action) => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: false,
    } as MediaQueryList);
    const f = fixture({ playing: true });
    draw(0);
    draw(100);
    const frozen = f.reader.scrollTop;
    if (action === "pause") f.rerender({ playing: false });
    else if (action === "disable") f.rerender({ disabled: true });
    else
      act(() => f.reader.dispatchEvent(new Event(action, { bubbles: true })));
    expect(frames.size).toBe(0);
    draw(500);
    expect(f.reader.scrollTop).toBe(frozen);
  },
);

it("smoothly follows a reverse visual transition over 160 ms while audio is paused", () => {
  vi.mocked(window.matchMedia).mockReturnValue({
    matches: false,
  } as MediaQueryList);
  const f = fixture();
  f.reader.scrollTop = 1300;
  f.rerender({ moving: true });
  draw(0);
  draw(80);
  expect(f.reader.scrollTop).toBeGreaterThan(635);
  expect(f.reader.scrollTop).toBeLessThan(1300);
  draw(160);
  expect(f.reader.scrollTop).toBe(635);
  f.rerender({ moving: false });
  expect(frames.size).toBe(0);
});

it("queues resume measurement until the next committed visual row, including explicit seeks on pause", () => {
  vi.mocked(window.matchMedia).mockReturnValue({
    matches: false,
  } as MediaQueryList);
  const f = fixture();
  act(() => f.api.resume());
  expect(f.glyphs[0].getBoundingClientRect).not.toHaveBeenCalled();
  f.layout({ glyphTops: [1500, 1500, 1500, 1500] });
  f.rerender({ activeId: "b" });
  draw(0); // Resume measures the committed row and queues its tween.
  draw(16);
  draw(126);
  expect(f.reader.scrollTop).toBeGreaterThan(635);
  expect(f.reader.scrollTop).toBeLessThan(1235);
  draw(236);
  expect(f.reader.scrollTop).toBe(1235);
  expect(frames.size).toBe(0);
});

it("start resets instantly after commit, cancelling an existing tween", () => {
  vi.mocked(window.matchMedia).mockReturnValue({
    matches: false,
  } as MediaQueryList);
  const f = fixture({ playing: true });
  draw(0);
  draw(100);
  expect(f.reader.scrollTop).toBeGreaterThan(0);
  act(() => f.api.resume({ start: true }));
  f.rerender({ playing: false, activeId: null });
  draw(116);
  expect(f.reader.scrollTop).toBe(0);
  expect(frames.size).toBe(0);
});

it("cancels a queued resume if manual browsing occurs before commit", () => {
  const f = fixture();
  act(() => f.api.resume());
  fireEvent.wheel(f.reader);
  expect(frames.size).toBe(0);
  draw(0);
  expect(f.readerScroll).not.toHaveBeenCalled();
  expect(f.api.suspended).toBe(true);
});
