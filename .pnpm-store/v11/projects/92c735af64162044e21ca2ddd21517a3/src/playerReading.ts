import type { Line, Song } from "./model";
import { validWords, validWordStarts } from "./timeline";
import { finiteTime, lineStart } from "./playerTiming";
import { linePresentation } from "./songPresentation";

/** A following row or track duration is a navigation boundary, never a vocal end. */
export function vocalEnd(line: Line): number | undefined {
  if (line.timingReview) return;
  const end =
    (validWords(line) ? line.words?.at(-1)?.end : undefined) ??
    (validWordStarts(line) ? line.wordStarts?.at(-1)?.end : undefined) ??
    line.end;
  return finiteTime(end) && end > (lineStart(line) ?? Infinity)
    ? end
    : undefined;
}
export function readingRows(song: Song) {
  return song.sections.flatMap((section) =>
    section.lines.map((line) => ({
      line,
      section,
      kind: linePresentation(line).kind,
      recordingEnd: song.audio?.duration,
    })),
  );
}
export function readingState(
  rows: ReturnType<typeof readingRows>,
  time: number,
) {
  const vocals = rows.filter((row) => row.kind === "vocal");
  const begun = vocals.filter(
    (row) => (lineStart(row.line) ?? Infinity) <= time,
  );
  const current = begun.reduce<(typeof vocals)[number] | undefined>(
    (last, row) =>
      !last || lineStart(row.line)! >= lineStart(last.line)! ? row : last,
    undefined,
  );
  const next = current ? vocals[vocals.indexOf(current) + 1] : vocals[0];
  const afterNext = next ? vocals[vocals.indexOf(next) + 1] : undefined;
  const before = current ? rows.indexOf(current) : -1;
  const after = next ? rows.indexOf(next) : rows.length;
  const between = rows
    .slice(before + 1, after)
    .filter((row) => row.kind === "instrumental");
  const sourceEnd = current && vocalEnd(current.line);
  // Legacy maps sometimes saved the file boundary as the last vocal end.
  // A separately written, untimed outro makes that boundary ambiguous. Do not
  // invent an earlier end, or overwrite the user's saved value.
  const endNeedsReview =
    !!current &&
    !next &&
    between.length > 0 &&
    sourceEnd !== undefined &&
    current.recordingEnd !== undefined &&
    Math.abs(sourceEnd - current.recordingEnd) < 0.05 &&
    !validWords(current.line) &&
    !(
      validWordStarts(current.line) &&
      finiteTime(current.line.wordStarts?.at(-1)?.end)
    );
  const end = endNeedsReview ? undefined : sourceEnd;
  const active =
    current && end !== undefined && time < end ? current : undefined;
  // In a gap, keep its instrumental group stable until the next real entry.
  const instrument = !active ? between : [];
  const section =
    active?.section ??
    (current && end === undefined ? current.section : undefined) ??
    instrument[0]?.section ??
    current?.section ??
    next?.section;
  const strum =
    section &&
    (section.lines.find((line) => linePresentation(line).kind === "strum") ??
      [
        ...rows.slice(
          0,
          Math.max(
            0,
            rows.findIndex((row) => row.section === section),
          ) + 1,
        ),
      ]
        .reverse()
        .find((row) => row.kind === "strum")?.line);
  const nextStart = next && lineStart(next.line);
  return {
    activeId: active?.line.id ?? null,
    current,
    next,
    afterNext,
    section,
    strum,
    instrument,
    endNeedsReview,
    instrumentPreview: !!current && end === undefined,
    phase: active
      ? "vocal"
      : current && end === undefined
        ? "uncertain"
        : "instrumental",
    // Unknown phrase endings keep their context without pretending it is singing.
    focusId:
      active?.line.id ??
      (current && end === undefined ? current.line.id : next?.line.id) ??
      current?.line.id ??
      instrument[0]?.line.id ??
      null,
    countdown:
      !active && nextStart !== undefined && nextStart > time
        ? nextStart - time
        : undefined,
  };
}

/** No implicit equal duration or repetition expansion. Only real occurrence bounds. */
export function chordIntervals(line: Line) {
  if (line.timingReview) return [];
  const chords = [...line.chords].sort((a, b) => a.offset - b.offset);
  return chords.flatMap((chord, i) => {
    const end = chord.end ?? chords[i + 1]?.start ?? line.end;
    return finiteTime(chord.start) && finiteTime(end) && end > chord.start
      ? [{ id: chord.id, start: chord.start, end }]
      : [];
  });
}
