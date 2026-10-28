// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SourceSearch from "./SourceSearch";
import { createSong } from "./model";
const source = (id: string) => ({
  id,
  name: id,
  host: id + ".example",
  searchAvailable: true,
  importAvailable: true,
  searchUrl: "https://" + id + ".example/",
});
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows partial source failure while preview stays outside the library until explicitly added", async () => {
  const user = userEvent.setup(),
    added = vi.fn(),
    song = createSong(true);
  song.origin = {
    site: "akkords",
    url: "https://akkords.pro/songs/test/example/",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/sources")
        return Response.json({
          sources: [source("akkords"), source("mychords")],
        });
      if (url.includes("/sources/search?source=akkords"))
        return Response.json({
          source: "akkords",
          results: [
            {
              title: "Навстречу дню",
              artist: "Автор",
              source: "akkords",
              url: song.origin!.url,
            },
          ],
        });
      if (url.includes("/sources/search?source=mychords"))
        return Response.json(
          { detail: "Источник недоступен" },
          { status: 503 },
        );
      if (url.includes("/sources/preview?"))
        return Response.json({
          song,
          warnings: ["Проверьте переносы"],
          source: { id: "akkords", name: "Akkords.pro", url: song.origin!.url },
        });
      if (url === "/api/import") return Response.json(song);
      throw Error(url);
    }),
  );
  render(
    <SourceSearch
      query="Навстречу дню"
      songs={[]}
      onAdded={added}
      onOpen={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Найти разборы" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  await user.click(screen.getByRole("button", { name: "Найти разборы" }));
  await screen.findByText("Источник недоступен");
  await user.click(screen.getByRole("button", { name: "Предпросмотр" }));
  await screen.findByText("Проверьте переносы");
  expect(added).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Добавить в библиотеку" }),
  );
  await waitFor(() => expect(added).toHaveBeenCalledWith(song));
});
it("ignores results from a cancelled earlier query", async () => {
  const user = userEvent.setup();
  let old: ((value: Response) => void) | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/sources")
        return Promise.resolve(Response.json({ sources: [source("akkords")] }));
      if (url.includes("query=old"))
        return new Promise<Response>((resolve) => {
          old = resolve;
        });
      if (url.includes("query=new"))
        return Promise.resolve(
          Response.json({
            source: "akkords",
            results: [
              {
                title: "new",
                artist: "Автор",
                source: "akkords",
                url: "https://akkords.pro/new/",
              },
            ],
          }),
        );
      throw Error(url);
    }),
  );
  const props = { songs: [], onAdded: vi.fn(), onOpen: vi.fn() };
  const rendered = render(<SourceSearch {...props} query="old" />);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Найти разборы" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  await user.click(screen.getByRole("button", { name: "Найти разборы" }));
  rendered.rerender(<SourceSearch {...props} query="new" />);
  await user.click(screen.getByRole("button", { name: "Искать заново" }));
  await screen.findByText("Автор — new");
  old!(
    Response.json({
      source: "akkords",
      results: [
        {
          title: "old",
          artist: "Автор",
          source: "akkords",
          url: "https://akkords.pro/old/",
        },
      ],
    }),
  );
  await waitFor(() => expect(screen.queryByText("Автор — old")).toBeNull());
});
