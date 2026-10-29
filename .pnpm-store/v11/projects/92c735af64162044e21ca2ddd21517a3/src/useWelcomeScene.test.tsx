// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWelcomeLight } from "./useWelcomeScene";
let frames: Map<number, FrameRequestCallback>,
  count: number,
  visible: (entries: Partial<IntersectionObserverEntry>[]) => void;
let fine = true,
  reduced = false;
beforeEach(() => {
  frames = new Map();
  count = 0;
  fine = true;
  reduced = false;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++count, fn);
    return count;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced") ? reduced : fine,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(fn: typeof visible) {
        visible = fn;
      }
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "hidden");
});
function Host() {
  const ref = useRef<HTMLElement>(null);
  useWelcomeLight(ref);
  return <section ref={ref} data-testid="hero" />;
}
it("coalesces pointer updates into one frame without React pointer state and fades on leave", () => {
  const view = render(<Host />),
    hero = view.getByTestId("hero");
  hero.getBoundingClientRect = () => new DOMRect(100, 50, 800, 600);
  fireEvent(
    hero,
    new MouseEvent("pointermove", { clientX: 200, clientY: 150 }),
  );
  fireEvent(
    hero,
    new MouseEvent("pointermove", { clientX: 300, clientY: 220 }),
  );
  expect(frames.size).toBe(1);
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((fn) => fn(100));
  });
  expect(hero.style.getPropertyValue("--light-x")).toBe("200px");
  expect(hero.style.getPropertyValue("--light-y")).toBe("170px");
  expect(hero.style.getPropertyValue("--light-opacity")).toBe("1");
  fireEvent(hero, new Event("pointerleave"));
  expect(hero.style.getPropertyValue("--light-opacity")).toBe("0");
});
it("stops offscreen and in hidden tabs, resumes only when visible, and cleans pending frames", () => {
  const view = render(<Host />),
    hero = view.getByTestId("hero");
  act(() => visible([{ target: hero, isIntersecting: false }]));
  fireEvent(hero, new MouseEvent("pointermove"));
  expect(frames.size).toBe(0);
  act(() => visible([{ target: hero, isIntersecting: true }]));
  fireEvent(hero, new MouseEvent("pointermove"));
  expect(frames.size).toBe(1);
  act(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(frames.size).toBe(0);
  fireEvent(hero, new MouseEvent("pointermove"));
  expect(frames.size).toBe(0);
  act(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  fireEvent(hero, new MouseEvent("pointermove"));
  expect(frames.size).toBe(1);
  view.unmount();
  expect(frames.size).toBe(0);
});
it.each(["touch", "reduced"])(
  "uses a static spotlight for %s and never intercepts gestures",
  (mode) => {
    fine = mode !== "touch";
    reduced = mode === "reduced";
    const view = render(<Host />),
      hero = view.getByTestId("hero");
    expect(hero.dataset.light).toBe("static");
    fireEvent(hero, new MouseEvent("pointermove"));
    expect(frames.size).toBe(0);
  },
);
