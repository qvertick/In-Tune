// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Performance from "./Performance";
import { createSong } from "./model";

let song: ReturnType<typeof createSong>;
let paused: WeakMap<HTMLMediaElement, boolean>;
let frames: Map<number, FrameRequestCallback>;
let frameId = 0;
const play = vi.fn(function (this: HTMLMediaElement) {
  paused.set(this, false);
  this.dispatchEvent(new Event("play"));
  this.dispatchEvent(new Event("playing"));
  return Promise.resolve();
});
const pause = vi.fn(function (this: HTMLMediaElement) {
  const wasPlaying = paused.get(this) === false;
  paused.set(this, true);
  if (wasPlaying) this.dispatchEvent(new Event("pause"));
});
const getUserMedia = vi.fn();
function media(id = "player-original") {
  return screen.getByTestId(id) as HTMLAudioElement;
}
function time(value: number, element = media()) {
  act(() => {
    element.currentTime = value;
    fireEvent.timeUpdate(element);
  });
}
function timedSong() {
  song.audio = { filename: "sample.mp3", url: "/sample.mp3", duration: 90 };
  song.sections[0].lines.forEach((line, i) => {
    line.start = i * 10;
    line.end = i * 10 + 8;
  });
  return song;
}
function setupStems(ready = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input.endsWith("/stems"))
        return Response.json({
          ready,
          ...(ready ? { vocalsUrl: "/v.mp3", accompanimentUrl: "/a.mp3" } : {}),
        });
      if (input.endsWith("/separation/status"))
        return Response.json({
          available: false,
          modelInstalled: false,
          command: "install-separation.ps1",
          note: "Модель нужна локально",
        });
      if (input.endsWith("/jobs")) return Response.json([]);
      return Response.json({});
    }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
  song = createSong(true);
  paused = new WeakMap();
  frames = new Map();
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
  Object.defineProperties(HTMLMediaElement.prototype, {
    play: { configurable: true, value: play },
    pause: { configurable: true, value: pause },
    paused: {
      configurable: true,
      get() {
        return paused.get(this) !== false;
      },
    },
    duration: {
      configurable: true,
      get() {
        return 90;
      },
    },
    readyState: {
      configurable: true,
      get() {
        return 4;
      },
    },
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  setupStems();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("media clock performance", () => {
  it("opens the requested welcome panel without autoplay or model jobs", async () => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    const opened = vi.fn();
    const view = render(
      <Performance
        song={timedSong()}
        onBack={vi.fn()}
        onSettings={vi.fn()}
        initialPanel="sync"
        onPanelOpened={opened}
      />,
    );
    expect(
      await screen.findByRole("dialog", { name: "Найти синхронизацию" }),
    ).toBeTruthy();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
    view.unmount();
    setupStems(true);
    const mixerOpened = vi.fn();
    const mixer = render(
      <Performance
        song={timedSong()}
        onBack={vi.fn()}
        onSettings={vi.fn()}
        initialPanel="mixer"
        onPanelOpened={mixerOpened}
      />,
    );
    expect(
      mixer.container.querySelector<HTMLDetailsElement>(".player-stems")?.open,
    ).toBe(true);
    expect(
      mixer.container
        .querySelector(".music-player")
        ?.classList.contains("player-settings-open"),
    ).toBe(true);
    expect(
      await screen.findByRole("slider", { name: "Громкость: Вокал" }),
    ).toBeTruthy();
    expect(mixerOpened).not.toHaveBeenCalled();
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(0));
    });
    expect(mixerOpened).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(mixer.container.querySelector(".player-stems summary"));
    expect(play).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(
          ([, options]) => !options || options.method !== "POST",
        ),
    ).toBe(true);
    mixer.unmount();
    expect(frames.size).toBe(0);
  });
  it("previews vocals through intro and a real gap without painting future words or treating strum as lyrics", () => {
    const timed = timedSong();
    timed.sections[0].lines.forEach((line, i) => {
      line.start = 30 + i * 10;
      line.end = 35 + i * 10;
    });
    timed.sections.unshift({
      id: "intro",
      name: "Вступление х4",
      lines: [
        { id: "strum", text: "Бой: ↓ * ↓↑", chords: [], start: 0 },
        {
          id: "intro-chords",
          text: "       }х4",
          chords: [{ ...timed.sections[0].lines[0].chords[0], id: "intro-c" }],
        },
      ],
    });
    const original = JSON.stringify(timed);
    const view = render(
      <Performance song={timed} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    expect(
      view.container
        .querySelector(".player-reading-cue")
        ?.getAttribute("data-reading-phase"),
    ).toBe("instrumental");
    expect(
      view.container.querySelector(".reading-preview")?.textContent,
    ).toContain(timed.sections[1].lines[0].text);
    expect(view.container.querySelector(".player-line.is-active")).toBeNull();
    expect(
      view.container.querySelector(".reading-strum")?.textContent,
    ).toContain("↓ * ↓↑");
    expect(screen.queryByRole("button", { name: /Бой:/ })).toBeNull();
    time(31);
    expect(view.container.querySelector(".player-line.is-active")).toBeTruthy();
    time(35);
    expect(view.container.querySelector(".player-line.is-active")).toBeNull();
    expect(
      view.container
        .querySelector('[data-follow-row="true"]')
        ?.getAttribute("aria-label"),
    ).toContain(timed.sections[1].lines[1].text);
    expect(JSON.stringify(timed)).toBe(original);
  });
  it("keeps unknown phrase ends honest while still displaying upcoming words", () => {
    const timed = timedSong();
    delete timed.sections[0].lines[0].end;
    const view = render(
      <Performance song={timed} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    time(5);
    expect(view.container.querySelector(".player-line.is-active")).toBeNull();
    expect(view.container.querySelector(".reading-status")?.textContent).toBe(
      "Конец фразы не отмечен",
    );
    expect(
      view.container.querySelector(".reading-preview")?.textContent,
    ).toContain(timed.sections[0].lines[1].text);
  });
  it("rewinds only the visual clock on a paused short seek, then reaches the live time and cleans every loop", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const view = render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    time(12);
    fireEvent.change(screen.getByLabelText("Позиция воспроизведения"), {
      target: { value: "5" },
    });
    expect(media().currentTime).toBe(5);
    expect(media().paused).toBe(true);
    expect(
      view.container
        .querySelector(".music-player")
        ?.getAttribute("data-rewinding"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /^Строка 2:/ })
        .getAttribute("aria-current"),
    ).toBe("step");
    act(() => {
      now += 175;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((cb) => cb(now));
    });
    expect(
      screen
        .getByRole("button", { name: /^Строка 1:/ })
        .getAttribute("aria-current"),
    ).toBe("step");
    act(() => {
      now += 175;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((cb) => cb(now));
    });
    expect(
      view.container
        .querySelector(".music-player")
        ?.getAttribute("data-rewinding"),
    ).toBe("false");
    expect(media().currentTime).toBe(5);
    expect(view.container.querySelectorAll(".word-active")).toHaveLength(0); // line-only map remains line-only
    view.unmount();
    expect(frames.size).toBe(0);
    vi.restoreAllMocks();
  });
  it("classifies a scrub once from its start and a later seek cancels the previous transition", () => {
    const view = render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    time(30);
    const slider = screen.getByLabelText("Позиция воспроизведения");
    fireEvent.pointerDown(slider, { pointerId: 1 });
    fireEvent.change(slider, { target: { value: "23" } });
    fireEvent.change(slider, { target: { value: "22" } });
    expect(
      view.container
        .querySelector(".music-player")
        ?.getAttribute("data-rewinding"),
    ).toBe("false");
    fireEvent.pointerUp(slider, { pointerId: 1 });
    expect(media().currentTime).toBe(22);
    expect(
      view.container
        .querySelector(".music-player")
        ?.getAttribute("data-rewinding"),
    ).toBe("true");
    fireEvent.change(slider, { target: { value: "19" } }); // 3 seconds, not another reverse effect
    expect(
      view.container
        .querySelector(".music-player")
        ?.getAttribute("data-rewinding"),
    ).toBe("false");
    expect(media().currentTime).toBe(19);
  });
  it("treats start, line and keyboard seeks consistently while A–B remains an internal jump", async () => {
    const user = userEvent.setup();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const view = render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    time(8);
    await user.click(screen.getByRole("button", { name: "В начало" }));
    expect(media().currentTime).toBe(0);
    expect(
      view.container
        .querySelector(".music-player")
        ?.getAttribute("data-rewinding"),
    ).toBe("true");
    act(() => {
      now = 400;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((cb) => cb(now));
    });
    time(60);
    await user.click(screen.getByRole("button", { name: "В начало" }));
    expect(media().currentTime).toBe(0);
    expect(
      view.container
        .querySelector(".music-player")
        ?.getAttribute("data-rewinding"),
    ).toBe("false");
    time(7);
    await user.click(screen.getByRole("button", { name: /^Строка 1:/ }));
    expect(
      view.container
        .querySelector(".music-player")
        ?.getAttribute("data-rewinding"),
    ).toBe("true");
    time(7);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(media().currentTime).toBe(0);
    await user.click(screen.getByText("Настройки исполнения"));
    time(2);
    await user.click(screen.getByRole("button", { name: /^A ·/ }));
    time(9);
    await user.click(screen.getByRole("button", { name: /^B ·/ }));
    await user.click(screen.getByRole("button", { name: "Повтор выкл" }));
    await user.click(screen.getByRole("button", { name: "Воспроизвести" }));
    time(9.1);
    expect(media().currentTime).toBe(2);
    expect(
      view.container
        .querySelector(".music-player")
        ?.getAttribute("data-rewinding"),
    ).toBe("false");
    vi.restoreAllMocks();
  });
  it("does not animate with highlighting off or reduced motion, but still seeks the audio", async () => {
    const user = userEvent.setup();
    const view = render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    await user.click(screen.getByText("Настройки исполнения"));
    await user.click(
      screen.getByRole("checkbox", { name: "Подсветка текста" }),
    );
    time(12);
    fireEvent.change(screen.getByLabelText("Позиция воспроизведения"), {
      target: { value: "5" },
    });
    expect(
      view.container
        .querySelector(".music-player")
        ?.getAttribute("data-rewinding"),
    ).toBe("false");
    expect(view.container.querySelector(".player-line.is-active")).toBeNull();
    await user.click(
      screen.getByRole("checkbox", { name: "Подсветка текста" }),
    );
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });
    time(12);
    fireEvent.change(screen.getByLabelText("Позиция воспроизведения"), {
      target: { value: "5" },
    });
    expect(media().currentTime).toBe(5);
    expect(
      view.container
        .querySelector(".music-player")
        ?.getAttribute("data-rewinding"),
    ).toBe("false");
  });
  it("plays actual media, highlights only its time and restores the current position after visibility changes", async () => {
    const user = userEvent.setup();
    render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Воспроизвести" }));
    expect(play.mock.instances).toContain(media());
    time(12.5);
    expect(
      screen
        .getByRole("button", { name: /^Строка 2:/ })
        .getAttribute("aria-current"),
    ).toBe("step");
    act(() => {
      media().currentTime = 31;
      fireEvent(document, new Event("visibilitychange"));
    });
    expect(
      screen
        .getByRole("button", { name: /^Строка 4:/ })
        .getAttribute("aria-current"),
    ).toBe("step");
    time(19);
    expect(
      screen
        .getByRole("button", { name: /^Строка 2:/ })
        .getAttribute("aria-current"),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Пауза" }));
    expect(media().paused).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it("seeks lines and the scrubber, controls volume and preserves pitch at slower rates", async () => {
    const user = userEvent.setup();
    render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    await user.click(screen.getByText("Настройки исполнения"));
    await user.click(screen.getByRole("button", { name: /^Строка 3:/ }));
    expect(media().currentTime).toBe(20);
    fireEvent.change(screen.getByLabelText("Позиция воспроизведения"), {
      target: { value: "42" },
    });
    expect(media().currentTime).toBe(42);
    await user.selectOptions(screen.getByLabelText("Скорость"), "0.75");
    expect(media().playbackRate).toBe(0.75);
    expect(media().preservesPitch).toBe(true);
    fireEvent.change(screen.getByLabelText("Громкость"), {
      target: { value: "0.3" },
    });
    expect(media().volume).toBe(0.3);
  });
  it("loops against media currentTime and pauses on native errors", async () => {
    const user = userEvent.setup();
    render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    await user.click(screen.getByText("Настройки исполнения"));
    time(3);
    await user.click(screen.getByRole("button", { name: /^A ·/ }));
    time(6);
    await user.click(screen.getByRole("button", { name: /^B ·/ }));
    await user.click(screen.getByRole("button", { name: "Повтор выкл" }));
    await user.click(screen.getByRole("button", { name: "Воспроизвести" }));
    time(6.1);
    expect(media().currentTime).toBe(3);
    fireEvent.error(media());
    expect(media().paused).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain(
      "Не удалось загрузить",
    );
  });
  it("never fabricates text playback without a map and still permits manual navigation", async () => {
    const user = userEvent.setup();
    render(<Performance song={song} onBack={vi.fn()} onSettings={vi.fn()} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Воспроизвести",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: /^Строка 2:/ }));
    expect(
      screen
        .getByRole("button", { name: /^Строка 2:/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(play).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it("uses its separate monotonic clock only in explicit text mode", async () => {
    const user = userEvent.setup();
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    timedSong();
    song.audio = null;
    render(<Performance song={song} onBack={vi.fn()} onSettings={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Воспроизвести" }));
    act(() => {
      now = 13500;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(now));
    });
    expect(
      screen
        .getByRole("button", { name: /^Строка 2:/ })
        .getAttribute("aria-current"),
    ).toBe("step");
    expect(play).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("records media timestamps, advances selection, ignores M in inputs, undoes and saves existing chords", async () => {
    const user = userEvent.setup(),
      onSong = vi.fn();
    song.audio = { filename: "sample.mp3", url: "/sample.mp3", duration: 90 };
    song.sections[0].lines[0].chords[0].start = 4.25;
    song.sections[0].lines[0].chords[0].end = 7;
    const chord = { ...song.sections[0].lines[0].chords[0] };
    render(
      <Performance
        song={song}
        onBack={vi.fn()}
        onSettings={vi.fn()}
        onSong={onSong}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Разметить вручную" }));
    await user.click(
      screen.getByRole("button", { name: "Воспроизвести для разметки" }),
    );
    time(4);
    fireEvent.keyDown(window, { code: "KeyM", key: "m" });
    expect(
      screen
        .getByRole("button", { name: /^Строка 2:/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const shift = screen.getByLabelText("Общий сдвиг, секунды");
    fireEvent.keyDown(shift, { code: "KeyM", key: "m" });
    expect(
      screen
        .getByRole("button", { name: /^Строка 2:/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    time(9);
    await user.click(screen.getByRole("button", { name: /Отметить начало/ }));
    await user.click(screen.getByRole("button", { name: "Отменить отметку" }));
    expect(
      screen
        .getByRole("button", { name: /^Строка 2:/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    time(11);
    await user.click(screen.getByRole("button", { name: /Отметить начало/ }));
    await user.click(
      screen.getByRole("button", { name: "Сохранить временную карту" }),
    );
    const saved = onSong.mock.calls[0][0];
    expect(saved.sections[0].lines[0].start).toBe(4);
    expect(saved.sections[0].lines[0].end).toBe(11);
    expect(saved.sections[0].lines[0].chords[0]).toEqual(chord);
    expect(saved.sections[0].lines[1].start).toBe(11);
    expect(saved.title).toBe(song.title);
    expect(media().paused).toBe(false);
  });
  it("keeps LRC import a preview until explicit apply and save", async () => {
    const user = userEvent.setup(),
      onSong = vi.fn();
    render(
      <Performance
        song={timedSong()}
        onBack={vi.fn()}
        onSettings={vi.fn()}
        onSong={onSong}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Импортировать LRC" }));
    fireEvent.change(screen.getByLabelText("Текст LRC"), {
      target: {
        value: `[00:01]${song.sections[0].lines[0].text}\n[00:09]Unknown`,
      },
    });
    expect(onSong).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("checkbox", { name: /Заменить существующие отметки/ }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Применить времена к существующим строкам",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Сохранить временную карту" }),
    );
    expect(onSong.mock.calls[0][0].sections[0].lines[0].start).toBe(1);
    expect(onSong.mock.calls[0][0].sections[0].lines[0].text).toBe(
      song.sections[0].lines[0].text,
    );
    expect(onSong.mock.calls[0][0].sections[0].lines[1].start).toBe(10);
  });
  it("streams custom stems without original doubling, synchronizes drift and applies independent mute and volume", async () => {
    setupStems(true);
    const user = userEvent.setup();
    render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("option", { name: "Свой микс" }) as HTMLOptionElement)
          .disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "Воспроизвести" }));
    time(12);
    await user.selectOptions(screen.getByLabelText("Режим звучания"), "custom");
    const v = media("player-vocals"),
      a = media("player-accompaniment");
    expect(media().paused).toBe(true);
    expect(media().muted).toBe(true);
    expect(v.paused).toBe(false);
    expect(a.paused).toBe(false);
    expect(a.currentTime).toBe(12);
    act(() => {
      v.currentTime = 10;
      a.currentTime = 14;
      fireEvent.timeUpdate(a);
    });
    expect(v.currentTime).toBe(14);
    fireEvent.click(screen.getByText(/Вокал и аккомпанемент/));
    fireEvent.change(screen.getByLabelText("Громкость: Вокал"), {
      target: { value: ".4" },
    });
    expect(v.volume).toBeCloseTo(0.32);
    await user.click(screen.getByLabelText("Без звука: Аккомпанемент"));
    expect(a.muted).toBe(true);
    fireEvent.change(screen.getByLabelText("Позиция воспроизведения"), {
      target: { value: "25" },
    });
    expect(v.currentTime).toBe(25);
    expect(a.currentTime).toBe(25);
    await user.click(screen.getByRole("button", { name: "Пауза" }));
    expect(v.paused).toBe(true);
    expect(a.paused).toBe(true);
  });
  it("shows actionable installation status when stems are missing", async () => {
    const user = userEvent.setup();
    render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    fireEvent.click(screen.getByText(/Вокал и аккомпанемент/));
    await screen.findByText("install-separation.ps1");
    expect(
      (
        screen.getByRole("button", {
          name: "Подготовить дорожки",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("option", { name: "Вокал" }) as HTMLOptionElement)
        .disabled,
    ).toBe(true);
    await user.click(
      screen.getByRole("button", { name: "Проверить готовность" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/stems"),
      expect.anything(),
    );
  });
  it("pauses both stems when the follower buffers, then resumes together without losing master position", async () => {
    setupStems(true);
    const user = userEvent.setup();
    render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("option", { name: "Свой микс" }) as HTMLOptionElement)
          .disabled,
      ).toBe(false),
    );
    await user.selectOptions(screen.getByLabelText("Режим звучания"), "custom");
    await user.click(screen.getByRole("button", { name: "Воспроизвести" }));
    const v = media("player-vocals"),
      a = media("player-accompaniment");
    time(12, a);
    fireEvent.waiting(v);
    expect(v.paused).toBe(true);
    expect(a.paused).toBe(true);
    expect(screen.getByText(/Загрузка аудио/)).toBeTruthy();
    await act(async () => {
      v.currentTime = 11.8;
      fireEvent.canPlay(v);
    });
    expect(v.paused).toBe(false);
    expect(a.paused).toBe(false);
    expect(v.currentTime).toBe(12);
    expect(a.currentTime).toBe(12);
    act(() => {
      v.currentTime = 11.94;
      fireEvent.timeUpdate(a);
    });
    expect(v.currentTime).toBe(12);
  });
  it("does not resume a buffering mix after the user pauses it", async () => {
    setupStems(true);
    const user = userEvent.setup();
    render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("option", { name: "Свой микс" }) as HTMLOptionElement)
          .disabled,
      ).toBe(false),
    );
    await user.selectOptions(screen.getByLabelText("Режим звучания"), "custom");
    await user.click(screen.getByRole("button", { name: "Воспроизвести" }));
    const v = media("player-vocals"),
      a = media("player-accompaniment");
    fireEvent.waiting(v);
    await user.click(screen.getByRole("button", { name: "Пауза" }));
    await act(async () => {
      fireEvent.canPlay(v);
    });
    expect(v.paused).toBe(true);
    expect(a.paused).toBe(true);
  });
  it.each(["error", "ended"])(
    "stops the whole custom mix on follower %s",
    async (event) => {
      setupStems(true);
      const user = userEvent.setup();
      render(
        <Performance
          song={timedSong()}
          onBack={vi.fn()}
          onSettings={vi.fn()}
        />,
      );
      await waitFor(() =>
        expect(
          (
            screen.getByRole("option", {
              name: "Свой микс",
            }) as HTMLOptionElement
          ).disabled,
        ).toBe(false),
      );
      await user.selectOptions(
        screen.getByLabelText("Режим звучания"),
        "custom",
      );
      await user.click(screen.getByRole("button", { name: "Воспроизвести" }));
      const v = media("player-vocals"),
        a = media("player-accompaniment");
      time(10, a);
      Object.defineProperty(v, "duration", { configurable: true, value: 10 });
      fireEvent(v, new Event(event));
      expect(v.paused).toBe(true);
      expect(a.paused).toBe(true);
      expect(screen.getByRole("alert").textContent).toContain(
        event === "ended" ? "закончилась раньше" : "Не удалось загрузить",
      );
    },
  );
  it("cancels a delayed native play after pause and releases mounted media on unmount", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    play.mockImplementationOnce(function (this: HTMLMediaElement) {
      const element = this;
      return new Promise<void>((resolve) => {
        finish = () => {
          paused.set(element, false);
          element.dispatchEvent(new Event("play"));
          resolve();
        };
      });
    });
    const view = render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    const original = media();
    await user.click(screen.getByRole("button", { name: "Воспроизвести" }));
    await user.click(screen.getByRole("button", { name: "Пауза" }));
    await act(async () => finish());
    expect(original.paused).toBe(true);
    await user.click(screen.getByRole("button", { name: "Воспроизвести" }));
    expect(original.paused).toBe(false);
    view.unmount();
    expect(original.paused).toBe(true);
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
  it("uses the shared media transport for timing corrections without creating a second preview player", async () => {
    const user = userEvent.setup();
    const view = render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Разметить вручную" }));
    fireEvent.click(screen.getByText("Проверка разметки выбранной строки"));
    time(2.25);
    await user.click(screen.getAllByRole("button", { name: "Из плеера" })[0]);
    expect(
      (screen.getByLabelText("Начало строки") as HTMLInputElement).value,
    ).toBe("2.25");
    expect(view.container.querySelectorAll("audio")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Прослушать строку" }));
    expect(media().currentTime).toBe(1.75);
    expect(media().paused).toBe(false);
    time(8.6);
    expect(media().paused).toBe(true);
  });
  it("starts secondary settings collapsed and scrolls only the lyrics pane with reduced motion respected", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });
    const view = render(
      <Performance song={timedSong()} onBack={vi.fn()} onSettings={vi.fn()} />,
    );
    expect(
      view.container.querySelector(".player-settings")?.hasAttribute("open"),
    ).toBe(false);
    const reader = view.container.querySelector(
      ".player-lyrics",
    ) as HTMLElement;
    const surface = view.container.querySelector(
      ".music-player",
    ) as HTMLElement;
    Object.defineProperties(reader, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1600 },
    });
    reader.getBoundingClientRect = () => new DOMRect(0, 200, 800, 300);
    surface.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 720);
    (
      view.container.querySelector(".player-transport") as HTMLElement
    ).getBoundingClientRect = () => new DOMRect(0, 600, 1000, 120);
    (
      screen.getByRole("button", { name: /^Строка 2:/ }) as HTMLElement
    ).getBoundingClientRect = () => new DOMRect(0, 900, 800, 100);
    await user.click(screen.getByRole("button", { name: "Воспроизвести" }));
    time(12);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(Element.prototype.scrollTo).toHaveBeenCalledWith({
      top: 610,
      behavior: "instant",
    });
    const receivers = (Element.prototype.scrollTo as ReturnType<typeof vi.fn>)
      .mock.instances;
    expect(
      receivers.every(
        (element) => element === view.container.querySelector(".player-lyrics"),
      ),
    ).toBe(true);
  });
});
