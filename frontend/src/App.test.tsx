// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { createSong, type Song } from "./model";
import { NAV_KEYS } from "./navigation";

// These are complete editor workflows with many real user events and autosaves.
// A small CPU must not fail them solely on Vitest's five-second default.
vi.setConfig({ testTimeout: 15000 });

let documents: Map<string, Song>;
let failSaves = false;
let releaseUpload: (() => void) | undefined;
beforeEach(() => {
  window.history.replaceState(null, "", "/library");
  localStorage.clear();
  documents = new Map();
  failSaves = false;
  releaseUpload = undefined;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      if (path === "/api/songs" && !options?.method)
        return Response.json([...documents.values()]);
      if (path === "/api/jobs") return Response.json([]);
      if (path.includes("/audio?")) {
        await new Promise<void>((resolve) => {
          releaseUpload = resolve;
        });
        const song = [...documents.values()][0];
        const result = {
          ...song,
          audio: {
            filename: "test.mp3",
            url: "/api/songs/" + song.id + "/audio?v=new",
            duration: 2,
          },
        };
        documents.set(song.id, result);
        return Response.json(result);
      }
      if (path === "/api/songs" && options?.method === "POST") {
        const song = JSON.parse(options.body as string) as Song;
        documents.set(song.id, song);
        return Response.json(song, { status: 201 });
      }
      if (path.startsWith("/api/songs/") && options?.method === "PUT") {
        if (failSaves)
          return Response.json(
            { detail: "Проверочная ошибка сохранения" },
            { status: 503 },
          );
        const song = JSON.parse(options.body as string) as Song;
        documents.set(song.id, song);
        return Response.json(song);
      }
      return Response.json(
        { detail: "Неожиданный запрос " + path },
        { status: 404 },
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openDemo() {
  const song = createSong(true);
  song.sections[0].lines[1].chords[0].paletteId = song.palette[0].id;
  documents.set(song.id, song);
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: /^Навстречу дню/ }),
  );
  return song;
}
const current = () => [...documents.values()][0];

describe("editor workflows in simulated DOM", () => {
  it("defaults to dark mode and persists the light theme switch", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(screen.getByRole("button", { name: "Настройки" }));
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(localStorage.getItem(NAV_KEYS.theme)).toBe("dark");
    });

    const toggle = screen.getByRole("switch", { name: "Тема оформления" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(localStorage.getItem(NAV_KEYS.theme)).toBe("light");
    });

    view.unmount();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Настройки" }));
    expect(
      screen.getByRole("switch", { name: "Тема оформления" }).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("moves and deletes an occurrence and confirms a counted global replacement", async () => {
    const user = userEvent.setup();
    const song = await openDemo();
    await user.click(
      screen.getAllByRole("button", { name: "Аккорд Am, позиция 1" })[0],
    );
    await user.click(screen.getByRole("button", { name: "Переместить…" }));
    await user.click(
      screen.getAllByRole("button", {
        name: "Поставить аккорд: и, позиция 2",
      })[0],
    );
    await user.click(
      screen.getByRole("button", { name: "Аккорд Am, позиция 2" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Удалить в этом месте" }),
    );
    expect(
      screen.queryByRole("button", { name: "Аккорд Am, позиция 2" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Отменить" }));
    expect(
      screen.getByRole("button", { name: "Аккорд Am, позиция 2" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Заменить все…" }));
    await user.selectOptions(
      screen.getByLabelText("Аккорд", { exact: true }),
      song.palette[0].id,
    );
    await user.selectOptions(
      screen.getByLabelText("Заменить на"),
      song.palette[1].id,
    );
    expect(screen.getByText(/Будет заменено вхождений/).textContent).toContain(
      "2",
    );
    await user.click(
      screen.getByRole("button", { name: "Подтвердить замену" }),
    );
    expect(
      screen.queryByRole("button", { name: "Аккорд Am, позиция 1" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Аккорд F, позиция 2" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Сохранить сейчас" }));
    await waitFor(() =>
      expect(current().sections[0].lines[0].chords[0].paletteId).toBe(
        song.palette[1].id,
      ),
    );
  });
  it("serializes audio uploads with autosaves and retains text edited during upload", async () => {
    const user = userEvent.setup();
    await openDemo();
    const input = document.querySelector<HTMLInputElement>(
      'input[accept=".mp3,audio/mpeg"]',
    )!;
    await user.upload(
      input,
      new File(["test"], "test.mp3", { type: "audio/mpeg" }),
    );
    await waitFor(() => expect(releaseUpload).toBeTypeOf("function"));
    const title = screen.getByRole("textbox", { name: "Название песни" });
    await user.clear(title);
    await user.type(title, "Во время загрузки");
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(current().title).toBe("Навстречу дню");
    releaseUpload!();
    await waitFor(() => expect(current().title).toBe("Во время загрузки"), {
      timeout: 2500,
    });
    expect(current().audio?.filename).toBe("test.mp3");
  });
  it("replaces one occurrence, adds a chord without inserting it, reuses it and supports undo/redo", async () => {
    const user = userEvent.setup();
    await openDemo();
    await user.click(
      screen.getAllByRole("button", { name: "Аккорд Am, позиция 1" })[0],
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "Выбор аккорда" })).getByRole(
        "button",
        { name: "F" },
      ),
    );
    expect(
      screen.getAllByRole("button", { name: "Аккорд Am, позиция 1" }),
    ).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Отменить" }));
    expect(
      screen.getAllByRole("button", { name: "Аккорд Am, позиция 1" }),
    ).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(
      screen.getAllByRole("button", { name: "Аккорд Am, позиция 1" }),
    ).toHaveLength(1);
    await user.click(
      screen.getByRole("button", { name: "Добавить аккорд в палитру" }),
    );
    await user.type(screen.getByRole("textbox", { name: "Название" }), "F#");
    await user.click(screen.getByRole("button", { name: "Добавить" }));
    expect(
      screen.queryByRole("button", { name: "Аккорд F#, позиция 1" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Аккорд Am, позиция 1" }),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "Выбор аккорда" })).getByRole(
        "button",
        { name: "F#" },
      ),
    );
    await waitFor(
      () =>
        expect(current().sections[0].lines[1].chords[0].paletteId).toBe(
          current().palette.find((c) => c.name === "F#")!.id,
        ),
      { timeout: 2500 },
    );
    expect(
      current()
        .sections.flatMap((s) => s.lines)
        .flatMap((l) => l.chords),
    ).toHaveLength(4);
  });

  it("shifts an anchor when text is inserted before it and preserves multiline input", async () => {
    const user = userEvent.setup();
    await openDemo();
    await user.click(
      screen.getAllByRole("button", { name: "Изменить текст" })[0],
    );
    const field = screen.getByRole("textbox", {
      name: "Текст строки",
    }) as HTMLTextAreaElement;
    field.focus();
    field.setSelectionRange(0, 0);
    await user.keyboard("Эй ");
    expect(
      screen.getByRole("button", { name: "Аккорд Am, позиция 4" }),
    ).toBeTruthy();
    await user.keyboard("{End}{Enter}");
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Изменить текст" }),
      ).toHaveLength(4),
    );
    await user.keyboard("Новая строка");
    await waitFor(() => expect(current().sections[0].lines).toHaveLength(5), {
      timeout: 2500,
    });
    expect(current().sections[0].lines[0].chords[0].offset).toBe(3);
    await waitFor(
      () => expect(current().sections[0].lines[1].text).toBe("Новая строка"),
      { timeout: 2500 },
    );
  });

  it("keeps a failed save in an emergency draft and restores it after reopening", async () => {
    const user = userEvent.setup();
    const original = await openDemo();
    failSaves = true;
    const title = screen.getByRole("textbox", { name: "Название песни" });
    await user.clear(title);
    await user.type(title, "Мой черновик");
    await screen.findByText(
      /Изменения остались в браузере/,
      {},
      { timeout: 2500 },
    );
    expect(
      JSON.parse(localStorage.getItem("vlad-draft-" + original.id)!).title,
    ).toBe("Мой черновик");
    expect(current().title).toBe("Навстречу дню");
    cleanup();
    render(<App />);
    await screen.findByRole("textbox", { name: "Название песни" });
    expect(
      (
        screen.getByRole("textbox", {
          name: "Название песни",
        }) as HTMLInputElement
      ).value,
    ).toBe("Мой черновик");
    failSaves = false;
    await user.click(screen.getByRole("button", { name: "Сохранить сейчас" }));
    await waitFor(() => expect(current().title).toBe("Мой черновик"));
    expect(localStorage.getItem("vlad-draft-" + original.id)).toBeNull();
  });
});
