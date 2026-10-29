import { useI18n, translateError } from "./i18n";
import DisclosureSummary from "./DisclosureSummary";
import { useEffect, useRef, useState } from "react";
import type { Line, Song } from "./model";
import { validWords } from "./timeline";
import { instrumentNames, linePresentation } from "./songPresentation";
import ChordTimingEditor from "./ChordTimingEditor";

export default function TimingEditor({
  song,
  line,
  onSave,
  disabled = false,
  transport,
  onSaveChords,
}: {
  song: Song;
  line: Line;
  onSave: (line: Line) => void;
  disabled?: boolean;
  transport?: {
    currentTime: () => number;
    listen: (start: number, end?: number) => void;
    canMark?: boolean;
  };
  onSaveChords?: (line: Line) => void;
}) {
  const { t, locale } = useI18n();
  const instrumental = linePresentation(line).kind === "instrumental";
  const player = useRef<HTMLAudioElement>(null);
  const until = useRef<number | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [words, setWords] = useState<
    { text: string; start: string; end: string }[]
  >([]);
  const [wordMode, setWordMode] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setStart(String(line.start ?? line.words?.[0]?.start ?? ""));
    setEnd(String(line.end ?? line.words?.at(-1)?.end ?? ""));
    const valid = validWords(line);
    setWordMode(valid);
    setWords(
      (line.text.match(/\S+/gu) || []).map((text, i) => ({
        text,
        start: valid ? String(line.words![i].start) : "",
        end: valid ? String(line.words![i].end) : "",
      })),
    );
    setError("");
    until.current = null;
    player.current?.pause();
  }, [line]);
  useEffect(() => {
    if (disabled) player.current?.pause();
  }, [disabled]);
  function listen(from: string, to: string) {
    if (transport) {
      if (from !== "" && Number.isFinite(Number(from)))
        transport.listen(Number(from), to === "" ? undefined : Number(to));
      return;
    }
    const p = player.current;
    if (!p || from === "" || !Number.isFinite(Number(from))) return;
    p.currentTime = Math.max(0, Number(from) - 0.5);
    until.current = to === "" ? null : Number(to) + 0.5;
    void p.play().catch(() => setError("Не удалось воспроизвести оригинал."));
  }
  function save() {
    setError("");
    const a = Number(start),
      b = Number(end);
    if (
      start === "" ||
      end === "" ||
      !Number.isFinite(a + b) ||
      a < 0 ||
      b <= a
    ) {
      setError(
        "Укажите начало и конец строки в секундах; конец должен быть позже начала.",
      );
      return;
    }
    const rows = song.sections.flatMap((s) => s.lines),
      index = rows.findIndex((l) => l.id === line.id);
    const previous = rows[index - 1],
      nextLine = rows[index + 1];
    if (
      (!previous?.timingReview &&
        (previous?.end ?? previous?.words?.at(-1)?.end ?? 0) > a) ||
      (!nextLine?.timingReview && (nextLine?.start ?? Infinity) < b)
    ) {
      setError(
        "Интервал пересекается с соседней строкой. Проверьте времена обеих строк.",
      );
      return;
    }
    const next: Line = {
      ...line,
      start: a,
      end: b,
      timingReview: false,
      manuallyEdited: true,
    };
    delete next.wordStarts;
    if (wordMode && words.length) {
      const timed = words.map((w) => ({
        text: w.text,
        start: Number(w.start),
        end: Number(w.end),
      }));
      if (
        words.some((w) => w.start === "" || w.end === "") ||
        timed.some(
          (w, i) =>
            !Number.isFinite(w.start + w.end) ||
            w.start < a ||
            w.end > b ||
            w.end <= w.start ||
            (i > 0 && w.start < timed[i - 1].end),
        )
      ) {
        setError(
          "Задайте интервалы всех слов внутри строки, по порядку и без пересечений. Или выключите отметки слов.",
        );
        return;
      }
      next.words = timed;
    } else delete next.words;
    onSave(next);
  }
  const timeInput = (
    label: string,
    value: string,
    change: (value: string) => void,
  ) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => change(e.target.value)}
      />
      {song.audio && (
        <button
          type="button"
          onClick={() =>
            change(
              (
                transport?.currentTime() ??
                player.current?.currentTime ??
                0
              ).toFixed(2),
            )
          }
        >
          {t("Из плеера")}
        </button>
      )}
    </label>
  );
  return (
    <details className="timing-editor" open={instrumental || undefined}>
      <DisclosureSummary>
        {t(
          instrumental
            ? "Разметка инструментальной последовательности"
            : "Проверка разметки выбранной строки",
        )}
      </DisclosureSummary>
      <p>
        {instrumental
          ? instrumentNames(line, song.palette)
              .map((item) => item.name)
              .join(" · ") || t("Инструментальная строка")
          : line.text}
      </p>
      <p className="muted">
        {t(
          instrumental
            ? "Отметки берутся из общего плеера. Границы строки необязательны для отметок отдельных аккордов."
            : "Времена в секундах оригинала. Исправьте границы выбранной строки или отдельные слова. Равномерная разметка не создаётся.",
        )}
      </p>
      {line.timingReview && (
        <p className="notice">
          {t(
            "Разметку нужно проверить после изменения текста или неполного распознавания.",
          )}
        </p>
      )}
      {transport ? (
        <p className="muted">
          {t("Прослушивание и отметки используют общий плеер.")}
        </p>
      ) : song.audio ? (
        <audio
          ref={player}
          controls
          preload="metadata"
          src={song.audio.url}
          onTimeUpdate={() => {
            if (
              player.current &&
              until.current !== null &&
              player.current.currentTime >= until.current
            ) {
              player.current.pause();
              until.current = null;
            }
          }}
          onPlay={() => {
            if (disabled) player.current?.pause();
          }}
        />
      ) : (
        <p className="muted">
          {t("Для прослушивания прикрепите оригинальный MP3 в редакторе.")}
        </p>
      )}
      <fieldset disabled={disabled}>
        {instrumental && line.chords.length > 0 && transport && (
          <ChordTimingEditor
            line={line}
            song={song}
            currentTime={transport.currentTime}
            onSave={onSaveChords ?? onSave}
            enabled={!!song.audio && !disabled && transport.canMark !== false}
          />
        )}
        <div className="timing-fields">
          {timeInput(t("Начало строки"), start, setStart)}
          {timeInput(t("Конец строки"), end, setEnd)}
          <button disabled={!song.audio} onClick={() => listen(start, end)}>
            {t("Прослушать строку")}
          </button>
        </div>
        {!instrumental && (
          <label>
            <input
              type="checkbox"
              checked={wordMode}
              onChange={(e) => setWordMode(e.target.checked)}
            />{" "}
            {t("Отметки каждого слова")}
          </label>
        )}
        {wordMode &&
          words.map((word, i) => (
            <div key={i} className="timing-fields">
              <span>{word.text}</span>
              {timeInput(
                t("Начало слова {value0}", { value0: i + 1 }),
                word.start,
                (v) =>
                  setWords((ws) =>
                    ws.map((w, j) => (j === i ? { ...w, start: v } : w)),
                  ),
              )}
              {timeInput(
                t("Конец слова {value0}", { value0: i + 1 }),
                word.end,
                (v) =>
                  setWords((ws) =>
                    ws.map((w, j) => (j === i ? { ...w, end: v } : w)),
                  ),
              )}
              <button
                disabled={!song.audio}
                onClick={() => listen(word.start, word.end)}
              >
                {t("Слушать")}
              </button>
            </div>
          ))}
        <button onClick={save}>{t("Сохранить разметку строки")}</button>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {translateError(locale, error)}
        </p>
      )}
    </details>
  );
}
