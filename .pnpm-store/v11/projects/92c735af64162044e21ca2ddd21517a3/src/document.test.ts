import { describe, expect, it } from "vitest";
import { splitLine } from "./document";
import type { Line } from "./model";

function timedLine(text: string, offsets: number[]): Line {
  return {
    id: "original",
    text,
    start: 1,
    words: [{ text, start: 1, end: 4 }],
    chords: offsets.map((offset, index) => ({
      id: `chord-${index}`,
      paletteId: "palette",
      offset,
      source: index % 2 ? "manual" : "model",
      start: 1,
      end: 4,
    })),
  };
}

const anchors = (lines: Line[]) =>
  lines.map((line) => line.chords.map((chord) => [chord.id, chord.offset]));

function freezeDeep(value: object) {
  Object.values(value).forEach((child) => {
    if (child && typeof child === "object") freezeDeep(child);
  });
  Object.freeze(value);
}

describe("splitLine", () => {
  it("shifts insertion-boundary and suffix anchors into subsequent pasted lines", () => {
    const result = splitLine(
      timedLine("ab😀cd", [0, 1, 2, 3, 5]),
      "ab\nX\n😀cd",
    );
    expect(result.map((line) => line.text)).toEqual(["ab", "X", "😀cd"]);
    expect(anchors(result)).toEqual([
      [
        ["chord-0", 0],
        ["chord-1", 1],
      ],
      [],
      [
        ["chord-2", 0],
        ["chord-3", 1],
        ["chord-4", 3],
      ],
    ]);
    expect(result[0].id).toBe("original");
    expect(new Set(result.map((line) => line.id)).size).toBe(3);
    expect(result.slice(1).every((line) => line.id.length > 0)).toBe(true);
  });

  it("clamps anchors in a replaced span and preserves the shifted suffix", () => {
    const result = splitLine(
      timedLine("abcdef", [0, 2, 3, 4, 5, 6]),
      "abX\nYef",
    );
    expect(anchors(result)).toEqual([
      [
        ["chord-0", 0],
        ["chord-1", 2],
        ["chord-2", 2],
      ],
      [
        ["chord-3", 1],
        ["chord-4", 2],
        ["chord-5", 3],
      ],
    ]);
  });

  it("assigns both sides of each newline using code points, including combining marks", () => {
    const text = "😀e\u0301\n\n🎸";
    const result = splitLine(timedLine(text, [6, 3, 4, 5, 0, 5]), text);
    // The unchanged multiline input also exercises anchors immediately before LF.
    // End offset 6 counts code points rather than UTF-16 units.
    expect(anchors(result)).toEqual([
      [
        ["chord-1", 3],
        ["chord-4", 0],
      ],
      [["chord-2", 0]],
      [
        ["chord-0", 1],
        ["chord-3", 0],
        ["chord-5", 0],
      ],
    ]);
  });

  it.each(["\n", "\r\n", "\r"])(
    "preserves leading, consecutive, and trailing %j separators",
    (separator) => {
      const result = splitLine(
        timedLine("ab", [0, 1, 2]),
        `${separator}a${separator}${separator}b${separator}`,
      );
      expect(result.map((line) => line.text)).toEqual(["", "a", "", "b", ""]);
      // editLine treats this as one replacement: removed anchors clamp to zero.
      expect(anchors(result)).toEqual([
        [
          ["chord-0", 0],
          ["chord-1", 0],
        ],
        [],
        [],
        [],
        [["chord-2", 0]],
      ]);
    },
  );

  it("splits empty input lines without dropping the anchor or trailing blank", () => {
    const result = splitLine(timedLine("", [0]), "\n😀\n");
    expect(result.map((line) => line.text)).toEqual(["", "😀", ""]);
    expect(anchors(result)).toEqual([[], [], [["chord-0", 0]]]);
  });

  it("invalidates timing, preserves all occurrence identities and sources, and never mutates input", () => {
    const original = timedLine("a😀b", [3, 0, 1, 2, 1]);
    const snapshot = structuredClone(original);
    freezeDeep(original);
    const result = splitLine(original, "a\n😀b");
    for (const line of result) {
      expect(line).not.toHaveProperty("start");
      expect(line).not.toHaveProperty("words");
      for (const chord of line.chords) {
        const previous = original.chords.find((item) => item.id === chord.id)!;
        expect(chord).toMatchObject({
          id: previous.id,
          paletteId: previous.paletteId,
          source: previous.source,
        });
        expect(chord).not.toBe(previous);
        expect(chord).not.toHaveProperty("start");
        expect(chord).not.toHaveProperty("end");
        expect(chord.offset).toBeGreaterThanOrEqual(0);
        expect(chord.offset).toBeLessThanOrEqual(Array.from(line.text).length);
      }
    }
    expect(result.flatMap((line) => line.chords)).toHaveLength(
      original.chords.length,
    );
    expect(original).toEqual(snapshot);
  });

  it("invalidates timing even when splitting an unchanged multiline document line", () => {
    const result = splitLine(timedLine("a\nb", [1, 2]), "a\nb");
    expect(anchors(result)).toEqual([[["chord-0", 1]], [["chord-1", 0]]]);
    expect(
      result.every((line) => !("start" in line) && !("words" in line)),
    ).toBe(true);
    expect(
      result
        .flatMap((line) => line.chords)
        .every((chord) => !("start" in chord) && !("end" in chord)),
    ).toBe(true);
  });

  it("delegates ordinary edits and preserves identity and timing for a true no-op", () => {
    const original = timedLine("a😀b", [1, 3]);
    expect(splitLine(original, original.text)[0]).toBe(original);
    const [edited] = splitLine(original, "a🎸😀b");
    expect(anchors([edited])).toEqual([
      [
        ["chord-0", 2],
        ["chord-1", 4],
      ],
    ]);
    expect(edited.id).toBe(original.id);
    expect(edited).not.toHaveProperty("start");
    expect(edited).not.toHaveProperty("words");
    expect(edited.chords[0]).not.toHaveProperty("start");
  });
});
