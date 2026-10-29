// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import WelcomeGuitars from "./WelcomeGuitars";

it("offers four guitar outlines and selects them by click and arrow keys", () => {
  render(<WelcomeGuitars />);
  const guitars = screen.getAllByRole("radio");
  expect(guitars.map((guitar) => guitar.textContent)).toEqual([
    "Акустическая",
    "Трансакустическая",
    "Электрогитара",
    "Электроакустическая",
  ]);
  fireEvent.click(guitars[2]);
  expect(guitars[2].getAttribute("aria-checked")).toBe("true");
  fireEvent.keyDown(guitars[2], { key: "ArrowRight" });
  expect(guitars[3].getAttribute("aria-checked")).toBe("true");
});
