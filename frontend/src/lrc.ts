import { normalizeChord, type Line, type Song } from "./model";
import { normalized, validWords, validWordStarts } from "./timeline";
import { allLines, finiteTime } from "./playerTiming";

export type LrcWord = { text: string; start: number; end: number };
export type LrcWordStart = { text: string; start: number; end?: number };
export type LrcRow = {
  time: number;
  text: string;
  sourceLine: number;
  /** Complete intervals only; the last word requires an explicit terminal tag. */
  words?: LrcWord[];
  /** Real enhanced starts, including files without a terminal tag. */
  wordStarts?: LrcWordStart[];
  end?: number;
  wordTimingIssue?: string;
  /** Lyricsfile has no defined missing-end inference rule. */
  endPolicy?: "explicit";
  /** Unsupported simultaneous/overlapping voices must stay out of the map. */
  reviewReason?: string;
};
export type LrcTarget = {
  lineId: string;
  start: number;
  end?: number;
  words?: LrcWord[];
  wordStarts?: LrcWordStart[];
  endPolicy?: "explicit";
};
export type LrcMatch = LrcRow & {
  /** First applicable target; compatible with the original import UI. */
  lineId?: string;
  reason?: string;
  status?: "matched" | "unmatched" | "review" | "ignored";
  /** Full group plan, shared by merge members. Count unique target IDs
   * rather than LRC rows when measuring document coverage. */
  targets?: LrcTarget[];
};

// Simple LRC and the A2 enhanced extension:
// https://www.quicklrc.com/subtitle-formats/enhanced-lrc
// https://www.karaokesync.com/lrc-maker/ (also documents a terminal end tag).
const CLOCK = "(\\d+):(\\d{2})(?:[.:](\\d{1,3}))?";
function clock(tag: RegExpMatchArray, offset: number) {
  const value =
    Number(tag[1]) * 60 +
    Number(tag[2]) +
    Number("0." + (tag[3] ?? "0")) +
    offset;
  return Number(tag[2]) < 60 && finiteTime(value) ? value : undefined;
}

function enhanced(
  body: string,
  offset: number,
  lineTime: number,
): Omit<LrcRow, "time" | "sourceLine"> {
  const tags = [...body.matchAll(new RegExp("<" + CLOCK + ">", "g"))];
  if (!tags.length) return { text: body.trim() };
  let text = "",
    cursor = 0;
  const anchors: { at: number; time: number | undefined }[] = [];
  for (const tag of tags) {
    text += body.slice(cursor, tag.index);
    anchors.push({ at: text.length, time: clock(tag, offset) });
    cursor = tag.index! + tag[0].length;
  }
  text += body.slice(cursor);
  const tokens = [...text.matchAll(/\S+/gu)];
  const invalid = anchors.some(
    (a, i) =>
      a.time === undefined ||
      a.time < lineTime ||
      (i > 0 && a.time <= (anchors[i - 1].time ?? Infinity)),
  );
  const words = tokens.map((token): LrcWordStart | undefined => {
    const startAt = token.index!,
      endAt = startAt + token[0].length;
    // Whitespace after a tag is permitted; tags inside tokens mark syllables.
    const first = anchors.find(
      (a) => a.at <= startAt && !text.slice(a.at, startAt).trim(),
    );
    if (!first || first.time === undefined) return undefined;
    const after = anchors.find((a) => a.at >= endAt);
    return {
      text: token[0],
      start: first.time,
      ...(after?.time !== undefined ? { end: after.time } : {}),
    };
  });
  const trailing = anchors.at(-1);
  const end =
    trailing && !text.slice(trailing.at).trim() ? trailing.time : undefined;
  if (invalid || words.some((w) => !w) || /[<>]/u.test(text))
    return {
      text: text.trim(),
      wordTimingIssue:
        "Неполные или некорректные словные отметки; используются только времена строк.",
    };
  const starts = words as LrcWordStart[];
  return {
    text: text.trim(),
    wordStarts: starts,
    ...(starts.length && starts.every((w) => w.end !== undefined)
      ? { words: starts as LrcWord[] }
      : {}),
    ...(end !== undefined ? { end } : {}),
  };
}

export function parseLrc(source: string): {
  rows: LrcRow[];
  warnings: string[];
} {
  const rows: LrcRow[] = [],
    warnings: string[] = [];
  const offsetMatches = [
    ...source.matchAll(/^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/gim),
  ];
  // Preserve the existing convention: positive offset delays lyrics.
  const offset = Number(offsetMatches.at(-1)?.[1] ?? 0) / 1000;
  source
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\n|\r/)
    .forEach((raw, index) => {
      let body = raw.trimStart();
      const times: number[] = [];
      const tagPattern = new RegExp("^\\[" + CLOCK + "\\]");
      let tag: RegExpMatchArray | null;
      while ((tag = tagPattern.exec(body))) {
        const time = clock(tag, offset);
        if (time === undefined)
          warnings.push(
            "Строка " + (index + 1) + ": время вне диапазона после offset.",
          );
        else times.push(time);
        body = body.slice(tag[0].length).trimStart();
      }
      if (
        body === raw.trimStart() &&
        raw.trim() &&
        !/^\s*(?:\[[a-z][\w-]*:.*\]\s*)+$/i.test(raw) &&
        !/^\s*#/.test(raw)
      )
        warnings.push(
          "Строка " + (index + 1) + ": нет обычной временной отметки.",
        );
      if (!times.length) return;
      const content = enhanced(body, offset, times[0]);
      if (content.wordTimingIssue)
        warnings.push("Строка " + (index + 1) + ": " + content.wordTimingIssue);
      for (const time of times) {
        const delta = time - times[0];
        const shift = <T extends LrcWordStart>(word: T): T => ({
          ...word,
          start: word.start + delta,
          ...(word.end !== undefined ? { end: word.end + delta } : {}),
        });
        rows.push({
          time,
          ...content,
          sourceLine: index + 1,
          ...(content.words ? { words: content.words.map(shift) } : {}),
          ...(content.wordStarts
            ? { wordStarts: content.wordStarts.map(shift) }
            : {}),
          ...(content.end !== undefined ? { end: content.end + delta } : {}),
        });
      }
    });
  return { rows: rows.sort((a, b) => a.time - b.time), warnings };
}

/** Only whole service labels/patterns are ignored, never lyric substrings. */
function service(text: string) {
  const value = text.trim();
  if (!normalized(value)) return true;
  if (
    /^(?:\[|\()(?:instrumental|intro|outro|solo|interlude|chorus|verse|bridge|припев|куплет|проигрыш|вступление|соло|инструментал)(?:\s*\d+)?(?:\]|\))[:.!\s]*$/iu.test(
      value,
    )
  )
    return true;
  if (
    /^(?:instrumental|intro|outro|interlude|проигрыш|вступление|инструментал|соло)[:.!\s]*$/iu.test(
      value,
    )
  )
    return true;
  if (
    /^(?:бой|перебор|strumming|strum|picking)\s*:\s*[\d\s↓↑↕⇓⇑xхXХvVUDudPIMAima|/\\—–.()+*-]+$/iu.test(
      value,
    )
  )
    return true;
  if (/^[eBGDAE]\|[-\d|hpbx~\s/\\]+$/u.test(value)) return true;
  const parts = value
    .replace(/[|()[\],:;]/g, " ")
    .trim()
    .split(/\s+/u);
  return parts.every((part) => normalizeChord(part) !== null);
}

/** Shared classification for import preview and manual sync navigation. */
export { service as isServiceLine };

type Group = { r: number; l: number; nr: number; nl: number; score: number };

/** Exact ordered full-group alignment. Inspect every optimal path so ambiguous
 * repeats become review entries. Ignored rows remain preview/end boundaries. */
export function matchLrc(song: Song, rows: LrcRow[]): LrcMatch[] {
  // Callers may pass a previous preview. Never inherit its accepted IDs/status.
  rows = rows.map((input) => {
    const {
      lineId: _id,
      reason: _reason,
      status: _status,
      targets: _targets,
      ...row
    } = input as LrcMatch;
    return row;
  });
  const matches: LrcMatch[] = rows.map((row) => ({
    ...row,
    status: service(row.text) ? "ignored" : "unmatched",
    reason: service(row.text)
      ? "Служебная или инструментальная строка; пропущено."
      : "Текст не совпал по порядку; пропущено.",
  }));
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.time - b.row.time);
  const times = new Map<number, number>();
  rows.forEach((row) => times.set(row.time, (times.get(row.time) ?? 0) + 1));
  const source = ordered.filter(({ row, index }) => {
    if (row.reviewReason) {
      matches[index] = { ...row, status: "review", reason: row.reviewReason };
      return false;
    }
    if (!finiteTime(row.time) || (times.get(row.time) ?? 0) > 1) {
      matches[index] = {
        ...row,
        status: "review",
        reason:
          "Некорректное или одинаковое время у нескольких строк; исправьте LRC.",
      };
      return false;
    }
    return !service(row.text);
  });
  const orderIndex = new Map(ordered.map((item, index) => [item, index]));
  const lines = allLines(song).filter((line) => !service(line.text));
  const n = source.length,
    m = lines.length;
  if (!n || !m) return matches;
  if (
    (n + 1) * (m + 1) > 2_000_000 ||
    rows.reduce((sum, row) => sum + row.text.length, 0) > 1_000_000
  ) {
    return matches.map((match) =>
      match.status === "unmatched"
        ? {
            ...match,
            status: "review",
            reason: "Слишком большой файл: импортируйте по частям.",
          }
        : match,
    );
  }
  const rk = source.map(({ row }) => normalized(row.text));
  const lk = lines.map((line) => normalized(line.text));
  function groups(r: number, l: number): Group[] {
    const result: Group[] = [];
    let key = "";
    for (let end = l; end < m; end++) {
      key += lk[end];
      if (!rk[r].startsWith(key)) break;
      if (key === rk[r]) {
        result.push({ r, l, nr: 1, nl: end - l + 1, score: key.length });
        break;
      }
    }
    key = rk[r];
    for (let end = r + 1; end < n; end++) {
      // Never merge across an explicit instrumental/invalid boundary.
      if (orderIndex.get(source[end]) !== orderIndex.get(source[end - 1])! + 1)
        break;
      key += rk[end];
      if (!lk[l].startsWith(key)) break;
      if (key === lk[l]) {
        result.push({ r, l, nr: end - r + 1, nl: 1, score: key.length });
        break;
      }
    }
    return result;
  }
  const width = m + 1,
    size = (n + 1) * width;
  const best = new Float64Array(size);
  for (let r = n - 1; r >= 0; r--)
    for (let l = m - 1; l >= 0; l--) {
      const at = r * width + l;
      let score = Math.max(best[at + width], best[at + 1]);
      for (const g of groups(r, l))
        score = Math.max(score, g.score + best[(r + g.nr) * width + l + g.nl]);
      best[at] = score;
    }
  const reached = new Uint8Array(size);
  const choices: (Group | undefined)[] = Array(n);
  const ambiguous = new Uint8Array(n);
  reached[0] = 1;
  for (let r = 0; r <= n; r++)
    for (let l = 0; l <= m; l++) {
      const at = r * width + l;
      if (!reached[at]) continue;
      if (r < n && best[at] === best[at + width]) {
        ambiguous[r] = 1;
        reached[at + width] = 1;
      }
      if (l < m && best[at] === best[at + 1]) reached[at + 1] = 1;
      if (r === n || l === m) continue;
      for (const g of groups(r, l)) {
        const next = (r + g.nr) * width + l + g.nl;
        if (best[at] !== g.score + best[next]) continue;
        reached[next] = 1;
        for (let k = r; k < r + g.nr; k++) {
          const old = choices[k];
          if (
            old &&
            (old.r !== r || old.l !== l || old.nr !== g.nr || old.nl !== g.nl)
          )
            ambiguous[k] = 1;
          choices[k] = g;
        }
      }
    }
  const nextTime = (row: LrcRow) =>
    ordered.find(({ row: other }) => other.time > row.time)?.row.time;
  for (let r = 0; r < n; r++) {
    const group = choices[r];
    if (!group) continue;
    const members = source.slice(group.r, group.r + group.nr);
    if (members.some((_, i) => ambiguous[group.r + i])) {
      matches[source[r].index] = {
        ...source[r].row,
        status: "review",
        reason:
          "Неоднозначный повтор или порядок строк; выберите соответствие вручную.",
      };
      continue;
    }
    const targets = plan(
      members.map(({ row }) => row),
      lines.slice(group.l, group.l + group.nl),
      nextTime(members.at(-1)!.row),
    );
    matches[source[r].index] = targets
      ? {
          ...source[r].row,
          status: "matched",
          lineId: targets[0].lineId,
          targets,
          ...(source[r].row.wordTimingIssue
            ? { reason: source[r].row.wordTimingIssue }
            : {}),
        }
      : {
          ...source[r].row,
          status: "review",
          reason:
            "Текст совпал, но для разделения строки нужны полные словные отметки.",
        };
  }
  return matches;
}

/** Map real starts to original whitespace tokens, as required by validWords.
 * An untimed subdivision of a word cannot supply a new word boundary. */
function wordPlan(rows: LrcRow[], lines: Line[]) {
  let position = 0;
  const spans: { from: number; to: number; start: number; end?: number }[] = [];
  for (const row of rows) {
    const words = row.wordStarts ?? row.words;
    if (!words?.length || row.wordTimingIssue) return undefined;
    if (normalized(words.map((w) => w.text).join(" ")) !== normalized(row.text))
      return undefined;
    for (const word of words) {
      const length = normalized(word.text).length;
      if (!length) return undefined;
      spans.push({
        from: position,
        to: position + length,
        start: word.start,
        end: word.end,
      });
      position += length;
    }
  }
  position = 0;
  const result: LrcWordStart[][] = [];
  for (const line of lines) {
    const words: LrcWordStart[] = [];
    for (const token of line.text.match(/\S+/gu) ?? []) {
      const from = position,
        to = from + normalized(token).length;
      const first = spans.find((span) => span.from === from);
      const last = spans.find((span) => span.to === to);
      if (!first || !last || to <= from) return undefined;
      words.push({
        text: token,
        start: first.start,
        ...(last.end !== undefined ? { end: last.end } : {}),
      });
      position = to;
    }
    result.push(words);
  }
  const flat = result.flat();
  if (
    flat.some(
      (w, i) =>
        !finiteTime(w.start) ||
        (w.end !== undefined && (!finiteTime(w.end) || w.end <= w.start)) ||
        (i > 0 && (flat[i - 1].end ?? flat[i - 1].start) > w.start),
    )
  )
    return undefined;
  return result;
}

function plan(
  rows: LrcRow[],
  lines: Line[],
  boundary?: number,
): LrcTarget[] | undefined {
  const explicit = rows.some((row) => row.endPolicy === "explicit");
  const last = rows.at(-1)!;
  const end = last.end ?? (explicit ? last.words?.at(-1)?.end : boundary);
  const words = wordPlan(rows, lines);
  if (lines.length > 1 && !words) return undefined;
  const targets = lines.map(
    (line, i): LrcTarget => ({
      lineId: line.id,
      ...(explicit ? { endPolicy: "explicit" as const } : {}),
      start: i === 0 ? rows[0].time : words![i][0].start,
      ...(i + 1 < lines.length
        ? { end: words![i + 1][0].start }
        : end !== undefined
          ? { end }
          : {}),
      ...(words?.[i].every((w) => w.end !== undefined)
        ? { words: words[i] as LrcWord[] }
        : words?.[i]
          ? { wordStarts: words[i] }
          : {}),
    }),
  );
  for (const target of targets) {
    if (
      !finiteTime(target.start) ||
      (target.end !== undefined &&
        (!finiteTime(target.end) || target.end <= target.start))
    )
      return undefined;
    if (
      target.words?.some(
        (w) =>
          w.start < target.start ||
          (target.end !== undefined && w.end > target.end),
      )
    ) {
      if (lines.length > 1) return undefined;
      delete target.words;
    }
  }
  return targets;
}

/** Revalidate the preview against the current document. Only timing changes;
 * text, IDs, sections and chord objects survive. Confirmation is the UI's job. */
export function applyLrc(
  song: Song,
  matches: LrcMatch[],
  duration?: number,
): Song {
  const checked = matchLrc(song, matches);
  const updates = new Map<string, LrcTarget>();
  checked.forEach((match, i) => {
    const supplied = matches[i];
    if (
      !match.lineId ||
      supplied.lineId !== match.lineId ||
      (supplied.targets !== undefined &&
        supplied.targets.map((t) => t.lineId).join("\0") !==
          match.targets?.map((t) => t.lineId).join("\0")) ||
      (supplied.status !== undefined && supplied.status !== "matched")
    )
      return;
    // A merge cannot silently import deselected group members.
    const group = checked.filter((other) =>
      other.targets?.some((t) => t.lineId === match.lineId),
    );
    if (
      group.some((other) => {
        const index = checked.indexOf(other);
        return (
          matches[index].lineId !== other.lineId ||
          (matches[index].status !== undefined &&
            matches[index].status !== "matched")
        );
      })
    )
      return;
    for (const target of match.targets ?? [])
      updates.set(target.lineId, target);
  });
  if (!updates.size) return song;
  const lines = allLines(song);
  const changed = lines.map((line) => {
    const target = updates.get(line.id);
    if (!target) return line;
    const end =
      target.end ??
      (target.endPolicy !== "explicit" && finiteTime(duration)
        ? duration
        : undefined);
    const { words: _words, wordStarts: _starts, end: _end, ...rest } = line;
    const next: Line = {
      ...rest,
      start: target.start,
      ...(finiteTime(end) && end > target.start ? { end } : {}),
      timingReview: false,
      manuallyEdited: true,
    };
    if (target.words && validWords({ ...next, words: target.words }))
      next.words = target.words;
    if (
      !next.words &&
      target.wordStarts &&
      validWordStarts({ ...next, wordStarts: target.wordStarts })
    )
      next.wordStarts = target.wordStarts;
    return next;
  });
  const reviewed = new Map<string, Line>();
  changed.forEach((line, index) => {
    if (!updates.has(line.id)) return;
    const conflict =
      !finiteTime(line.start) ||
      (duration !== undefined &&
        (!finiteTime(duration) ||
          line.start! >= duration ||
          (line.end ?? 0) > duration)) ||
      changed.some((other, j) => {
        if (index === j || (other.timingReview && !updates.has(other.id)))
          return false;
        const start =
          other.start ??
          (validWords(other) ? other.words?.[0]?.start : undefined);
        const end =
          other.end ??
          (validWords(other) ? other.words?.at(-1)?.end : undefined) ??
          start;
        return (
          finiteTime(start) &&
          (j < index
            ? (end ?? start) > line.start!
            : start <= line.start! || start < (line.end ?? line.start!))
        );
      });
    reviewed.set(line.id, { ...line, timingReview: conflict });
  });
  return {
    ...song,
    sections: song.sections.map((section) => ({
      ...section,
      lines: section.lines.map((line) => reviewed.get(line.id) ?? line),
    })),
  };
}
