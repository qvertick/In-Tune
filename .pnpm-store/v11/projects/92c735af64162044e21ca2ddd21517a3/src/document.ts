import { editLine, id, type Line } from "./model";

/**
 * Apply one text replacement, then turn pasted newlines into document lines.
 * Offsets count Unicode code points. An anchor before a newline belongs to
 * the preceding line's end; an anchor after it belongs to the next line.
 * CRLF and bare CR are normalized before applying editLine's anchor policy.
 * The first line retains its identity; every additional line gets a fresh id.
 * Text edits and structural splits invalidate line, word, and chord timing.
 */
export function splitLine(line: Line, newText: string): Line[] {
  const edited = editLine(line, newText.replace(/\r\n?/g, "\n"));
  const texts = edited.text.split("\n");
  if (texts.length === 1) return [edited];

  const { start: _start, words: _words, ...untimed } = edited;
  let nextStart = 0;
  const starts: number[] = [];
  const lines: Line[] = texts.map((text, index) => {
    starts.push(nextStart);
    nextStart += Array.from(text).length + 1;
    return { ...untimed, id: index === 0 ? line.id : id(), text, chords: [] };
  });

  for (const {
    start: _chordStart,
    end: _chordEnd,
    ...chord
  } of edited.chords) {
    // Find the last line whose start is at or before the adjusted anchor.
    // Do not assume chords arrive sorted by offset (moves can reorder them).
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (starts[middle] <= chord.offset) low = middle;
      else high = middle;
    }
    lines[low].chords.push({ ...chord, offset: chord.offset - starts[low] });
  }
  return lines;
}
