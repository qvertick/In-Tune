// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clamp01,
  nearestStep,
  sectionAt,
  useWelcomePosition,
} from "./welcomePosition";
let frames: Map<number, FrameRequestCallback>, frameId: number;
const disconnect = vi.fn();
beforeEach(() => {
  frames = new Map();
  frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++frameId, fn);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect = disconnect;
    },
  );
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 1000,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "hidden");
});
function draw() {
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((fn) => fn(0));
  });
}
function Host() {
  const ref = useRef<HTMLDivElement>(null);
  useWelcomePosition(ref);
  return (
    <div ref={ref}>
      <button data-section-mark />
      <button data-section-mark />
      <section data-welcome-section />
      <section data-welcome-section />
      <button data-workflow-step />
      <button data-workflow-step />
      <button data-workflow-step />
    </div>
  );
}
it("selects real sections and the nearest reading step, bounding the progress", () => {
  expect(sectionAt([0, 800, 1600, 2400], 1000)).toBe(1);
  expect(sectionAt([0, 800], -10)).toBe(0);
  expect(nearestStep([1000, 1200, 1400], 1260)).toBe(1);
  expect(clamp01(-1)).toBe(0);
  expect(clamp01(2)).toBe(1);
});
it("measures on layout changes, coalesces native scroll and changes reading state without repeated layout reads", () => {
  const view = render(<Host />),
    sections = view.container.querySelectorAll("[data-welcome-section]"),
    steps = view.container.querySelectorAll("[data-workflow-step]");
  const measured = vi.fn();
  [...sections, ...steps].forEach((el, i) => {
    el.getBoundingClientRect = () => {
      measured();
      return new DOMRect(
        0,
        [0, 800, 900, 1200, 1500][i] - window.scrollY,
        400,
        100,
      );
    };
  });
  draw();
  expect(measured).toHaveBeenCalledTimes(5);
  act(() => {
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 900,
    });
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("scroll"));
  });
  expect(frames.size).toBe(1);
  draw();
  expect(measured).toHaveBeenCalledTimes(5);
  expect(
    view.container
      .querySelectorAll("[data-section-mark]")[1]
      .getAttribute("aria-current"),
  ).toBe("location");
  expect(steps[1].getAttribute("aria-current")).toBe("step");
  act(() => window.dispatchEvent(new Event("resize")));
  draw();
  expect(measured).toHaveBeenCalledTimes(10);
  act(() => window.dispatchEvent(new Event("scroll")));
  expect(frames.size).toBe(1);
  view.unmount();
  expect(frames.size).toBe(0);
  act(() => window.dispatchEvent(new Event("scroll")));
  expect(frames.size).toBe(0);
  expect(disconnect).toHaveBeenCalled();
});
it("does no scroll work in a hidden tab and remeasures on return", () => {
  const view = render(<Host />);
  draw();
  act(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("scroll"));
  });
  expect(frames.size).toBe(0);
  act(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(frames.size).toBe(1);
  view.unmount();
  expect(frames.size).toBe(0);
});
