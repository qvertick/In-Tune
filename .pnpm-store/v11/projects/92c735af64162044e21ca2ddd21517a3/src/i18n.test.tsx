// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { createSong } from "./model";
import { ApiError, api } from "./api";
import messages from "./messages";
import extrasMessages from "./extraMessages";
import errorMessages from "./errorMessages";
import {
  I18nProvider,
  LOCALE_STORAGE_KEY,
  translate,
  translateError,
  useI18n,
} from "./i18n";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "ru";
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Probe() {
  const { t, locale, setLocale, formatDate } = useI18n();
  return (
    <>
      <label>
        locale
        <select
          value={locale}
          onChange={(event) => setLocale(event.target.value as "ru" | "en")}
        >
          <option value="ru">ru</option>
          <option value="en">en</option>
        </select>
      </label>
      <p>{t("Библиотека")}</p>
      <time>
        {formatDate(new Date(2026, 9, 27), { month: "long", day: "numeric" })}
      </time>
    </>
  );
}

describe("locale selection", () => {
  it("defaults to Russian, switches immediately, persists and restores English", async () => {
    const user = userEvent.setup();
    const view = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText("Библиотека")).toBeTruthy();
    expect(screen.getByText("27 октября")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("locale"), "en");
    expect(screen.getByText("Library")).toBeTruthy();
    expect(screen.getByText("October 27")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    view.unmount();
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText("Library")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("locale"), "ru");
    expect(document.documentElement.lang).toBe("ru");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ru");
  });

  it("recovers invalid settings and works when browser storage is disabled", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "uk");
    const view = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText("Библиотека")).toBeTruthy();
    view.unmount();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    await userEvent.selectOptions(screen.getByLabelText("locale"), "en");
    expect(screen.getByText("Library")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("changes the language in App Settings without changing song data", async () => {
    const song = createSong(true);
    const original = JSON.stringify(song);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path === "/api/songs") return Response.json([song]);
        if (path === "/api/sources") return Response.json({ sources: [] });
        if (path === "/api/health") return Response.json({ dataDir: "data/" });
        return Response.json([]);
      }),
    );
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(screen.getByRole("button", { name: "Настройки" }));
    await user.selectOptions(screen.getByLabelText("Язык интерфейса"), "en");
    expect(
      screen.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeTruthy();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    await user.click(screen.getByRole("button", { name: /^Library/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: new RegExp("^" + song.title) }),
      ).toBeTruthy(),
    );
    await user.click(
      screen.getByRole("button", { name: new RegExp("^" + song.title) }),
    );
    expect(
      screen.getByRole("textbox", { name: "Song title" }).getAttribute("value"),
    ).toBe(song.title);
    expect(screen.getByRole("button", { name: "Save now" })).toBeTruthy();
    expect(JSON.stringify(song)).toBe(original);
    view.unmount();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      (screen.getByLabelText("Interface language") as HTMLSelectElement).value,
    ).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});

describe("translations and raw diagnostics", () => {
  it("keeps interpolation tokens consistent across the complete dictionaries", () => {
    for (const [key, value] of Object.entries({
      ...messages,
      ...errorMessages,
      ...extrasMessages,
    })) {
      const tokens = (text: string) =>
        [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(tokens(value), key).toEqual(tokens(key));
    }
    expect(translate("en", "Библиотека")).toBe("Library");
    expect(translate("en", "Настройки")).toBe("Settings");
  });
  it("interpolates once, merges extras, and preserves unknown keys and inserted song text", () => {
    expect(
      translate("en", "Будет добавлен {normalized}", { normalized: "F#m" }),
    ).toBe("Will add F#m");
    expect(
      translate("ru", "Будет добавлен {normalized}", { normalized: "F#m" }),
    ).toBe("Будет добавлен F#m");
    expect(translate("en", "Найти синхронизацию")).toBe("Find synced lyrics");
    expect(translate("en", "Новый неизвестный ключ")).toBe(
      "Новый неизвестный ключ",
    );
    expect(
      translate("en", "Удалить {value0}", { value0: "Моя {value1} песня" }),
    ).toBe("Delete Моя {value1} песня");
  });

  it("localizes composed and numbered errors while retaining diagnostic details", () => {
    expect(
      translateError(
        "en",
        "Не удалось загрузить MP3. Размер MP3 превышает допустимый предел",
      ),
    ).toBe("Could not upload the MP3. MP3 size exceeds the allowed limit");
    expect(translate("en", "Строка 12: нет обычной временной отметки.")).toBe(
      "Line 12: no standard timestamp.",
    );
    expect(
      translateError(
        "en",
        "Строка 7: нет явного end_ms строки; конец не вычислялся.",
      ),
    ).toBe("Line 7: no explicit line end_ms; the end was not inferred.");
    expect(
      translateError(
        "en",
        "Lyricsfile: ошибка YAML: YAML_BAD_INDENT at line 4",
      ),
    ).toBe("Lyricsfile: YAML error: YAML_BAD_INDENT at line 4");
    const diagnostic = "EACCES C:\\music\\Песня.mp3 (0x80070005)";
    expect(translateError("en", diagnostic)).toBe(diagnostic);
    expect(
      translateError("en", "Изменения остались в браузере. " + diagnostic),
    ).toBe("Changes remain in your browser. " + diagnostic);
    expect(
      translateError("en", new ApiError(diagnostic, 504, "upstream_timeout")),
    ).toBe("LRCLIB request timed out. " + diagnostic);
  });

  it("reads coded LRCLIB errors and retains the original response", async () => {
    const body = {
      error: {
        code: "upstream_timeout",
        message: "Превышено время ожидания LRCLIB.",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(body, { status: 504, headers: { "Retry-After": "7" } }),
      ),
    );
    const cause = await api("/lrclib/search").catch((error: unknown) => error);
    expect(cause).toBeInstanceOf(ApiError);
    expect(cause).toMatchObject({
      status: 504,
      code: "upstream_timeout",
      detail: body,
      retryAfter: 7,
    });
    expect(translateError("en", cause)).toBe("LRCLIB request timed out.");
    expect(translateError("ru", cause)).toBe(body.error.message);
  });

  it("retains all validation messages and reports non-JSON HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            detail: [
              { msg: "Недопустимый UUID" },
              { msg: "Ожидается строка" },
              { msg: "Required field" },
              { msg: "fourth diagnostic" },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    const cause = await api("/import").catch((error: unknown) => error);
    expect((cause as Error).message).toContain("fourth diagnostic");
    expect(translateError("en", cause)).toBe(
      "Invalid UUID. Expected a string. Required field. fourth diagnostic",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gateway", { status: 502 })),
    );
    const gateway = await api("/songs").catch((error: unknown) => error);
    expect(translateError("en", gateway)).toBe("Server responded with 502");
  });
});
