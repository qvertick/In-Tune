import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Line, Song } from "./model";
import { chordIntervals, type readingState } from "./playerReading";
import {
  instrumentNames,
  linePresentation,
  sectionPresentation,
} from "./songPresentation";
import { useI18n } from "./i18n";
import { formatTime, lineStart } from "./playerTiming";

export function InstrumentSequence({
  line,
  song,
  position,
  playing = false,
  readPosition,
  highlighting = true,
}: {
  line: Line;
  song: Song;
  position: number;
  playing?: boolean;
  readPosition: () => number;
  highlighting?: boolean;
}) {
  const node = useRef<HTMLSpanElement>(null),
    read = useRef(readPosition);
  read.current = readPosition;
  const intervals = useMemo(() => chordIntervals(line), [line]);
  const paint = useRef<(time: number) => void>(() => {});
  useLayoutEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let lastActive: string | undefined;
    paint.current = (time) => {
      node.current
        ?.querySelectorAll<HTMLElement>("[data-chord-id]")
        .forEach((element) => {
          const interval = intervals.find(
            (item) => item.id === element.dataset.chordId,
          );
          const active =
            !!interval &&
            time >= interval.start &&
            time < interval.end &&
            highlighting;
          element.classList.toggle("is-sounding", active);
          if (active) element.setAttribute("aria-current", "true");
          else element.removeAttribute("aria-current");
          if (active && lastActive !== interval!.id) {
            lastActive = interval!.id;
            const host = node.current;
            if (
              host &&
              host.clientWidth > 0 &&
              host.scrollWidth > host.clientWidth
            ) {
              const bounds = host.getBoundingClientRect(),
                current = element.getBoundingClientRect();
              const upcoming =
                element.nextElementSibling?.getBoundingClientRect();
              if (
                current.left < bounds.left ||
                (upcoming?.right ?? current.right) > bounds.right
              )
                host.scrollTo?.({
                  left: Math.max(
                    0,
                    host.scrollLeft + current.left - bounds.left - 8,
                  ),
                  behavior: "instant",
                });
            }
          }
          element.style.setProperty(
            "--chord-progress",
            active
              ? `${reduced?.matches ? 100 : (100 * (time - interval!.start)) / (interval!.end - interval!.start)}%`
              : "0%",
          );
        });
    };
    paint.current(read.current());
    return () => {
      paint.current = () => {};
    };
  }, [intervals, highlighting]);
  useLayoutEffect(
    () => paint.current(position),
    [position, intervals, highlighting],
  );
  useEffect(() => {
    if (!playing || !intervals.length || !highlighting) return;
    let frame: number | undefined;
    const draw = () => {
      frame = undefined;
      if (document.hidden) return;
      paint.current(read.current());
      frame = requestAnimationFrame(draw);
    };
    const visible = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      paint.current(read.current());
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    visible();
    document.addEventListener("visibilitychange", visible);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [playing, intervals, highlighting]);
  const occurrences = instrumentNames(line, song.palette),
    presentation = linePresentation(line);
  const names = occurrences.length
    ? occurrences
    : presentation.names.map((name, i) => ({ id: `text-${i}`, name }));
  return (
    <span ref={node} className="instrument-sequence">
      {names.map((item) => (
        <span
          key={item.id}
          data-chord-id={item.id}
          className="instrument-chord"
        >
          {item.name}
        </span>
      ))}
    </span>
  );
}

export function InstrumentRow({
  line,
  song,
  index,
  following,
  selected,
  position,
  readPosition,
  highlighting,
  onSelect,
  onMark,
}: {
  line: Line;
  song: Song;
  index: number;
  following: boolean;
  selected: boolean;
  position: number;
  readPosition: () => number;
  highlighting: boolean;
  onSelect: (id: string) => void;
  onMark: (id: string) => void;
}) {
  const { t } = useI18n();
  const metadata = linePresentation(line),
    start = lineStart(line);
  return (
    <div
      className="player-instrument-row"
      data-follow-row={following ? "true" : undefined}
    >
      <button
        type="button"
        className={`player-line instrument-line${selected ? " is-selected" : ""}`}
        aria-label={`${t("Строка")} ${index + 1}: ${t("Инструментальная строка")}`}
        aria-pressed={selected}
        onClick={() => onSelect(line.id)}
      >
        <span className="player-line-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="instrument-content">
          <InstrumentSequence
            line={line}
            song={song}
            position={position}
            readPosition={readPosition}
            highlighting={highlighting}
          />
          {metadata.repeats && (
            <small>{t("Повторов: {count}", { count: metadata.repeats })}</small>
          )}
          {!line.chords.length && !metadata.names.length && (
            <span>{t("Инструментальная часть")}</span>
          )}
        </span>
        <span className="player-line-time">
          {start === undefined ? "—" : formatTime(start)}
        </span>
      </button>
      {!!line.chords.length && (
        <button
          type="button"
          className="instrument-mark"
          onClick={() => onMark(line.id)}
        >
          {t("Разметить аккорды")}
        </button>
      )}
    </div>
  );
}

export function ReadingCue({
  state,
  song,
  position,
  playing,
  readPosition,
  highlighting,
}: {
  state: ReturnType<typeof readingState>;
  song: Song;
  position: number;
  playing: boolean;
  readPosition: () => number;
  highlighting: boolean;
}) {
  const { t } = useI18n();
  const section = state.section && sectionPresentation(state.section),
    strum = state.strum && linePresentation(state.strum);
  const nextTime = state.next && lineStart(state.next.line);
  return (
    <div className="player-reading-cue" data-reading-phase={state.phase}>
      <div className="reading-context">
        <strong>{section?.name || t("Текст песни")}</strong>
        {section?.repeats && (
          <span>{t("Повторов: {count}", { count: section.repeats })}</span>
        )}
        <span className="reading-status">
          {state.phase === "uncertain"
            ? t(
                state.endNeedsReview
                  ? "Конец фразы требует проверки"
                  : "Конец фразы не отмечен",
              )
            : state.countdown !== undefined && nextTime !== undefined
              ? t("Вокал через {seconds} с", {
                  seconds: Math.max(0, Math.ceil(nextTime - position)),
                })
              : state.phase === "instrumental"
                ? t("Инструментальная часть")
                : t("Сейчас звучит")}
        </span>
      </div>
      <div className="reading-music">
        {strum?.kind === "strum" && (
          <div className="reading-strum">
            <span>{strum.label}:</span> <span>{strum.pattern}</span>
          </div>
        )}
        {state.instrument.length > 0 && (
          <div className="reading-instruments">
            {state.instrumentPreview && (
              <span className="reading-instrument-preview-label">
                {t("Далее")} ·{" "}
                {sectionPresentation(state.instrument[0].section).name}
              </span>
            )}
            {state.instrument.map((row) => (
              <span key={row.line.id} className="reading-sequence">
                <InstrumentSequence
                  line={row.line}
                  song={song}
                  position={position}
                  readPosition={readPosition}
                  playing={playing}
                  highlighting={highlighting}
                />
                {linePresentation(row.line).repeats &&
                  linePresentation(row.line).repeats !== section?.repeats && (
                    <small
                      title={t("Повторов: {count}", {
                        count: linePresentation(row.line).repeats,
                      })}
                    >
                      ×{linePresentation(row.line).repeats}
                    </small>
                  )}
              </span>
            ))}
          </div>
        )}
      </div>
      {state.next && (
        <div className="reading-preview">
          <span>{t("Далее")}</span>
          <div className="reading-preview-lines">
            <p>{state.next.line.text}</p>
            {state.phase !== "vocal" && state.afterNext && (
              <p className="reading-preview-second">
                {state.afterNext.line.text}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
