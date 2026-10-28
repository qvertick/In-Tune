import { describe, expect, it } from "vitest";
import { createSong } from "./model";
import { applyLrc, matchLrc, parseLrc } from "./lrc";
import { validWords } from "./timeline";
import { playerMap } from "./playerTiming";

function songWith(...texts: string[]) {
  const song = createSong();
  song.sections[0].lines = texts.map((text, index) => ({
    id: "line-" + index,
    text,
    chords: [],
  }));
  return song;
}
const preview = (song: ReturnType<typeof songWith>, text: string) =>
  matchLrc(song, parseLrc(text).rows);

describe("conservative LRC alignment", () => {
  it("normalizes case, punctuation, ё/е and Unicode without replacing document text", () => {
    const song = songWith("ЁЖИК — здесь!", "We're well-known.");
    const before = structuredClone(song);
    const result = applyLrc(
      song,
      preview(song, "[00:01]ежик здесь\n[00:03]WE’RE WELL KNOWN\n[00:05]"),
      8,
    );
    expect(result.sections[0].lines.map((line) => line.text)).toEqual([
      "ЁЖИК — здесь!",
      "We're well-known.",
    ]);
    expect(result.sections[0].lines.map((line) => line.start)).toEqual([1, 3]);
    expect(song).toEqual(before);
  });

  it.each(["\n", "\r\n", "\r"])(
    "accepts BOM, comments and metadata with %j newlines",
    (newline) => {
      const parsed = parseLrc(
        [
          "\uFEFF[au:Writer]",
          "[la:ru]",
          "# comment",
          "[00:01]First",
          "[00:02]Second",
        ].join(newline),
      );
      expect(parsed.warnings).toEqual([]);
      expect(parsed.rows.map((row) => row.sourceLine)).toEqual([4, 5]);
    },
  );

  it.each([
    "[00:01][00:08]Sing again\n[00:04]Different verse",
    "[00:01]Sing again\n[00:04]Different verse\n[00:08]Sing again",
  ])("assigns chronological chorus occurrences once each", (text) => {
    const song = songWith("Sing again", "Different verse", "Sing again");
    expect(preview(song, text).map((row) => row.lineId)).toEqual([
      "line-0",
      "line-1",
      "line-2",
    ]);
    expect(
      applyLrc(song, preview(song, text), 12).sections[0].lines.map(
        (line) => line.start,
      ),
    ).toEqual([1, 4, 8]);
  });

  it("refuses to choose an occurrence for a partial ambiguous chorus", () => {
    const song = songWith("Sing again", "Different verse", "Sing again");
    const matches = preview(song, "[00:08]Sing again");
    expect(matches[0]).toMatchObject({ status: "review" });
    expect(matches[0].lineId).toBeUndefined();
    expect(matches[0].targets).toBeUndefined();
    expect(applyLrc(song, matches, 20)).toBe(song);
  });

  it("uses context to resolve a chorus instead of taking the first text hit", () => {
    const song = songWith(
      "Sing again",
      "Different verse",
      "Sing again",
      "The ending",
    );
    expect(
      preview(
        song,
        "[00:04]Different verse\n[00:08]Sing again\n[00:10]The ending",
      ).map((row) => row.lineId),
    ).toEqual(["line-1", "line-2", "line-3"]);
  });

  it("merges complete consecutive source rows into one existing line", () => {
    const song = songWith("Hello, beautiful world!", "The ending");
    const matches = preview(
      song,
      "[00:01]Hello beautiful\n[00:03]world\n[00:06]The ending",
    );
    expect(matches.map((row) => row.lineId)).toEqual([
      "line-0",
      "line-0",
      "line-1",
    ]);
    expect(matches[0].targets).toEqual([
      { lineId: "line-0", start: 1, end: 6 },
    ]);
    expect(applyLrc(song, matches, 10).sections[0].lines[0]).toMatchObject({
      text: "Hello, beautiful world!",
      start: 1,
      end: 6,
      timingReview: false,
    });
    matches[1].lineId = undefined;
    expect(applyLrc(song, matches, 10).sections[0].lines[0]).toBe(
      song.sections[0].lines[0],
    );
  });

  it("does not merge a partial row or bridge an instrumental boundary", () => {
    const song = songWith("Hello beautiful world");
    for (const source of [
      "[00:01]Hello beautiful",
      "[00:01]Hello\n[00:02][Instrumental]\n[00:03]beautiful world",
    ])
      expect(preview(song, source).every((row) => !row.lineId)).toBe(true);
  });

  it("splits a fully matched enhanced line using actual word starts", () => {
    const song = songWith("Hello, beautiful", "WORLD!");
    const matches = preview(
      song,
      "[00:01]<00:01>Hello <00:02>beautiful <00:04>world<00:06>",
    );
    expect(
      matches[0].targets?.map((target) => [
        target.lineId,
        target.start,
        target.end,
      ]),
    ).toEqual([
      ["line-0", 1, 4],
      ["line-1", 4, 6],
    ]);
    const result = applyLrc(song, matches, 10);
    expect(result.sections[0].lines.every(validWords)).toBe(true);
    expect(result.sections[0].lines[0].words?.map((word) => word.text)).toEqual(
      ["Hello,", "beautiful"],
    );
    expect(result.sections[0].lines[1].words).toEqual([
      { text: "WORLD!", start: 4, end: 6 },
    ]);
  });

  it("reviews plain LRC splits rather than distributing time over characters", () => {
    const song = songWith("Hello beautiful", "world");
    const matches = preview(song, "[00:01]Hello beautiful world\n[00:06]");
    expect(matches[0]).toMatchObject({ status: "review" });
    expect(matches[0].lineId).toBeUndefined();
    expect(applyLrc(song, matches, 10)).toBe(song);
  });

  it("keeps ignored document rows untouched and respects source gap boundaries", () => {
    const song = songWith(
      "Бой: ↓ ↓↑ ↑↓↑",
      "Am | F C G",
      "Hello world",
      "[Instrumental]",
      "Бой за нами",
    );
    song.sections[0].lines[0].start = 0;
    const matches = preview(
      song,
      "[00:00]Бой: ↓ ↓↑ ↑↓↑\n[00:01]Hello world\n[00:03][Instrumental]\n[00:05]Бой за нами\n[00:07]",
    );
    expect(matches.map((row) => row.status)).toEqual([
      "ignored",
      "matched",
      "ignored",
      "matched",
      "ignored",
    ]);
    const result = applyLrc(song, matches, 10);
    expect(result.sections[0].lines[0]).toBe(song.sections[0].lines[0]);
    expect(result.sections[0].lines[2].end).toBe(3);
    expect(result.sections[0].lines[3]).toBe(song.sections[0].lines[3]);
  });

  it("preserves manual data and word-only neighbor anchors across sections", () => {
    const song = createSong(true);
    const line = song.sections[0].lines[0],
      retained = song.sections[0].lines[1];
    song.sections.push({
      id: "other-section",
      name: "Keep",
      lines: [retained],
    });
    song.sections[0].lines = [line];
    retained.words = retained.text
      .split(/\s+/u)
      .map((text, i) => ({ text, start: 3 + i, end: 4 + i }));
    const before = structuredClone(song);
    const result = applyLrc(song, preview(song, "[00:02]" + line.text), 20);
    expect(result.sections[0].lines[0].timingReview).toBe(true);
    expect(result.sections[0].lines[0].chords).toBe(line.chords);
    expect(result.sections[1].lines[0]).toBe(retained);
    expect(result.palette).toBe(song.palette);
    expect(song).toEqual(before);
  });

  it("revalidates a stale preview, and leaves unmatched manual timing unchanged", () => {
    const song = songWith("Hello world", "Keep this");
    const matches = preview(song, "[00:01]Hello world");
    song.sections[0].lines[0].text = "Edited manually";
    song.sections[0].lines[1].start = 8;
    song.sections[0].lines[1].end = 10;
    expect(applyLrc(song, matches, 12)).toBe(song);
  });

  it("marks times outside the audio for review instead of enabling player playback", () => {
    const song = songWith("Hello world");
    const result = applyLrc(
      song,
      preview(song, "[00:20]Hello world\n[00:25]"),
      10,
    );
    expect(result.sections[0].lines[0].timingReview).toBe(true);
    expect(playerMap(result, 10)).toEqual([]);
  });

  it("refuses oversized alignment before allocating a quadratic table", () => {
    const song = songWith(
      ...Array.from({ length: 1500 }, (_, i) => "Lyric " + i),
    );
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      time: i,
      text: "Lyric " + i,
      sourceLine: i + 1,
    }));
    expect(
      matchLrc(song, rows).every(
        (row) => row.status === "review" && !row.lineId,
      ),
    ).toBe(true);
  });
});

describe("enhanced LRC word intervals", () => {
  it("reads explicit terminal tags, offsets, fractions and repeated timed lines", () => {
    const parsed = parseLrc(
      "[00:01][00:11]<00:01.2>Hel<00:01.4>lo <00:02>world<00:03>\n[offset:+500]",
    );
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      time: 1.5,
      text: "Hello world",
      end: 3.5,
      words: [
        { text: "Hello", start: 1.7, end: 2.5 },
        { text: "world", start: 2.5, end: 3.5 },
      ],
    });
    expect(parsed.rows[1].words).toEqual([
      { text: "Hello", start: 11.7, end: 12.5 },
      { text: "world", start: 12.5, end: 13.5 },
    ]);
  });

  it("never fills a missing final word end from a next line or duration", () => {
    const song = songWith("Hello world", "The ending");
    const parsed = parseLrc(
      "[00:01]<00:01>Hello <00:02>world\n[00:05]The ending",
    );
    expect(parsed.rows[0].words).toBeUndefined();
    expect(parsed.rows[0].wordStarts).toHaveLength(2);
    const result = applyLrc(song, matchLrc(song, parsed.rows), 10);
    expect(result.sections[0].lines[0]).toMatchObject({ start: 1, end: 5 });
    expect(result.sections[0].lines[0].words).toBeUndefined();
  });

  it("can split using real starts while leaving the incomplete final line word-free", () => {
    const song = songWith("Hello beautiful", "world");
    const result = applyLrc(
      song,
      preview(song, "[00:01]<00:01>Hello <00:02>beautiful <00:04>world"),
      10,
    );
    expect(result.sections[0].lines.map((line) => line.start)).toEqual([1, 4]);
    expect(validWords(result.sections[0].lines[0])).toBe(true);
    expect(result.sections[0].lines[1].words).toBeUndefined();
  });

  it.each([
    "[00:01]<00:01>Hello world<00:04>",
    "[00:01]<00:02>Hello <00:01>world<00:04>",
    "[00:01]<00:01>Hello <00:60>world<00:04>",
    "[00:01]<00:01>Hello <00:01>world<00:04>",
  ])("keeps invalid or incomplete word timing line-only: %s", (source) => {
    const parsed = parseLrc(source),
      song = songWith("Hello world");
    expect(parsed.warnings).not.toEqual([]);
    expect(parsed.rows[0].words).toBeUndefined();
    expect(parsed.rows[0].wordStarts).toBeUndefined();
    const result = applyLrc(song, matchLrc(song, parsed.rows), 10);
    expect(result.sections[0].lines[0].start).toBe(1);
    expect(result.sections[0].lines[0].words).toBeUndefined();
  });

  it("merges complete enhanced rows without losing original word punctuation", () => {
    const song = songWith("Hello, beautiful WORLD!");
    const result = applyLrc(
      song,
      preview(
        song,
        "[00:01]<00:01>Hello <00:02>beautiful<00:03>\n[00:04]<00:04>world<00:06>",
      ),
      10,
    );
    expect(validWords(result.sections[0].lines[0])).toBe(true);
    expect(result.sections[0].lines[0].words).toEqual([
      { text: "Hello,", start: 1, end: 2 },
      { text: "beautiful", start: 2, end: 3 },
      { text: "WORLD!", start: 4, end: 6 },
    ]);
  });
});

describe("ordinary LRC", () => {
  it("parses repeated timestamps, fractions, minute boundaries and global millisecond offsets", () => {
    const parsed = parseLrc(
      "[ti:Title]\n[00:10.5][01:02.125]Again\n[00:03:20]Earlier\n[offset:-500]",
    );
    expect(parsed.rows.map((row) => [row.time, row.text])).toEqual([
      [2.7, "Earlier"],
      [10, "Again"],
      [61.625, "Again"],
    ]);
    expect(parsed.warnings).toEqual([]);
  });
  it("reports malformed/negative rows instead of silently clamping them into duplicate times", () => {
    const parsed = parseLrc(
      "[offset:-2000]\n[00:01]Too early\n[00:60]Bad seconds\nUnstamped text",
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.warnings).toHaveLength(3);
  });
  it("maps repeated choruses in order and reports unmatched LRC rows", () => {
    const song = createSong(true);
    ["Chorus", "Verse", "Chorus", "Ending"].forEach(
      (text, index) => (song.sections[0].lines[index].text = text),
    );
    const matches = matchLrc(
      song,
      parseLrc(
        "[00:01]Chorus\n[00:02]Unrelated\n[00:03]Verse\n[00:04]Chorus\n[00:05]Ending",
      ).rows,
    );
    expect(matches.map((row) => row.lineId)).toEqual([
      song.sections[0].lines[0].id,
      undefined,
      ...song.sections[0].lines.slice(1).map((line) => line.id),
    ]);
  });
  it("refuses simultaneous timestamps and fuzzy or out-of-order relabeling", () => {
    const song = createSong(true);
    const text = song.sections[0].lines[0].text;
    expect(
      matchLrc(song, parseLrc(`[00:01]${text}\n[00:01]${text}`).rows).every(
        (row) => !row.lineId,
      ),
    ).toBe(true);
    expect(
      matchLrc(song, parseLrc(`[00:01]${text} extra`).rows)[0].lineId,
    ).toBeUndefined();
  });
  it("applies only existing matched lines, preserves chord objects/times, sections and title, and clears stale word timing", () => {
    const song = createSong(true),
      line = song.sections[0].lines[0];
    line.chords[0].start = 2.5;
    line.chords[0].end = 4;
    line.words = [{ text: line.text, start: 1, end: 2 }];
    const matches = matchLrc(
      song,
      parseLrc(`[00:02]${line.text}\n[00:06]Foreign row`).rows,
    );
    const next = applyLrc(song, matches, 90);
    expect(next.title).toBe(song.title);
    expect(next.sections[0].id).toBe(song.sections[0].id);
    expect(next.sections[0].lines[0]).toMatchObject({
      id: line.id,
      text: line.text,
      start: 2,
      end: 6,
      timingReview: false,
    });
    expect(next.sections[0].lines[0].chords).toBe(line.chords);
    expect(next.sections[0].lines[0].words).toBeUndefined();
    expect(next.sections[0].lines[1]).toBe(song.sections[0].lines[1]);
    expect(line.start).toBeUndefined();
  });
  it("marks imported timing for review when it crosses a retained neighbor", () => {
    const song = createSong(true);
    song.sections[0].lines[1].start = 3;
    song.sections[0].lines[1].end = 5;
    const matches = matchLrc(
      song,
      parseLrc(`[00:02]${song.sections[0].lines[0].text}`).rows,
    );
    expect(applyLrc(song, matches, 8).sections[0].lines[0].timingReview).toBe(
      true,
    );
  });
});
