// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WelcomeMusicScore from "./WelcomeMusicScore";

afterEach(() => vi.useRealTimers());

it("makes every displayed note and each staff keyboard-accessible, then clears its pulse", () => {
  vi.useFakeTimers();
  const view = render(<WelcomeMusicScore />);
  const notes = screen.getAllByRole("button", { name: /Пульсировать ноту/ });
  const staffs = screen.getAllByRole("button", {
    name: "Подсветить нотную линейку",
  });
  expect(notes).toHaveLength(6);
  expect(staffs).toHaveLength(3);
  fireEvent.click(notes[0]);
  expect(
    view.container.querySelector(".welcome-score-note.is-pulsing"),
  ).toBeTruthy();
  fireEvent.keyDown(staffs[1], { key: "Enter" });
  expect(
    view.container.querySelector(".welcome-staff.is-pulsing"),
  ).toBeTruthy();
  act(() => vi.advanceTimersByTime(520));
  expect(view.container.querySelector(".is-pulsing")).toBeNull();
});
