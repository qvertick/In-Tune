// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LrclibDialog from "./LrclibDialog";
import { createSong, type Line } from "./model";
import type { LrclibTrack } from "./lrclibClient";
import { I18nProvider, LOCALE_STORAGE_KEY } from "./i18n";
import extrasMessages from "./extraMessages";

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  HTMLMediaElement.prototype.pause = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("replays the failed URL snapshot after a real Retry-After expires, only on click", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "upstream_overloaded",
            message: "LRCLIB перегружен. Повторите запрос позже.",
          },
        },
        { status: 503, headers: { "Retry-After": "1" } },
      ),
    )
    .mockResolvedValueOnce(Response.json(record()));
  vi.stubGlobal("fetch", fetch);
  render(
    <LrclibDialog
      song={createSong(true)}
      onApply={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Или ссылка LRCLIB"), {
    target: { value: "https://lrclib.net/tracks/20902008" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Открыть ссылку" })),
  );
  expect(screen.getByRole("alert").textContent).toContain("LRCLIB перегружен");
  expect(screen.getByRole("alert").textContent).toContain("1 с.");
  const retry = screen.getByRole("button", {
    name: "Повторить запрос",
  }) as HTMLButtonElement;
  expect(retry.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Или ссылка LRCLIB"), {
    target: { value: "https://lrclib.net/tracks/22" },
  });
  await act(async () => vi.advanceTimersByTime(1250));
  expect(fetch).toHaveBeenCalledOnce();
  expect(retry.disabled).toBe(false);
  expect(screen.getByRole("alert").textContent).not.toContain("1 с.");
  await act(async () => fireEvent.click(retry));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
  expect(fetch.mock.calls[1][0]).toBe("/api/lrclib/track?id=20902008");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen.getByText(/В этом варианте нет синхронизированного текста/),
  ).toBeTruthy();
});

it("replays the failed search metadata rather than edited fields and never invents a wait", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "upstream_unavailable",
            message: "LRCLIB временно недоступен.",
          },
        },
        { status: 503 },
      ),
    )
    .mockResolvedValueOnce(Response.json([record()]));
  vi.stubGlobal("fetch", fetch);
  render(
    <LrclibDialog
      song={createSong(true)}
      onApply={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Альбом (если известен)"), {
    target: { value: "Original album" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Найти варианты" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).not.toContain("Повторите через");
  fireEvent.change(screen.getByLabelText("Название"), {
    target: { value: "Edited title" },
  });
  fireEvent.change(screen.getByLabelText("Исполнитель"), {
    target: { value: "Edited artist" },
  });
  fireEvent.change(screen.getByLabelText("Альбом (если известен)"), {
    target: { value: "Edited album" },
  });
  const retry = screen.getByRole("button", {
    name: "Повторить запрос",
  }) as HTMLButtonElement;
  expect(retry.disabled).toBe(false);
  fireEvent.click(retry);
  await screen.findByRole("button", {
    name: /Синтетическая песня Автор теста/,
  });
  expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("recovers manually after the client timeout without an automatic retry", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    )
    .mockResolvedValueOnce(Response.json([]));
  vi.stubGlobal("fetch", fetch);
  render(
    <LrclibDialog
      song={createSong(true)}
      onApply={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Найти варианты" }));
  await act(async () => vi.advanceTimersByTime(15_000));
  expect(screen.getByRole("alert").textContent).toContain(
    "не завершился вовремя",
  );
  expect(fetch).toHaveBeenCalledOnce();
  const retry = screen.getByRole("button", {
    name: "Повторить запрос",
  }) as HTMLButtonElement;
  expect(retry.disabled).toBe(false);
  await act(async () => fireEvent.click(retry));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/Варианты не найдены/)).toBeTruthy();
});

it("localizes overload and retry while retaining the requested player translation keys", async () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, "en");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "upstream_overloaded",
            message: "LRCLIB перегружен. Повторите запрос позже.",
          },
        },
        { status: 503 },
      ),
    ),
  );
  render(
    <I18nProvider>
      <LrclibDialog
        song={createSong(true)}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Find versions" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "LRCLIB is overloaded. Try again later.",
  );
  expect(
    (screen.getByRole("button", { name: "Retry request" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(extrasMessages["К текущей строке"]).toBe("Back to current line");
  expect(extrasMessages["Подсветка текста"]).toBe("Text highlighting");
});
function record(changes: Partial<LrclibTrack> = {}): LrclibTrack {
  return {
    id: 20902008,
    trackName: "Синтетическая песня",
    artistName: "Автор теста",
    albumName: "Studio",
    duration: 60,
    instrumental: false,
    plainLyrics: "Только текст",
    syncedLyrics: null,
    ...changes,
  };
}
it("searches with editable song metadata, shows versions/duration and does not fabricate a map for plain results", async () => {
  const song = createSong(true),
    onApply = vi.fn();
  song.audio = { filename: "my.mp3", url: "/my.mp3", duration: 60 };
  const fetch = vi.fn(async (_input: string, _options?: RequestInit) =>
    Response.json([
      record(),
      record({
        id: 22,
        trackName: "Синтетическая песня (Live)",
        albumName: "Live",
        duration: 75,
      }),
    ]),
  );
  vi.stubGlobal("fetch", fetch);
  const view = render(
    <LrclibDialog song={song} onApply={onApply} onClose={vi.fn()} />,
  );
  fireEvent.change(screen.getByLabelText("Альбом (если известен)"), {
    target: { value: "Studio" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Найти варианты" }));
  await screen.findByRole("button", { name: /Синтетическая песня \(Live\)/ });
  const url = new URL(fetch.mock.calls[0][0] as string, "http://localhost");
  expect(url.searchParams.get("track")).toBe(song.title);
  expect(url.searchParams.get("duration")).toBe("60");
  expect(url.searchParams.get("album")).toBe("Studio");
  expect(screen.getByText(/Δ \+15.0/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: /Синтетическая песня Автор теста/ }),
  );
  expect(
    screen.getByText(/В этом варианте нет синхронизированного текста/),
  ).toBeTruthy();
  expect(view.container.querySelector("audio")?.getAttribute("src")).toBe(
    "/my.mp3",
  );
  expect(
    screen.queryByRole("button", { name: "Применить синхронизацию" }),
  ).toBeNull();
  expect(onApply).not.toHaveBeenCalled();
});

it("rejects URL normalization tricks before issuing any request", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(
    <LrclibDialog
      song={createSong(true)}
      onApply={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const input = screen.getByLabelText("Или ссылка LRCLIB");
  const form = input.closest("form")!;
  for (const url of [
    "https://lrclib.net/else/../tracks/20902008",
    "https://lrclib.net:443/tracks/20902008",
    "https://lrclib.net/tracks/20902008/",
    "https://lrclib.net/tracks/20902008?q=extra",
    "https://lrclib.net.evil/tracks/20902008",
    "https://lrclib.net/tracks/9007199254740993",
  ]) {
    fireEvent.change(input, { target: { value: url } });
    await act(async () => fireEvent.submit(form));
    expect(screen.getByRole("alert").textContent).toContain("Вставьте ссылку");
  }
  expect(fetch).not.toHaveBeenCalled();
});
it("loads the provided link, previews matching and confirms replacement without changing lyrics or chord positions", async () => {
  const song = createSong(true),
    before = structuredClone(song),
    onApply = vi.fn(),
    onClose = vi.fn();
  song.sections[0].lines[0].start = 20;
  song.sections[0].lines[0].end = 30;
  const syncedLyrics = `[00:01]${song.sections[0].lines[0].text}\n[00:07]${song.sections[0].lines[1].text}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(record({ syncedLyrics }))),
  );
  render(<LrclibDialog song={song} onApply={onApply} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText("Или ссылка LRCLIB"), {
    target: { value: "https://lrclib.net/tracks/20902008" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Открыть ссылку" }));
  const apply = (await screen.findByRole("button", {
    name: "Применить синхронизацию",
  })) as HTMLButtonElement;
  expect(apply.disabled).toBe(true);
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Заменить существующие отметки/ }),
  );
  fireEvent.click(apply);
  const next = onApply.mock.calls[0][0];
  expect(next.sections[0].lines[0].start).toBe(1);
  next.sections[0].lines.forEach((line: Line, i: number) => {
    expect(line.text).toBe(before.sections[0].lines[i].text);
    expect(line.chords).toEqual(before.sections[0].lines[i].chords);
  });
  expect(onClose).toHaveBeenCalledOnce();
});
it("shows an empty search and an upstream error without modifying the song", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "unavailable",
            message: "LRCLIB временно недоступен.",
          },
        },
        { status: 503 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  render(
    <LrclibDialog
      song={createSong(true)}
      onApply={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Найти варианты" }));
  await screen.findByText(/Варианты не найдены/);
  fireEvent.click(screen.getByRole("button", { name: "Найти варианты" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "LRCLIB временно недоступен.",
  );
});
it("aborts an unfinished lookup when the dialog closes and ignores its late result", async () => {
  let finish!: (value: Response) => void;
  const fetch = vi.fn(
    (_url: string, _options?: RequestInit) =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const onApply = vi.fn();
  const view = render(
    <LrclibDialog
      song={createSong(true)}
      onApply={onApply}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Найти варианты" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const signal = fetch.mock.calls[0][1]?.signal;
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(Response.json([record()])));
  expect(onApply).not.toHaveBeenCalled();
});
