import { describe, expect, it } from "vitest";
import { parseLyricsfile } from "./lyricsfile";
import { applyLrc, matchLrc } from "./lrc";
import { createSong } from "./model";
import { validWords } from "./timeline";
import { playerMap } from "./playerTiming";

const file = (lines: unknown[], metadata: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: "1.0",
    metadata: { title: "Song", artist: "Artist", ...metadata },
    lines,
  });
const line = {
  text: "Hello world",
  start_ms: 1000,
  end_ms: 4000,
  words: [
    { text: "Hello ", start_ms: 1200, end_ms: 2000 },
    { text: "world", start_ms: 2500, end_ms: 3500 },
  ],
};
function songWith(...texts: string[]) {
  const song = createSong();
  song.sections[0].lines = texts.map((text, i) => ({
    id: "line-" + i,
    text,
    chords: [],
  }));
  return song;
}

describe("Lyricsfile 1.0 adapter", () => {
  it("parses actual YAML and source line numbers without treating metadata/plain as lyrics", () => {
    const parsed = parseLyricsfile(
      "version: '1.0'\nmetadata:\n  title: Example\n  artist: Someone\nplain: |\n  Different text\nlines:\n  - text: Hello world\n    start_ms: 1200\n    end_ms: 3500\n    words:\n      - {text: 'Hello ', start_ms: 1200, end_ms: 2000}\n      - {text: world, start_ms: 2200, end_ms: 3500}\n",
    );
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        time: 1.2,
        end: 3.5,
        text: "Hello world",
        sourceLine: 8,
        endPolicy: "explicit",
        words: [
          { text: "Hello", start: 1.2, end: 2 },
          { text: "world", start: 2.2, end: 3.5 },
        ],
      },
    ]);
  });

  it("aggregates timed syllables and separate whitespace into complete existing tokens", () => {
    const parsed = parseLyricsfile(
      file([
        {
          ...line,
          words: [
            { text: "Hel", start_ms: 1000, end_ms: 1300 },
            { text: "lo", start_ms: 1400, end_ms: 1800 },
            { text: " ", start_ms: 1800, end_ms: 1900 },
            { text: "world", start_ms: 2500, end_ms: 3500 },
          ],
        },
      ]),
    );
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows[0].words).toEqual([
      { text: "Hello", start: 1, end: 1.8 },
      { text: "world", start: 2.5, end: 3.5 },
    ]);
    const song = songWith("HELLO, world!");
    const result = applyLrc(song, matchLrc(song, parsed.rows), 10);
    expect(validWords(result.sections[0].lines[0])).toBe(true);
    expect(result.sections[0].lines[0].words?.map((word) => word.text)).toEqual(
      ["HELLO,", "world!"],
    );
  });

  it("uses explicit words to split or merge document lines without changing their IDs/text", () => {
    const parsed = parseLyricsfile(file([line]));
    const song = songWith("Hello", "world");
    const matches = matchLrc(song, parsed.rows);
    expect(matches[0].targets?.map((target) => target.lineId)).toEqual([
      "line-0",
      "line-1",
    ]);
    const result = applyLrc(song, matches, 10);
    expect(
      result.sections[0].lines.map((item) => [
        item.id,
        item.text,
        item.start,
        item.end,
      ]),
    ).toEqual([
      ["line-0", "Hello", 1, 2.5],
      ["line-1", "world", 2.5, 4],
    ]);
    expect(result.sections[0].lines.every(validWords)).toBe(true);

    const merged = parseLyricsfile(
      file([
        {
          text: "Hello ",
          start_ms: 1000,
          end_ms: 2000,
          words: [{ text: "Hello ", start_ms: 1000, end_ms: 1800 }],
        },
        {
          text: "world",
          start_ms: 2500,
          end_ms: 4000,
          words: [{ text: "world", start_ms: 2500, end_ms: 3500 }],
        },
      ]),
    );
    const single = songWith("Hello world");
    expect(
      validWords(
        applyLrc(single, matchLrc(single, merged.rows), 10).sections[0]
          .lines[0],
      ),
    ).toBe(true);
  });

  it.each(
    [
      [
        { text: "Hello ", end_ms: 2000 },
        { text: "world", start_ms: 2500, end_ms: 3500 },
      ],
      [
        { text: "Wrong ", start_ms: 1000, end_ms: 2000 },
        { text: "world", start_ms: 2500, end_ms: 3500 },
      ],
      [{ text: "Hello world", start_ms: 1000, end_ms: 3500 }],
      [
        { text: "Hello ", start_ms: 1000, end_ms: 3000 },
        { text: "world", start_ms: 2500, end_ms: 3500 },
      ],
      [
        { text: "Hello ", start_ms: 500, end_ms: 1500 },
        { text: "world", start_ms: 2500, end_ms: 3500 },
      ],
      [
        { text: "Hello ", start_ms: 1000, end_ms: 1000 },
        { text: "world", start_ms: 2500, end_ms: 3500 },
      ],
      [
        { text: "Hello ", start_ms: 1000, end_ms: 2000 },
        { text: "world", start_ms: 2500, end_ms: 4500 },
      ],
    ].map((words) => ({ words })),
  )(
    "falls back to line-only timing for incomplete or unsupported segments",
    ({ words }) => {
      const parsed = parseLyricsfile(file([{ ...line, words }]));
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.warnings.length).toBeGreaterThan(0);
      expect(parsed.rows[0].words).toBeUndefined();
      expect(parsed.rows[0].wordStarts).toBeUndefined();
      const song = songWith("Hello world");
      const result = applyLrc(song, matchLrc(song, parsed.rows), 10);
      expect(result.sections[0].lines[0]).toMatchObject({ start: 1, end: 4 });
      expect(result.sections[0].lines[0].words).toBeUndefined();
    },
  );

  it("preserves actual word starts without inventing source ends", () => {
    const parsed = parseLyricsfile(
      file([
        {
          ...line,
          words: [
            { text: "Hello ", start_ms: 1200 },
            { text: "world", start_ms: 2500 },
          ],
        },
      ]),
    );
    expect(parsed.rows[0].words).toBeUndefined();
    expect(parsed.rows[0].wordStarts).toEqual([
      { text: "Hello", start: 1.2 },
      { text: "world", start: 2.5 },
    ]);
    const song = songWith("Hello world");
    const result = applyLrc(song, matchLrc(song, parsed.rows), 10).sections[0]
      .lines[0];
    expect(result.words).toBeUndefined();
    expect(result.wordStarts).toEqual(parsed.rows[0].wordStarts);
  });

  it("never invents a line or word end using a neighbor or track duration", () => {
    const parsed = parseLyricsfile(
      file([
        {
          text: "Hello world",
          start_ms: 1000,
          words: [{ text: "Hello world", start_ms: 1000 }],
        },
        { text: "Next verse", start_ms: 5000 },
      ]),
    );
    expect(
      parsed.rows.every(
        (row) => row.end === undefined && row.words === undefined,
      ),
    ).toBe(true);
    const song = songWith("Hello world", "Next verse");
    const result = applyLrc(song, matchLrc(song, parsed.rows), 10);
    expect(
      result.sections[0].lines.map((item) => [
        item.start,
        item.end,
        item.words,
      ]),
    ).toEqual([
      [1, undefined, undefined],
      [5, undefined, undefined],
    ]);
  });

  it("can use the real final word end if the line end is absent", () => {
    const { end_ms: _end, ...withoutEnd } = line;
    const parsed = parseLyricsfile(file([withoutEnd]));
    expect(parsed.rows[0].end).toBeUndefined();
    expect(parsed.rows[0].words?.at(-1)?.end).toBe(3.5);
    const song = songWith(line.text);
    const result = applyLrc(song, matchLrc(song, parsed.rows), 10);
    expect(result.sections[0].lines[0].end).toBe(3.5);
    expect(validWords(result.sections[0].lines[0])).toBe(true);
  });

  it.each(
    [
      [
        { text: "First voice", start_ms: 1000, end_ms: 4000 },
        { text: "Second voice", start_ms: 3000, end_ms: 5000 },
      ],
      [
        { text: "First voice", start_ms: 1000 },
        { text: "Second voice", start_ms: 1000 },
      ],
      [
        {
          text: "First voice",
          start_ms: 1000,
          words: [
            { text: "First ", start_ms: 1000, end_ms: 2000 },
            { text: "voice", start_ms: 2000, end_ms: 4000 },
          ],
        },
        { text: "Second voice", start_ms: 3000 },
      ],
    ].map((lines) => ({ lines })),
  )(
    "keeps overlapping/simultaneous voices in review without importing them",
    ({ lines }) => {
      const parsed = parseLyricsfile(file(lines));
      expect(parsed.rows).toHaveLength(2);
      const song = songWith("First voice", "Second voice");
      expect(parsed.rows.every((row) => row.reviewReason)).toBe(true);
      const matches = matchLrc(song, parsed.rows);
      expect(
        matches.every((row) => row.status === "review" && !row.lineId),
      ).toBe(true);
      expect(applyLrc(song, matches, 10)).toBe(song);
      expect(playerMap(song, 10)).toEqual([]);
    },
  );

  it("sorts rows chronologically, keeps actual source positions and never exports an undefined start", () => {
    const parsed = parseLyricsfile(
      file([
        { text: "Later verse", start_ms: 2000 },
        { text: "No start" },
        { text: "First verse", start_ms: 0 },
      ]),
    );
    expect(parsed.rows.map((row) => [row.time, row.text])).toEqual([
      [0, "First verse"],
      [2, "Later verse"],
    ]);
    expect(
      parsed.warnings.some((warning) => warning.includes("start_ms")),
    ).toBe(true);
  });

  it.each([undefined, null, -1, 1.5, "1000", Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid line starts: %j",
    (start_ms) => {
      const parsed = parseLyricsfile(
        file([{ text: "Invalid timing", start_ms }]),
      );
      expect(parsed.rows).toEqual([]);
      expect(parsed.warnings.length).toBeGreaterThan(0);
    },
  );

  it.each([1000, 500, "4000", null])(
    "keeps invalid/zero-length line ends in review: %j",
    (end_ms) => {
      const parsed = parseLyricsfile(
        file([{ text: "Hello world", start_ms: 1000, end_ms }]),
      );
      const song = songWith("Hello world");
      expect(matchLrc(song, parsed.rows)[0].status).toBe("review");
      expect(applyLrc(song, matchLrc(song, parsed.rows), 10)).toBe(song);
    },
  );
});

describe("Lyricsfile YAML validation and resource limits", () => {
  it.each([
    "version: '1.0'\nversion: '1.0'\nmetadata: {title: Song, artist: Artist}",
    "version: '1.0'\nmetadata: {title: Song, title: Other, artist: Artist}",
    "version: '1.0'\nmetadata: {title: &name Song, artist: *name}",
    "version: '1.0'\nmetadata: {title: &name Song, artist: Artist}",
    "version: '1.0'\nmetadata: {title: !custom Song, artist: Artist}",
    "version: '1.0'\nmetadata: {title: !!timestamp 2026-01-01, artist: Artist}",
    "version: '1.0'\nmetadata: {title: Song, artist: Artist}\n---\nversion: '1.0'",
    "version: '1.0'\nmetadata: {title: Song, artist: Artist}\nextra: .inf",
    "version: '1.0'\nmetadata: {title: Song, artist: Artist}\nextra: 1.5",
    "version: [",
  ])("rejects unsafe, duplicate or unsupported YAML", (source) => {
    const result = parseLyricsfile(source);
    expect(result.rows).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it.each([1, 1.0, "1.1", "2.0", null])(
    "requires exact string version 1.0: %j",
    (version) => {
      const result = parseLyricsfile(
        JSON.stringify({
          version,
          metadata: { title: "Song", artist: "Artist" },
          lines: [line],
        }),
      );
      expect(result.rows).toEqual([]);
      expect(result.warnings[0]).toContain("version");
    },
  );

  it("rejects nonzero draft offsets, rather than silently shifting or ignoring them", () => {
    expect(parseLyricsfile(file([line], { offset_ms: 100 })).rows).toEqual([]);
    expect(parseLyricsfile(file([line], { offset_ms: -100 })).rows).toEqual([]);
    expect(parseLyricsfile(file([line], { offset_ms: 0 })).rows[0].time).toBe(
      1,
    );
  });

  it("does not turn instrumental or plain-only records into synchronized rows", () => {
    expect(parseLyricsfile(file([], { instrumental: true })).rows).toEqual([]);
    expect(parseLyricsfile(file([line], { instrumental: true })).rows).toEqual(
      [],
    );
    expect(
      parseLyricsfile(
        "version: '1.0'\nmetadata: {title: Song, artist: Artist}\nplain: Hello",
      ).rows,
    ).toEqual([]);
  });

  it("limits UTF-8 byte size, nesting, line count and total word segments", () => {
    expect(parseLyricsfile("я".repeat(524289)).warnings[0]).toContain("1 MiB");
    const nested =
      "version: '1.0'\nmetadata: {title: Song, artist: Artist}\nextra: " +
      "[".repeat(40) +
      "0" +
      "]".repeat(40);
    expect(parseLyricsfile(nested).warnings[0]).toContain("глубина");
    expect(
      parseLyricsfile(
        file(
          Array.from({ length: 2001 }, () => ({
            text: line.text,
            start_ms: 1000,
          })),
        ),
      ).warnings[0],
    ).toContain("2000 строк");
    const manyWords = Array.from({ length: 2001 }, (_, i) => ({
      text: "a ",
      start_ms: i * 2,
      end_ms: i * 2 + 1,
    }));
    expect(
      parseLyricsfile(
        file([
          {
            text: manyWords.map((word) => word.text).join(""),
            start_ms: 0,
            words: manyWords,
          },
        ]),
      ).warnings[0],
    ).toContain("2000 слов");
    expect(
      parseLyricsfile(
        file([
          { text: "x", start_ms: 0, words: manyWords.slice(0, 1001) },
          { text: "y", start_ms: 10000, words: manyWords.slice(0, 1001) },
        ]),
      ).warnings[0],
    ).toContain("2000 слов");
  });

  it("accepts exactly 2000 segments and 2000 lines at their respective limits", () => {
    const words = Array.from({ length: 2000 }, (_, i) => ({
      text: "a ",
      start_ms: i * 2,
      end_ms: i * 2 + 1,
    }));
    const result = parseLyricsfile(
      file([
        {
          text: words.map((word) => word.text).join(""),
          start_ms: 0,
          end_ms: 4000,
          words,
        },
      ]),
    );
    expect(result.rows[0].words).toHaveLength(2000);
    expect(result.warnings).toEqual([]);
    const lines = Array.from({ length: 2000 }, (_, i) => ({
      text: "Verse " + i,
      start_ms: i * 2,
      end_ms: i * 2 + 1,
    }));
    expect(parseLyricsfile(file(lines)).rows).toHaveLength(2000);
  });

  it.each([
    { version: "1.0", lines: [line] },
    { version: "1.0", metadata: { title: "Song", artist: 3 }, lines: [line] },
    {
      version: "1.0",
      metadata: { title: "Song", artist: "Artist", duration_ms: -1 },
      lines: [line],
    },
    {
      version: "1.0",
      metadata: { title: "Song", artist: "Artist", instrumental: "true" },
      lines: [line],
    },
    {
      version: "1.0",
      metadata: { title: "Song", artist: "Artist" },
      lines: "text",
    },
  ])("rejects malformed top-level structures", (value) => {
    expect(parseLyricsfile(JSON.stringify(value)).rows).toEqual([]);
  });
});
