import { useEffect, useState } from "react";
import type { Line, Song } from "./model";
import { instrumentNames } from "./songPresentation";
import { useI18n, translateError } from "./i18n";

export function markChord(line: Line, id: string, time: number): Line {
  const ordered = [...line.chords].sort((a, b) => a.offset - b.offset),
    index = ordered.findIndex((c) => c.id === id);
  const previous = ordered[index - 1],
    next = ordered[index + 1];
  if (
    index < 0 ||
    !Number.isFinite(time) ||
    time < 0 ||
    (previous?.start !== undefined && time <= previous.start) ||
    (next?.start !== undefined && time >= next.start) ||
    (previous?.end !== undefined && time < previous.end)
  )
    throw new Error("Отметки аккордов должны идти по порядку.");
  return {
    ...line,
    manuallyEdited: true,
    chords: line.chords.map((chord) =>
      chord.id === id
        ? { ...chord, start: time, end: undefined, manuallyEdited: true }
        : chord.id === previous?.id &&
            previous.start !== undefined &&
            previous.end === undefined
          ? { ...chord, end: time, manuallyEdited: true }
          : chord,
    ),
  };
}

export default function ChordTimingEditor({
  line,
  song,
  currentTime,
  onSave,
  enabled,
}: {
  line: Line;
  song: Song;
  currentTime: () => number;
  onSave: (line: Line) => void;
  enabled: boolean;
}) {
  const { t, locale } = useI18n(),
    [error, setError] = useState("");
  const [values, setValues] = useState<
    Record<string, { start: string; end: string }>
  >({});
  useEffect(() => {
    setValues(
      Object.fromEntries(
        line.chords.map((chord) => [
          chord.id,
          { start: String(chord.start ?? ""), end: String(chord.end ?? "") },
        ]),
      ),
    );
    setError("");
  }, [line]);
  const ordered = instrumentNames(line, song.palette),
    next = ordered.find((item) => item.chord.start === undefined);
  function attempt(action: () => void) {
    try {
      action();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function save() {
    attempt(() => {
      let previousEnd = -Infinity,
        previousStart = -Infinity;
      const updates = new Map(
        ordered.map((item) => {
          const value = values[item.id] ?? { start: "", end: "" };
          const start = value.start === "" ? undefined : Number(value.start),
            end = value.end === "" ? undefined : Number(value.end);
          if (
            (start !== undefined &&
              (!Number.isFinite(start) ||
                start < 0 ||
                start <= previousStart ||
                start < previousEnd)) ||
            (end !== undefined &&
              (start === undefined || !Number.isFinite(end) || end <= start)) ||
            (song.audio?.duration !== undefined &&
              (end ?? start ?? 0) > song.audio.duration)
          )
            throw new Error(
              "Проверьте времена аккордов: по порядку, без пересечений.",
            );
          if (start !== undefined) previousStart = start;
          previousEnd = end ?? -Infinity;
          return [item.id, { start, end }] as const;
        }),
      );
      onSave({
        ...line,
        manuallyEdited: true,
        chords: line.chords.map((chord) => ({
          ...chord,
          ...updates.get(chord.id),
          manuallyEdited: true,
        })),
      });
    });
  }
  return (
    <section
      className="chord-timing-editor"
      aria-label={t("Времена инструментальных аккордов")}
    >
      <h3>{t("Смены аккордов")}</h3>
      <p className="player-hint">
        {t(
          "Слушайте запись и отмечайте реальные смены. Повторы не получают выдуманные времена.",
        )}
      </p>
      <div className="player-actions">
        <button
          type="button"
          disabled={!enabled || !next}
          onClick={() =>
            attempt(() => {
              const time = currentTime();
              if (
                song.audio?.duration !== undefined &&
                time > song.audio.duration
              )
                throw new Error("Недопустимое время отметки.");
              onSave(markChord(line, next!.id, time));
            })
          }
        >
          {t("Отметить следующий аккорд")}
          {next ? ` · ${next.name}` : ""}
        </button>
        <button
          type="button"
          disabled={
            !enabled ||
            !ordered.length ||
            ordered.at(-1)?.chord.start === undefined
          }
          onClick={() =>
            attempt(() => {
              const last = ordered.at(-1)!.chord,
                time = currentTime();
              if (!Number.isFinite(time) || time <= (last.start ?? Infinity))
                throw new Error("Конец должен быть позже начала строки.");
              onSave({
                ...line,
                manuallyEdited: true,
                chords: line.chords.map((chord) =>
                  chord.id === last.id
                    ? { ...chord, end: time, manuallyEdited: true }
                    : chord,
                ),
              });
            })
          }
        >
          {t("Отметить конец аккордов")}
        </button>
      </div>
      <div className="chord-time-list">
        {ordered.map((item) => (
          <div key={item.id} className="chord-time-row">
            <strong>{item.name}</strong>
            {(["start", "end"] as const).map((field) => (
              <label key={field}>
                {t(field === "start" ? "Начало" : "Конец")}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label={t(
                    field === "start"
                      ? "Начало аккорда {name}"
                      : "Конец аккорда {name}",
                    { name: item.name },
                  )}
                  value={values[item.id]?.[field] ?? ""}
                  onChange={(event) =>
                    setValues((old) => ({
                      ...old,
                      [item.id]: {
                        ...(old[item.id] ?? { start: "", end: "" }),
                        [field]: event.target.value,
                      },
                    }))
                  }
                />
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() =>
                    setValues((old) => ({
                      ...old,
                      [item.id]: {
                        ...(old[item.id] ?? { start: "", end: "" }),
                        [field]: currentTime().toFixed(2),
                      },
                    }))
                  }
                >
                  {t("Из плеера")}
                </button>
              </label>
            ))}
          </div>
        ))}
      </div>
      <button type="button" onClick={save}>
        {t("Сохранить времена аккордов")}
      </button>
      {error && <p role="alert">{translateError(locale, error)}</p>}
    </section>
  );
}
