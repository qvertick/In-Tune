// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import WelcomeChords, { WELCOME_CHORDS } from "./WelcomeChords";
afterEach(cleanup);
it("shows four standard voicings in low E to high e order with open and muted strings", () => {
  expect(WELCOME_CHORDS.map((chord) => chord.frets)).toEqual([
    [-1, 0, 2, 2, 1, 0],
    [-1, 3, 2, 0, 1, 0],
    [3, 2, 0, 0, 0, 3],
    [0, 2, 2, 0, 0, 0],
  ]);
  const view = render(<WelcomeChords />);
  expect(
    screen.getByRole("img", { name: "Аппликатура Am: × · 0 · 2 · 2 · 1 · 0" }),
  ).toBeTruthy();
  expect(view.container.querySelectorAll(".chord-string")).toHaveLength(6);
  expect(view.container.querySelectorAll(".chord-open")).toHaveLength(2);
  expect(view.container.querySelectorAll(".chord-mute")).toHaveLength(1);
});
it("switches on hover, focus, touch click and arrow keys with a single tab stop", () => {
  const view = render(<WelcomeChords />);
  fireEvent.pointerEnter(screen.getByRole("radio", { name: "G" }), {
    pointerType: "mouse",
  });
  expect(
    screen.getByRole("radio", { name: "G" }).getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.focus(screen.getByRole("radio", { name: "C" }));
  expect(
    screen.getByRole("radio", { name: "C" }).getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("radio", { name: "Em" }));
  expect(
    screen.getByRole("img", { name: "Аппликатура Em: 0 · 2 · 2 · 0 · 0 · 0" }),
  ).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("radio", { name: "Em" }), {
    key: "ArrowRight",
  });
  expect(document.activeElement).toBe(
    screen.getByRole("radio", { name: "Am" }),
  );
  expect(
    view.container.querySelectorAll('[role="radio"][tabindex="0"]'),
  ).toHaveLength(1);
});
