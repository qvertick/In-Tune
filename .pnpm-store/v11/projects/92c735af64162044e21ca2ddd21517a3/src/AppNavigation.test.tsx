// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { createSong } from "./model";
import { NAV_KEYS } from "./navigation";
let song: ReturnType<typeof createSong>;
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  song = createSong(true);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(
        url === "/api/songs"
          ? [song]
          : url === "/api/health"
            ? { dataDir: "data/" }
            : url.endsWith("/stems")
              ? { ready: false }
              : [],
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/library");
});
it("opens the real library from welcome and skips welcome on the next root launch", async () => {
  const user = userEvent.setup(),
    view = render(<App />);
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByRole("button", { name: /^Продолжить/ })).toBeNull();
  await user.click(
    screen.getAllByRole("button", { name: "Открыть библиотеку" })[0],
  );
  await screen.findByRole("button", { name: /^Навстречу дню/ });
  expect(window.location.pathname).toBe("/library");
  expect(localStorage.getItem(NAV_KEYS.seen)).toBe("true");
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).includes("analysis")),
  ).toBe(false);
  view.unmount();
  window.history.replaceState(null, "", "/");
  render(<App />);
  await screen.findByRole("button", { name: /^Навстречу дню/ });
  expect(window.location.pathname).toBe("/library");
});
it("opens an explicit song despite always-welcome, then provides a valid Continue action", async () => {
  localStorage.setItem(NAV_KEYS.always, "true");
  window.history.replaceState(null, "", `/songs/${song.id}`);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("textbox", { name: "Название песни" });
  expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Открыть приветствие" }));
  await screen.findByRole("heading", { level: 1 });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^Продолжить/ })).toBeTruthy(),
  );
  await user.click(screen.getByRole("button", { name: /^Продолжить/ }));
  expect(window.location.pathname).toBe(`/songs/${song.id}`);
  expect(
    (
      screen.getByRole("textbox", {
        name: "Название песни",
      }) as HTMLInputElement
    ).value,
  ).toBe(song.title);
});
it("does not offer Continue for a deleted song and displays a useful missing-link state", async () => {
  localStorage.setItem(NAV_KEYS.song, "11111111-2222-4333-8444-555555555555");
  render(<App />);
  await screen.findByRole("heading", { level: 1 });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: /^Продолжить/ })).toBeNull();
  cleanup();
  window.history.replaceState(
    null,
    "",
    "/songs/11111111-2222-4333-8444-555555555555",
  );
  render(<App />);
  await screen.findByRole("heading", { name: "Песня не найдена" });
});
it("takes a song without audio to the editor attachment workflow instead of an empty mixer", async () => {
  localStorage.setItem(NAV_KEYS.song, song.id);
  const user = userEvent.setup();
  render(<App/>);
  await screen.findByRole("button",{name:/^Продолжить/});
  await user.click(screen.getByRole("button",{name:/^03 Настрой звучание/}));
  expect(window.location.pathname).toBe(`/songs/${song.id}`);
  await screen.findByRole("button",{name:"Добавить MP3"});
});
