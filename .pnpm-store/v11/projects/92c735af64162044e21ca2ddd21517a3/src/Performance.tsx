import DisclosureSummary from "./DisclosureSummary";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, Maximize, Pause, Play, RotateCcw } from "lucide-react";
import { PlayerLyricRow } from "./playerLyrics";
import type { Song } from "./model";
import TimingEditor from "./TimingEditor";
import LrcImport from "./lrcImport";
import SyncMarker from "./SyncMarker";
import {
  activeAt,
  allLines,
  formatTime,
  lineStart,
  mapDuration,
  playerMap,
  replaceLine,
  finiteTime,
} from "./playerTiming";
import { wordPlan } from "./wordTiming";
import LrclibDialog from "./LrclibDialog";
import { useI18n } from "./i18n";
import { translateError } from "./i18n";
import PolicyFooter from "./PolicyFooter";
import { useVisualSeek } from "./useVisualSeek";
import { useLyricFollow } from "./useLyricFollow";
import "./lyricFollow.css";
import { usePlayerMedia } from "./playerMedia";
import type { MixMode } from "./playerMedia";
import { StemControls, useStems } from "./playerStems";
import "./player.css";
import {
  recoverTimingDraft,
  serializeTimingDraft,
  timingDraftKey,
} from "./timingDraft";

type Props = {
  song: Song;
  onBack: () => void;
  onSettings: (settings: Song["performance"]) => void;
  onSong?: (song: Song) => void;
  saveStatus?: string;
};

export default function Performance(props: Props) {
  return <Player key={props.song.id} {...props} />;
}

function Player({ song, onBack, onSettings, onSong, saveStatus }: Props) {
  const { t, locale } = useI18n();
  const restored = useMemo(() => {
    try {
      return recoverTimingDraft(
        song,
        localStorage.getItem(timingDraftKey(song.id)),
      );
    } catch {
      return null;
    }
  }, []);
  const [draft, setDraft] = useState(restored ?? song),
    [dirty, setDirty] = useState(!!restored);
  const [draftNotice, setDraftNotice] = useState(
    restored
      ? "Восстановлена несохранённая временная карта. Проверьте и сохраните её."
      : "",
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    () => allLines(song)[0]?.id ?? null,
  );
  const [history, setHistory] = useState<
    { song: Song; selectedId: string | null }[]
  >([]);
  const [clean, setClean] = useState(false);
  const [toolMode, setToolMode] = useState<"manual" | "lrc" | null>(null);
  const toolsOpen = toolMode !== null;
  const [lrclibOpen, setLrclibOpen] = useState(false);
  const [approximate, setApproximate] = useState(() => {
    try {
      return localStorage.getItem("vlad-approximate-words") === "true";
    } catch {
      return false;
    }
  });
  const [highlighting, setHighlighting] = useState(() => {
    try {
      return localStorage.getItem("vlad-highlight-lyrics") !== "false";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("vlad-highlight-lyrics", String(highlighting));
    } catch {
      /* Session setting remains usable. */
    }
  }, [highlighting]);
  useEffect(() => {
    try {
      localStorage.setItem("vlad-approximate-words", String(approximate));
    } catch {
      /* Session setting still works. */
    }
  }, [approximate]);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null),
    markAction = useRef<(() => void) | null>(null);
  const activeElement = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    try {
      if (dirty)
        localStorage.setItem(
          timingDraftKey(song.id),
          serializeTimingDraft(song, draft),
        );
      else if (
        saveStatus === "Сохранено" &&
        JSON.stringify(song.sections) === JSON.stringify(draft.sections)
      )
        localStorage.removeItem(timingDraftKey(song.id));
    } catch {
      setDraftNotice(
        "Не удалось сохранить аварийную карту в браузере. Нажмите «Сохранить временную карту» до закрытия страницы.",
      );
    }
  }, [dirty, draft.sections, song.sections, song.audio?.url, saveStatus]);
  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);
  const lyricReader = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!dirty) setDraft(song);
  }, [song]);
  const working = useMemo(
    () => ({ ...song, sections: draft.sections }),
    [song, draft.sections],
  );
  const separation = useStems(song.id, !!song.audio);
  const textDuration = useMemo(() => mapDuration(working), [working]);
  const player = usePlayerMedia(
    song.id,
    song.audio?.url,
    separation.stems,
    textDuration,
  );
  const duration =
    player.duration ||
    (player.mode === "text" ? textDuration : (song.audio?.duration ?? 0));
  const map = useMemo(
    () => playerMap(working, duration || undefined),
    [working, duration],
  );
  const rows = useMemo(() => allLines(working), [working.sections]);
  const rowIndex = useMemo(
    () => new Map(rows.map((line, index) => [line.id, index])),
    [rows],
  );
  const timingById = useMemo(
    () => new Map(map.map((entry) => [entry.line.id, entry])),
    [map],
  );
  const wordPlans = useMemo(
    () =>
      new Map(
        rows.map((line) => {
          const boundary = timingById.get(line.id);
          return [
            line.id,
            wordPlan(line, boundary?.start, boundary?.end, approximate),
          ] as const;
        }),
      ),
    [rows, timingById, approximate],
  );
  const visual = useVisualSeek(
    player.readPosition,
    (time) => {
      const lineId = activeAt(map, time);
      const index =
        wordPlans
          .get(lineId ?? "")
          ?.words.findIndex((word) => time >= word.start && time < word.end) ??
        -1;
      return `${lineId}:${index}`;
    },
    highlighting && map.length > 0,
  );
  const displayPosition = visual.read();
  const activeId = activeAt(map, displayPosition);
  const readWordPosition = visual.read;
  const selected = rows[rowIndex.get(selectedId ?? "") ?? -1];
  const readyStems = !!(
    separation.stems?.ready &&
    separation.stems.vocalsUrl &&
    separation.stems.accompanimentUrl
  );
  const canPlay =
    player.mode === "text"
      ? textDuration > 0
      : player.mode === "original"
        ? !!song.audio
        : readyStems;
  const fontSize = Number.isFinite(song.performance.fontSize)
    ? Math.max(18, Math.min(60, song.performance.fontSize))
    : 28;
  const follow = useLyricFollow({
    reader: lyricReader,
    root,
    playing: player.playing,
    disabled: toolsOpen || lrclibOpen,
    activeId,
    fontSize,
    readPosition: readWordPosition,
    moving: visual.moving,
  });
  const pendingStart = useRef(false);
  useLayoutEffect(() => {
    if (player.jump.sequence && player.jump.source === "internal") {
      pendingStart.current = false;
      visual.cancel();
    }
  }, [player.jump.sequence]);
  useLayoutEffect(() => {
    if (!visual.moving && pendingStart.current) {
      pendingStart.current = false;
      follow.resume({ start: true });
    }
  }, [visual.moving]);
  function userSeek(
    time: number,
    from = player.readPosition(),
    visualFrom = visual.read(),
  ) {
    const next = player.seek(time, "user");
    if (next === undefined) return;
    const rewinding = visual.begin(from, next, visualFrom);
    pendingStart.current = next === 0 && rewinding;
    follow.resume({ start: next === 0 && !rewinding, instant: !rewinding });
  }
  const scrub = useRef<{ from: number; visual: number; value: number } | null>(
    null,
  );
  function startScrub() {
    if (!scrub.current) {
      scrub.current = {
        from: player.readPosition(),
        visual: visual.read(),
        value: player.readPosition(),
      };
      visual.cancel();
    }
  }
  function scrubTo(time: number) {
    if (scrub.current) {
      scrub.current.value = time;
      visual.cancel();
      player.seek(time, "user");
    } else userSeek(time);
  }
  function finishScrub() {
    const drag = scrub.current;
    if (!drag) return;
    scrub.current = null;
    userSeek(drag.value, drag.from, drag.visual);
  }

  function change(next: Song, nextId?: string) {
    player.pause();
    setHistory((past) => [...past.slice(-99), { song: working, selectedId }]);
    setDraft(next);
    setDirty(true);
    if (nextId) setSelectedId(nextId);
  }
  function markChange(next: Song, nextId?: string) {
    setHistory((past) => [...past.slice(-99), { song: working, selectedId }]);
    setDraft(next);
    setDirty(true);
    if (nextId) setSelectedId(nextId);
  }
  function undo() {
    const last = history.at(-1);
    if (!last) return;
    setDraft(last.song);
    setSelectedId(last.selectedId);
    setHistory((past) => past.slice(0, -1));
    setDirty(true);
  }
  function select(id: string, seek = true) {
    setSelectedId(id);
    const line = rows[rowIndex.get(id) ?? -1],
      time = line && lineStart(line);
    if (seek && time !== undefined) userSeek(time);
  }
  const selectAction = useRef<(id: string) => void>(() => {});
  selectAction.current = (id) => select(id, !toolsOpen);
  const chooseLine = useCallback((id: string) => selectAction.current(id), []);
  function move(delta: number) {
    const index = rowIndex.get(selectedId ?? "") ?? -1;
    const line = rows[Math.max(0, Math.min(rows.length - 1, index + delta))];
    if (line) select(line.id, !toolsOpen);
  }
  function togglePlay() {
    if (player.playing || player.buffering) {
      visual.cancel();
      player.pause();
    } else if (canPlay) void player.play();
  }
  const keys = useRef({ togglePlay, move, toolsOpen });
  keys.current = { togglePlay, move, toolsOpen };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey)
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          "input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']",
        )
      )
        return;
      if (event.code === "KeyM" && keys.current.toolsOpen) {
        event.preventDefault();
        markAction.current?.();
      } else if (
        event.code === "Space" &&
        !(target instanceof HTMLElement && target.closest("button,summary,a"))
      ) {
        event.preventDefault();
        keys.current.togglePlay();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        keys.current.move(event.key === "ArrowDown" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.current?.requestFullscreen)
        await root.current.requestFullscreen();
      else setError("Полноэкранный режим недоступен в этом браузере.");
    } catch {
      setError("Не удалось открыть полноэкранный режим.");
    }
  }
  function setBoundary(boundary: "a" | "b") {
    const time = player.readPosition();
    player.setLoop((loop) => ({ ...loop, [boundary]: time, enabled: false }));
  }
  function save() {
    if (!onSong) return;
    onSong({ ...working, updatedAt: new Date().toISOString() });
    setDirty(false);
  }

  return (
    <div
      ref={root}
      className={`music-player${clean ? " player-clean" : ""}`}
      data-rewinding={visual.moving ? "true" : "false"}
      style={{ "--player-font-size": `${fontSize}px` } as CSSProperties}
    >
      <audio
        data-testid="player-original"
        ref={player.original}
        src={song.audio?.url}
        preload="metadata"
        {...player.events("original")}
      />
      <audio
        data-testid="player-vocals"
        ref={player.vocals}
        src={separation.stems?.ready ? separation.stems.vocalsUrl : undefined}
        preload="metadata"
        {...player.events("vocals")}
      />
      <audio
        data-testid="player-accompaniment"
        ref={player.accompaniment}
        src={
          separation.stems?.ready
            ? separation.stems.accompanimentUrl
            : undefined
        }
        preload="metadata"
        {...player.events("accompaniment")}
      />

      <header className="player-header">
        <button
          type="button"
          className="player-back"
          onClick={() => {
            player.pause();
            if (dirty && onSong) save();
            onBack();
          }}
        >
          <ArrowLeft size={17} />
          {t("К редактору")}{" "}
        </button>
        <div className="player-title">
          <p className="player-eyebrow">{t("Исполнение · плеер")}</p>
          <h1>{song.title || t("Без названия")}</h1>
          {song.artist && <p>{song.artist}</p>}
        </div>
        <div className="player-actions">
          <button
            type="button"
            aria-pressed={clean}
            onClick={() => setClean(!clean)}
          >
            {clean ? t("Показать панели") : t("Чистый экран")}
          </button>
          <button
            type="button"
            onClick={() => void fullscreen()}
            aria-label={t("Полный экран")}
          >
            <Maximize size={18} />
          </button>
        </div>
      </header>
      {draftNotice && (
        <p className="player-notice" role="status">
          {translateError(locale, draftNotice)}
        </p>
      )}

      <div className="player-workspace">
        <aside className="player-side">
          <label>
            {t("Режим звучания")}{" "}
            <select
              value={player.mode}
              onChange={(event) =>
                player.changeMode(event.target.value as MixMode)
              }
            >
              <option value="original" disabled={!song.audio}>
                {t("Оригинал")}{" "}
              </option>
              <option value="vocals" disabled={!readyStems}>
                {t("Вокал")}{" "}
              </option>
              <option value="accompaniment" disabled={!readyStems}>
                {t("Аккомпанемент")}{" "}
              </option>
              <option value="custom" disabled={!readyStems}>
                {t("Свой микс")}{" "}
              </option>
              <option value="text">{t("Только текст")}</option>
            </select>
          </label>
          <label>
            {t("Раздел")}{" "}
            <select
              value={
                working.sections.find((section) =>
                  section.lines.some((line) => line.id === selectedId),
                )?.id ?? ""
              }
              onChange={(event) => {
                const line = working.sections.find(
                  (section) => section.id === event.target.value,
                )?.lines[0];
                if (line) select(line.id);
              }}
            >
              {working.sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
          </label>
          <details className="player-settings">
            <DisclosureSummary>{t("Настройки исполнения")}</DisclosureSummary>
            <label className="word-highlight-toggle">
              <input
                type="checkbox"
                checked={highlighting}
                onChange={(event) => setHighlighting(event.target.checked)}
              />
              {t("Подсветка текста")}
            </label>
            <label className="word-highlight-toggle">
              <input
                type="checkbox"
                checked={approximate}
                onChange={(event) => setApproximate(event.target.checked)}
              />
              {t("Приблизительная подсветка слов")}
            </label>
            <p className="player-hint">
              {t(
                "Оценка по длительности строки, а не распознавание. Долгие интервалы и проигрыши остаются с подсветкой строки. Реальные отметки слов используются всегда.",
              )}
            </p>
            <label>
              {t("Размер текста ·")} {fontSize}
              <input
                aria-label={t("Размер текста")}
                type="range"
                min="18"
                max="60"
                step="1"
                value={fontSize}
                onChange={(event) =>
                  onSettings({
                    ...song.performance,
                    fontSize: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              {t("Скорость")}{" "}
              <select
                value={player.rate}
                onChange={(event) => player.setRate(Number(event.target.value))}
              >
                {[0.5, 0.65, 0.75, 0.85, 1, 1.1, 1.25, 1.5].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}×
                  </option>
                ))}
              </select>
            </label>
            <p className="player-hint">
              {t("Высота тона сохраняется средствами браузера.")}{" "}
            </p>
            <label>
              {t("Громкость")}{" "}
              <input
                aria-label={t("Громкость")}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={player.volume}
                disabled={player.mode === "text"}
                onChange={(event) =>
                  player.setVolume(Number(event.target.value))
                }
              />
            </label>
            <div className="player-loop">
              <p>{t("Повтор A–B")}</p>
              <div className="player-actions">
                <button
                  type="button"
                  disabled={!canPlay}
                  onClick={() => setBoundary("a")}
                >
                  A · {formatTime(player.loop.a)}
                </button>
                <button
                  type="button"
                  disabled={!canPlay}
                  onClick={() => setBoundary("b")}
                >
                  B · {formatTime(player.loop.b)}
                </button>
                <button
                  type="button"
                  aria-pressed={player.loop.enabled}
                  disabled={!canPlay || player.loop.b <= player.loop.a}
                  onClick={() => {
                    if (!player.loop.enabled) player.seek(player.loop.a);
                    player.setLoop((loop) => ({
                      ...loop,
                      enabled: !loop.enabled,
                    }));
                  }}
                >
                  {t("Повтор")} {player.loop.enabled ? t("вкл") : t("выкл")}
                </button>
              </div>
              <p className="player-hint">
                {t(
                  "Установите A и B по текущей позиции. B должна быть позже A.",
                )}{" "}
              </p>
            </div>
          </details>
          {song.audio && (
            <StemControls
              separation={separation}
              vocalMix={player.vocalMix}
              backingMix={player.backingMix}
              onVocalMix={player.setVocalMix}
              onBackingMix={player.setBackingMix}
            />
          )}
          <div className="player-save">
            <button type="button" disabled={!dirty || !onSong} onClick={save}>
              {t("Сохранить временную карту")}{" "}
            </button>
            <span role="status">
              {dirty
                ? t("Есть несохранённые отметки")
                : t(saveStatus ?? "Карта сохранена")}
            </span>
            {!onSong && <p>{t("Сохранение недоступно в этом режиме.")}</p>}
            {!!history.length && (
              <button type="button" onClick={undo}>
                {t("Отменить изменение карты")}
              </button>
            )}
          </div>
          {!clean && <PolicyFooter />}
        </aside>

        <section className="player-main" aria-label={t("Текст и разметка")}>
          {follow.suspended && !toolsOpen && !lrclibOpen && (
            <button
              type="button"
              className="player-follow-return"
              onClick={() => follow.resume()}
            >
              {t("К текущей строке")}
            </button>
          )}
          {!map.length && (
            <div className="player-notice">
              <strong>{t("Временной карты пока нет")}</strong>
              <p>
                {t(
                  "Выбирайте строки вручную. Создайте отметки под аудио или импортируйте LRC.",
                )}{" "}
              </p>
            </div>
          )}
          {!clean && (
            <div
              className="sync-choices"
              aria-label={t("Синхронизация текста")}
            >
              <button
                type="button"
                onClick={() => {
                  player.pause();
                  setLrclibOpen(true);
                }}
              >
                {t("Найти синхронизацию")}
              </button>
              <button
                type="button"
                aria-pressed={toolMode === "lrc"}
                onClick={() => setToolMode(toolMode === "lrc" ? null : "lrc")}
              >
                {t("Импортировать LRC")}
              </button>
              <button
                type="button"
                aria-pressed={toolMode === "manual"}
                onClick={() =>
                  setToolMode(toolMode === "manual" ? null : "manual")
                }
              >
                {t("Разметить вручную")}
              </button>
            </div>
          )}
          {map.length > 0 &&
            map.length < rows.filter((line) => line.text.trim()).length && (
              <p className="player-notice">
                {t(
                  "Карта частичная: подсвечиваются только проверенные интервалы.",
                )}{" "}
              </p>
            )}
          {wordPlans.get(activeId ?? selectedId ?? "")?.kind ===
            "word-starts" && (
            <p className="player-mode-note">
              {t(
                "Начала слов заданы в источнике; длительность заливки между ними приблизительная.",
              )}
            </p>
          )}
          {player.mode === "text" && (
            <p className="player-mode-note">
              {t("Только текст ·")}{" "}
              {textDuration > 0
                ? t("отдельные часы по сохранённой карте")
                : t("без временной карты доступен ручной переход")}
            </p>
          )}
          {toolsOpen && (
            <div className="player-tools">
              <div className="player-actions">
                <button type="button" onClick={() => setToolMode(null)}>
                  {t("Закрыть разметку")}
                </button>
              </div>
              {toolMode === "manual" && (
                <>
                  <SyncMarker
                    song={working}
                    selectedId={selectedId}
                    select={(id) => select(id, false)}
                    currentTime={player.readPosition}
                    onChange={markChange}
                    onUndo={undo}
                    canUndo={!!history.length}
                    onRecord={() => void player.play()}
                    enabled={canPlay && player.mode !== "text"}
                    onMarkRef={(action) => {
                      markAction.current = action;
                    }}
                  />
                  {selected && (
                    <TimingEditor
                      song={working}
                      line={selected}
                      transport={{
                        currentTime: player.readPosition,
                        listen: player.listen,
                      }}
                      onSave={(line) => change(replaceLine(working, line))}
                    />
                  )}
                </>
              )}
              {toolMode === "lrc" && (
                <LrcImport
                  song={working}
                  duration={duration}
                  onApply={change}
                  initiallyOpen
                />
              )}
              <p className="player-hint">
                {t(
                  "Исправление времени работает в секундах. Для прослушивания используйте общий плеер, чтобы позиция оставалась единой.",
                )}{" "}
              </p>
            </div>
          )}
          <div
            ref={lyricReader}
            className="player-lyrics"
            tabIndex={0}
            aria-label={t("Текст песни")}
          >
            {working.sections.map((section) => (
              <section key={section.id} className="player-section">
                <button
                  type="button"
                  className="player-section-name"
                  onClick={() => {
                    if (section.lines[0]) select(section.lines[0].id);
                  }}
                >
                  {section.name}
                </button>
                {section.lines.map((line) => {
                  const plan = wordPlans.get(line.id);
                  const position = plan
                    ? line.id === activeId
                      ? displayPosition
                      : displayPosition >= plan.words.at(-1)!.end
                        ? Infinity
                        : -Infinity
                    : undefined;
                  return (
                    <PlayerLyricRow
                      key={line.id}
                      line={line}
                      song={working}
                      index={rowIndex.get(line.id)!}
                      active={line.id === activeId}
                      selected={selectedId === line.id}
                      past={
                        (timingById.get(line.id)?.end ?? Infinity) <=
                        displayPosition
                      }
                      position={position}
                      plan={plan}
                      playing={
                        line.id === activeId &&
                        (player.playing || visual.moving)
                      }
                      highlighting={highlighting}
                      readPosition={readWordPosition}
                      activeRef={activeElement}
                      onSelect={chooseLine}
                    />
                  );
                })}
              </section>
            ))}
          </div>
        </section>
      </div>

      <footer
        className="player-transport"
        aria-label={t("Управление воспроизведением")}
      >
        <div className="player-transport-row">
          <button
            type="button"
            className="player-play"
            disabled={!canPlay}
            onClick={togglePlay}
            aria-label={
              player.playing || player.buffering
                ? t("Пауза")
                : t("Воспроизвести")
            }
          >
            {player.playing || player.buffering ? (
              <Pause size={22} />
            ) : (
              <Play size={22} />
            )}
          </button>
          <button
            type="button"
            disabled={!canPlay}
            aria-label={t("В начало")}
            onClick={() => userSeek(0)}
          >
            <RotateCcw size={18} />
          </button>
          <output aria-label={t("Время воспроизведения")}>
            {formatTime(player.position)}{" "}
            <span>/ {duration ? formatTime(duration) : "—:——"}</span>
          </output>
          <span className="player-transport-state">
            {player.buffering
              ? t("Загрузка аудио…")
              : player.playing
                ? t("Воспроизведение")
                : t("Пауза")}{" "}
            · {player.rate}×
          </span>
          <div className="player-actions">
            <button
              type="button"
              disabled={!rows.length}
              onClick={() => move(-1)}
            >
              {t("↑ Строка")}{" "}
            </button>
            <button
              type="button"
              disabled={!rows.length}
              onClick={() => move(1)}
            >
              {t("↓ Строка")}{" "}
            </button>
          </div>
        </div>
        <input
          aria-label={t("Позиция воспроизведения")}
          className="player-seek"
          type="range"
          min="0"
          max={duration || Math.max(player.position, 1)}
          step="0.01"
          value={Math.min(player.position, duration || Infinity)}
          disabled={!canPlay || !duration}
          onPointerDown={(event) => {
            startScrub();
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerUp={finishScrub}
          onPointerCancel={finishScrub}
          onLostPointerCapture={finishScrub}
          onKeyDown={(event) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(event.key)
            )
              startScrub();
          }}
          onKeyUp={finishScrub}
          onBlur={finishScrub}
          onChange={(event) => scrubTo(Number(event.target.value))}
        />
        {(player.error || error) && (
          <p role="alert">{translateError(locale, player.error || error)}</p>
        )}
      </footer>
      {lrclibOpen && (
        <LrclibDialog
          song={working}
          onApply={change}
          onClose={() => setLrclibOpen(false)}
        />
      )}
    </div>
  );
}
