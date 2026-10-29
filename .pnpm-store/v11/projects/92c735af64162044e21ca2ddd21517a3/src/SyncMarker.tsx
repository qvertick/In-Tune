import { useI18n, translateError } from "./i18n";
import { useState } from "react";
import type { Song } from "./model";
import { linePresentation } from "./songPresentation";
import {
  allLines,
  formatTime,
  lineStart,
  markEnd,
  markStart,
  shiftTimings,
} from "./playerTiming";

export default function SyncMarker({
  song,
  selectedId,
  select,
  currentTime,
  onChange,
  onUndo,
  canUndo,
  onRecord,
  enabled,
  onMarkRef,
}: {
  song: Song;
  selectedId: string | null;
  select: (id: string) => void;
  currentTime: () => number;
  onChange: (song: Song, nextId?: string) => void;
  onUndo: () => void;
  canUndo: boolean;
  onRecord: () => void;
  enabled: boolean;
  onMarkRef: (action: (() => void) | null) => void;
}) {
  const { t, locale } = useI18n();
  const [error, setError] = useState(""),
    [shift, setShift] = useState("0");
  const lines = allLines(song).filter(
      (line) => linePresentation(line).kind === "vocal",
    ),
    index = lines.findIndex((line) => line.id === selectedId),
    selected = lines[index];
  function attempt(action: () => void) {
    try {
      action();
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function mark() {
    if (!enabled || !selected) return;
    attempt(() => {
      onChange(
        markStart(song, selected.id, currentTime(), lines[index - 1]?.id),
        lines[index + 1]?.id ?? selected.id,
      );
    });
  }
  // Assignment only: the parent invokes the current action from its scoped keyboard handler.
  onMarkRef(mark);
  return (
    <section className="player-marker" aria-label={t("Ручная разметка")}>
      <div className="player-marker-heading">
        <div>
          <p className="player-eyebrow">{t("Ручная разметка")}</p>
          <h2>{t("Слушайте и отмечайте начало строки")}</h2>
        </div>
        <button type="button" disabled={!enabled} onClick={onRecord}>
          {t("Воспроизвести для разметки")}
        </button>
      </div>
      <p>
        {t("Выбрана строка ")}
        {index + 1} {t(" из ")}
        {lines.length}: <strong>{selected?.text || "—"}</strong>
      </p>
      <p className="player-marker-next">
        {t("Следующая строка")}:{" "}
        <strong>{lines[index + 1]?.text || "—"}</strong>
      </p>
      {!selected && (
        <button
          type="button"
          disabled={!lines.length}
          onClick={() => select(lines[0].id)}
        >
          {t("Начать с первой строки")}
        </button>
      )}
      <button
        type="button"
        className="player-mark"
        disabled={!enabled || !selected}
        onClick={mark}
      >
        {t("Отметить начало → ")}
        <kbd>M</kbd>
      </button>
      <p className="player-hint">
        {t(
          "Отметка берётся из текущего времени аудио. После отметки выбирается следующая строка. Последнюю завершите кнопкой «Отметить конец».",
        )}
      </p>
      <div className="player-actions">
        <button
          type="button"
          disabled={index <= 0}
          onClick={() => select(lines[index - 1].id)}
        >
          {t("Предыдущая строка")}
        </button>
        <button
          type="button"
          disabled={index < 0 || index >= lines.length - 1}
          onClick={() => select(lines[index + 1].id)}
        >
          {t("Пропустить строку")}
        </button>
        <button
          type="button"
          disabled={!canUndo}
          onClick={() => {
            onUndo();
            setError("");
          }}
        >
          {t("Отменить отметку")}
        </button>
        <button
          type="button"
          disabled={!enabled || !selected}
          onClick={() =>
            attempt(() => {
              onChange(markEnd(song, selected!.id, currentTime()));
            })
          }
        >
          {t("Отметить конец")}
        </button>
      </div>
      {selected && (
        <p>
          {t("Начало выбранной:")}{" "}
          {lineStart(selected) === undefined
            ? t("не отмечено")
            : formatTime(lineStart(selected)!)}{" "}
          {selected.timingReview ? t("· нужно проверить") : ""}
        </p>
      )}
      {!enabled && (
        <p>
          {t(
            "Для записи отметок прикрепите MP3 в редакторе и выберите аудиорежим.",
          )}
        </p>
      )}
      <div className="player-fields">
        <label>
          {t("Общий сдвиг, секунды")}
          <input
            type="number"
            step="0.1"
            value={shift}
            onChange={(event) => setShift(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!shift.trim()}
          onClick={() =>
            attempt(() => onChange(shiftTimings(song, Number(shift))))
          }
        >
          {t("Сдвинуть всю карту")}
        </button>
      </div>
      {error && <p role="alert">{translateError(locale, error)}</p>}
    </section>
  );
}
