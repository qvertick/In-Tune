import type { Line, Song } from "./model";
import { validWords } from "./timeline";

export const finiteTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
export const allLines = (song: Song) => song.sections.flatMap((s) => s.lines);
export function lineStart(line: Line) {
  if (line.timingReview) return undefined;
  const start =
    line.start ?? (validWords(line) ? line.words?.[0]?.start : undefined);
  return finiteTime(start) ? start : undefined;
}
export function playerMap(song: Song, duration?: number) {
  const lines = allLines(song);
  return lines
    .flatMap((line, i) => {
      const start = lineStart(line);
      const end =
        line.end ??
        (validWords(line) ? line.words?.at(-1)?.end : undefined) ??
        (lines[i + 1] ? lineStart(lines[i + 1]) : duration);
      return start !== undefined && finiteTime(end) && end > start
        ? [{ line, start, end }]
        : [];
    })
    .sort((a, b) => a.start - b.start);
}
export function mapDuration(song: Song) {
  return Math.max(
    0,
    ...playerMap(song, song.audio?.duration).map((e) => e.end),
  );
}
export function activeAt(map: ReturnType<typeof playerMap>, position: number) {
  return (
    map.find((entry) => position >= entry.start && position < entry.end)?.line
      .id ?? null
  );
}
export function replaceLine(song: Song, line: Line): Song {
  return {
    ...song,
    sections: song.sections.map((section) => ({
      ...section,
      lines: section.lines.map((item) => (item.id === line.id ? line : item)),
    })),
  };
}
/** Marks only the chosen line; never distributes unmarked lyrics over the track. */
export function markStart(
  song: Song,
  id: string,
  time: number,
  previousId?: string,
): Song {
  if (!finiteTime(time)) throw new Error("Недопустимое время отметки.");
  const lines = allLines(song),
    index = lines.findIndex((line) => line.id === id);
  const line = lines[index];
  if (!line) throw new Error("Выберите строку.");
  const before = lines.slice(0, index).map(lineStart).filter(finiteTime);
  const after = lines
    .slice(index + 1)
    .map(lineStart)
    .filter(finiteTime);
  if (
    before.some((start) => start >= time) ||
    after.some((start) => start <= time)
  )
    throw new Error(
      "Отметка нарушает порядок строк. Перемотайте или исправьте соседние отметки.",
    );
  const { end: _end, words: _words, wordStarts: _starts, ...rest } = line;
  let next = replaceLine(song, {
    ...rest,
    start: time,
    timingReview: false,
    manuallyEdited: true,
    chords: line.chords,
  });
  const previous = lines.find((item) => item.id === previousId);
  if (
    previous &&
    previous.id !== id &&
    finiteTime(previous.start) &&
    previous.start < time
  ) {
    const {
      words: _previousWords,
      wordStarts: _previousStarts,
      ...restPrevious
    } = previous;
    next = replaceLine(next, { ...restPrevious, end: time });
  }
  return next;
}
export function markEnd(song: Song, id: string, time: number): Song {
  const line = allLines(song).find((line) => line.id === id);
  const start = line && lineStart(line);
  if (!line || start === undefined || !finiteTime(time) || time <= start)
    throw new Error("Конец должен быть позже начала строки.");
  const lines = allLines(song),
    index = lines.indexOf(line);
  if (
    lines.slice(index + 1).some((next) => (lineStart(next) ?? Infinity) < time)
  )
    throw new Error("Конец пересекается со следующей строкой.");
  return replaceLine(song, {
    ...line,
    end: time,
    timingReview: false,
    manuallyEdited: true,
  });
}
export function shiftTimings(song: Song, delta: number): Song {
  if (!Number.isFinite(delta)) throw new Error("Укажите сдвиг в секундах.");
  const values = allLines(song)
    .flatMap((line) => [
      line.start,
      line.end,
      ...(line.words?.flatMap((w) => [w.start, w.end]) ?? []),
      ...(line.wordStarts?.flatMap((w) => [w.start, w.end]) ?? []),
      ...line.chords.flatMap((chord) => [chord.start, chord.end]),
    ])
    .filter(finiteTime);
  if (values.some((time) => time + delta < 0))
    throw new Error("Сдвиг уводит отметки раньше начала записи.");
  const shifted = (time: number | undefined) =>
    time === undefined ? undefined : time + delta;
  return {
    ...song,
    sections: song.sections.map((section) => ({
      ...section,
      lines: section.lines.map((line) => ({
        ...line,
        start: shifted(line.start),
        end: shifted(line.end),
        words: line.words?.map((w) => ({
          ...w,
          start: w.start + delta,
          end: w.end + delta,
        })),
        wordStarts: line.wordStarts?.map((w) => ({
          ...w,
          start: w.start + delta,
          ...(w.end === undefined ? {} : { end: w.end + delta }),
        })),
        chords: line.chords.map((c) => ({
          ...c,
          start: shifted(c.start),
          end: shifted(c.end),
        })),
      })),
    })),
  };
}
export function formatTime(value: number) {
  const seconds = Math.max(0, Number.isFinite(value) ? value : 0);
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
/** Used only in explicit text mode. Audio playback never reads this clock. */
export class TextClock {
  private base = 0;
  private anchor = 0;
  running = false;
  rate = 1;
  constructor(private now = () => performance.now()) {}
  position() {
    return (
      this.base +
      (this.running ? ((this.now() - this.anchor) / 1000) * this.rate : 0)
    );
  }
  seek(time: number) {
    this.base = Math.max(0, time);
    this.anchor = this.now();
  }
  pause() {
    this.seek(this.position());
    this.running = false;
  }
  play() {
    if (!this.running) {
      this.anchor = this.now();
      this.running = true;
    }
  }
  setRate(rate: number) {
    this.seek(this.position());
    this.rate = rate;
  }
}
