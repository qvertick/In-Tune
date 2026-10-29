// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  initialRoute,
  NAV_KEYS,
  parseRoute,
  routePath,
  useNavigation,
} from "./navigation";
const song = "11111111-2222-4333-8444-555555555555";
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/library");
});
it("welcomes the first launch, then restores the last workspace without a forced onboarding loop", () => {
  expect(initialRoute("/")).toEqual({ view: "welcome" });
  localStorage.setItem(NAV_KEYS.seen, "true");
  expect(initialRoute("/")).toEqual({ view: "library" });
  localStorage.setItem(NAV_KEYS.last, `/songs/${song}`);
  expect(initialRoute("/")).toEqual({ view: "editor", songId: song });
  localStorage.setItem(NAV_KEYS.always, "true");
  expect(initialRoute("/")).toEqual({ view: "welcome" });
});
it("never reroutes an explicit song or player link through welcome", () => {
  localStorage.setItem(NAV_KEYS.always, "true");
  expect(initialRoute(`/songs/${song}`)).toEqual({
    view: "editor",
    songId: song,
  });
  expect(initialRoute(`/songs/${song}/player`)).toEqual({
    view: "performance",
    songId: song,
  });
  expect(initialRoute("/library")).toEqual({ view: "library" });
  expect(parseRoute("/songs/not-a-uuid")).toBeNull();
  expect(routePath({ view: "performance", songId: song })).toBe(
    `/songs/${song}/player`,
  );
});
it("handles browser history, saves the chosen preference and restores the editor without autoplay", () => {
  let api: ReturnType<typeof useNavigation>;
  function Host() {
    api = useNavigation();
    return <p>{api.route.view}</p>;
  }
  const view = render(<Host />);
  expect(window.location.pathname).toBe("/welcome");
  act(() => api.navigate({ view: "performance", songId: song }));
  expect(screen.getByText("performance")).toBeTruthy();
  expect(localStorage.getItem(NAV_KEYS.last)).toBe(`/songs/${song}`);
  act(() => api.setWelcomeAtStartup(true));
  expect(localStorage.getItem(NAV_KEYS.always)).toBe("true");
  act(() => {
    window.history.replaceState(null, "", "/library");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByText("library")).toBeTruthy();
  view.unmount();
  window.history.replaceState(null, "", "/settings");
  window.dispatchEvent(new PopStateEvent("popstate"));
});
