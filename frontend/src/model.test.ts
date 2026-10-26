import { describe, expect, it } from "vitest";
import { createSong, editLine, id, normalizeChord } from "./model";
import type { Line, Occurrence, Song } from "./model";

function line(text: string, offsets: number[]): Line {
  return {
    id: "line",
    text,
    chords: offsets.map(
      (offset, index): Occurrence => ({
        id: `chord-${index}`,
        paletteId: "am",
        offset,
        source: "manual",
      }),
    ),
  };
}

const offsets = (value: Line) => value.chords.map((chord) => chord.offset);

describe("normalizeChord", () => {
  it.each([
    [" C ", "C"],
    ["am", "Am"],
    ["c♯m7/g♭", "C#m7/Gb"],
    ["B♭maj7/D", "Bbmaj7/D"],
    ["F#sus4", "F#sus4"],
    ["G7sus4", "G7sus4"],
    ["Bm7b5", "Bm7b5"],
    ["Cadd9", "Cadd9"],
    ["Edim7", "Edim7"],
    ["Aaug", "Aaug"],
    ["Dm9", "Dm9"],
    ["C7#9", "C7#9"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeChord(input)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "H",
    "C##",
    "Cbb",
    "C8",
    "Cfoo",
    "C/E/G",
    "C/",
    "/E",
    "C/Em",
    "C major",
    "Am\nG",
    "До",
    "<C>",
  ])("rejects %j", (input) => {
    expect(normalizeChord(input)).toBeNull();
  });
});

describe("editLine", () => {
  it("shifts insertion anchors right, including the insertion boundary", () => {
    expect(offsets(editLine(line("abcd", [0, 1, 2, 4]), "abXYcd"))).toEqual([
      0, 1, 4, 6,
    ]);
  });

  it("supports insertion at both ends and into an empty line", () => {
    expect(offsets(editLine(line("ab", [0, 2]), "Xab"))).toEqual([1, 3]);
    expect(offsets(editLine(line("ab", [0, 2]), "abX"))).toEqual([0, 3]);
    expect(offsets(editLine(line("", [0]), "😀"))).toEqual([1]);
  });

  it("clamps deleted anchors to the start and shifts the suffix", () => {
    expect(
      offsets(editLine(line("abcdef", [0, 1, 2, 3, 4, 5, 6]), "abef")),
    ).toEqual([0, 1, 2, 2, 2, 3, 4]);
  });

  it("clamps replacement anchors to its start", () => {
    expect(
      offsets(editLine(line("abcdef", [1, 2, 3, 4, 6]), "abXYZef")),
    ).toEqual([1, 2, 2, 5, 7]);
    expect(offsets(editLine(line("abc", [0, 1, 3]), ""))).toEqual([0, 0, 0]);
  });

  it("counts astral characters as one code point during insertion and deletion", () => {
    expect(offsets(editLine(line("а😀б", [0, 1, 2, 3]), "а🎸😀б"))).toEqual([
      0, 2, 3, 4,
    ]);
    expect(offsets(editLine(line("а😀б", [0, 1, 2, 3]), "аб"))).toEqual([
      0, 1, 1, 2,
    ]);
  });

  it("does not mistake shared UTF-16 surrogates for a common prefix", () => {
    expect(offsets(editLine(line("😀z", [0, 1, 2]), "😁z"))).toEqual([0, 1, 2]);
  });

  it("counts combining marks separately from their base character", () => {
    expect(
      offsets(editLine(line("e\u0301x", [0, 1, 2, 3]), "e\u0301😀x")),
    ).toEqual([0, 1, 3, 4]);
  });

  it("invalidates timing without mutating the original or losing chord identity/source", () => {
    const original: Line = {
      ...line("abc", [1]),
      start: 2,
      words: [{ text: "abc", start: 2, end: 3 }],
    };
    original.chords[0] = {
      ...original.chords[0],
      source: "model",
      start: 2,
      end: 3,
    };
    const snapshot = JSON.parse(JSON.stringify(original));
    const edited = editLine(original, "aXbc");
    expect(edited).not.toHaveProperty("start");
    expect(edited).not.toHaveProperty("words");
    expect(edited.chords[0]).toEqual({
      id: "chord-0",
      paletteId: "am",
      offset: 2,
      source: "model",
    });
    expect(original).toEqual(snapshot);
  });

  it("preserves timing when text has not changed", () => {
    const original = { ...line("abc", [1]), start: 2 };
    expect(editLine(original, "abc")).toBe(original);
  });
});

describe("song schema", () => {
  it("creates a fresh, serializable version-one song", () => {
    const song: Song = createSong();
    expect(song).toMatchObject({
      schemaVersion: 1,
      title: "Новая песня",
      artist: "",
      language: "ru",
      palette: [],
      audio: null,
      source: "manual",
      performance: { fontSize: 24, bpm: 90, beats: 4 },
    });
    expect(song.sections[0].lines[0]).toMatchObject({ text: "", chords: [] });
    expect(new Date(song.updatedAt).toISOString()).toBe(song.updatedAt);
    expect(JSON.parse(JSON.stringify(song))).toEqual(song);
    expect(createSong().id).not.toBe(song.id);
  });

  it("creates a Russian demo with valid palette references and unique ids", () => {
    const song = createSong(true);
    const ids = [song.id, ...song.palette.map((chord) => chord.id)];
    expect(song.language).toBe("ru");
    expect(song.palette.length).toBeGreaterThan(0);
    for (const chord of song.palette)
      expect(normalizeChord(chord.name)).toBe(chord.name);
    for (const section of song.sections) {
      ids.push(section.id);
      for (const entry of section.lines) {
        ids.push(entry.id);
        expect(entry.text).toMatch(/[а-яё]/i);
        for (const chord of entry.chords) {
          ids.push(chord.id);
          expect(song.palette.some((item) => item.id === chord.paletteId)).toBe(
            true,
          );
          expect(chord.offset).toBeGreaterThanOrEqual(0);
          expect(chord.offset).toBeLessThanOrEqual(
            Array.from(entry.text).length,
          );
        }
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("generates nonempty unique ids", () => {
    const ids = Array.from({ length: 100 }, () => id());
    expect(
      ids.every((value) => typeof value === "string" && value.length > 0),
    ).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
