// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Welcome from "./Welcome";
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("offers Continue only for an existing supplied song and preserves its user title", () => {
  const open = vi.fn(),
    view = render(<Welcome onLibrary={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /Продолжить/ })).toBeNull();
  view.rerender(
    <Welcome
      onLibrary={vi.fn()}
      onContinue={open}
      lastTitle="Песня {original}"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Продолжить/ }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Песня {original}")).toBeTruthy();
});
it("uses four real section anchors with described tooltips and reduced motion native jumps", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const view = render(<Welcome onLibrary={vi.fn()} />);
  const section = view.container.querySelector("#welcome-sound")!;
  const scroll = vi.fn();
  Object.defineProperty(section, "scrollIntoView", { value: scroll });
  fireEvent.click(screen.getByRole("button", { name: "03 — Твой звук" }));
  expect(scroll).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
  expect(view.container.querySelectorAll(".welcome-rail button")).toHaveLength(
    4,
  );
  expect(view.container.querySelectorAll(".rail-minors button")).toHaveLength(
    0,
  );
  expect(
    screen
      .getByRole("button", { name: "03 — Твой звук" })
      .getAttribute("aria-describedby"),
  ).toBe("rail-card-2");
  expect(
    view.container.querySelector(".welcome-hero")?.getAttribute("data-light"),
  ).toBe("static");
});
it("runs actual search, synchronization and mixer actions without sending requests or playing audio on welcome", () => {
  const library = vi.fn(),
    workspace = vi.fn();
  const view = render(
    <Welcome onLibrary={library} onWorkspace={workspace} lastTitle="Тест" />,
  );
  const steps = view.container.querySelectorAll("[data-workflow-step]");
  fireEvent.click(steps[0]);
  expect(library).toHaveBeenCalledWith(true);
  fireEvent.click(steps[1]);
  expect(workspace).toHaveBeenCalledWith("sync");
  fireEvent.click(steps[2]);
  expect(workspace).toHaveBeenCalledWith("mixer");
  expect(view.container.querySelector("audio,video")).toBeNull();
  expect(screen.getByText("Демонстрация · без звука")).toBeTruthy();
});
