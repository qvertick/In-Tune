// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WelcomeDemo, { demoTimeline } from "./WelcomeDemo";
let intersection: IntersectionObserverCallback;
let reduced = false;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("matchMedia", () => ({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback;
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "hidden");
  reduced = false;
});
function visible(el: Element, ratio: number) {
  act(() =>
    intersection(
      [
        { target: el, isIntersecting: ratio > 0, intersectionRatio: ratio },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
}
function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}
function current(root: HTMLElement) {
  return root.querySelector(".is-current-word")?.textContent;
}
it("autoplays only sufficiently visible and advances words, lines and chords with a real loop pause", () => {
  const view = render(<WelcomeDemo />),
    root = view.container.querySelector(".welcome-demo")!;
  expect(vi.getTimerCount()).toBe(0);
  visible(root, 0.2);
  expect(vi.getTimerCount()).toBe(0);
  visible(root, 0.5);
  expect(vi.getTimerCount()).toBe(1);
  expect(current(view.container)).toContain("Тихий");
  expect(view.container.querySelector(".is-current-chord")?.textContent).toBe(
    "Am",
  );
  advance(2300);
  expect(current(view.container)).toContain("на");
  expect(view.container.querySelector(".is-current-chord")?.textContent).toBe(
    "G",
  );
  advance(1900);
  expect(current(view.container)).toContain("Этот");
  const plan = demoTimeline([
    "Тихий свет ложится на ладони.",
    "Этот ритм останется со мной.",
    "Пусть звучит ещё одна история.",
    "Пой со мной. Играй со мной.",
  ]);
  advance(plan.words.at(-1)!.end - 4200 + 10);
  expect(view.container.querySelector(".is-current-word")).toBeNull();
  advance(plan.duration - plan.words.at(-1)!.end + 10);
  expect(current(view.container)).toContain("Тихий");
});
it("pauses, resumes and restarts without losing or accumulating elapsed time", () => {
  const view = render(<WelcomeDemo />),
    root = view.container.querySelector(".welcome-demo")!;
  visible(root, 0.5);
  advance(1500);
  fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
  const word = current(view.container);
  expect(vi.getTimerCount()).toBe(0);
  advance(9000);
  expect(current(view.container)).toBe(word);
  fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
  advance(1000);
  expect(current(view.container)).not.toBe(word);
  fireEvent.click(screen.getByRole("button", { name: "Сначала" }));
  expect(current(view.container)).toContain("Тихий");
  advance(800);
  expect(current(view.container)).toContain("свет");
});
it("freezes offscreen and in hidden tabs, preserves its place on visibility notifications and releases all timers", () => {
  const view = render(<WelcomeDemo />),
    root = view.container.querySelector(".welcome-demo")!;
  visible(root, 0.5);
  advance(1500);
  const word = current(view.container);
  visible(root, 0);
  expect(vi.getTimerCount()).toBe(0);
  advance(10000);
  visible(root, 0.6);
  expect(current(view.container)).toBe(word);
  visible(root, 0.7);
  expect(vi.getTimerCount()).toBe(1);
  act(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(vi.getTimerCount()).toBe(0);
  advance(5000);
  act(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(current(view.container)).toBe(word);
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it("has a static reduced-motion presentation with manual next line and restart, and no timer", () => {
  reduced = true;
  const view = render(<WelcomeDemo />),
    root = view.container.querySelector(".welcome-demo")!;
  visible(root, 1);
  expect(vi.getTimerCount()).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Следующая строка" }));
  expect(current(view.container)).toContain("Этот");
  fireEvent.click(screen.getByRole("button", { name: "Сначала" }));
  expect(current(view.container)).toContain("Тихий");
});
