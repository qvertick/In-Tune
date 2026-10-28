import {
  isAlias,
  isCollection,
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  visit,
} from "yaml";
import type { LrcRow, LrcWord, LrcWordStart } from "./lrc";

// Primary draft: https://github.com/tranxuanthang/lyricsfile/blob/main/SPECIFICATION.md
const MAX_BYTES = 1_048_576;
const MAX_LINES = 2000;
const MAX_WORDS = 2000; // total segments in the entire document, not per line
const MAX_DEPTH = 32;
const CORE_TAGS = new Set(
  ["map", "seq", "str", "int", "bool", "null"].map(
    (name) => "tag:yaml.org,2002:" + name,
  ),
);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const milliseconds = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function wordIntervals(
  text: string,
  input: unknown,
  start: number,
  end?: number,
): LrcWordStart[] | undefined {
  if (!Array.isArray(input) || !input.length) return undefined;
  const segments: {
    text: string;
    from: number;
    to: number;
    start: number;
    end?: number;
  }[] = [];
  let offset = 0;
  for (const raw of input) {
    if (
      !record(raw) ||
      typeof raw.text !== "string" ||
      !milliseconds(raw.start_ms) ||
      (raw.end_ms !== undefined &&
        (!milliseconds(raw.end_ms) || raw.end_ms <= raw.start_ms)) ||
      raw.start_ms < start ||
      (end !== undefined &&
        (raw.start_ms >= end ||
          (typeof raw.end_ms === "number" && raw.end_ms > end))) ||
      (segments.length > 0 &&
        raw.start_ms < (segments.at(-1)!.end ?? segments.at(-1)!.start))
    )
      return undefined;
    segments.push({
      text: raw.text,
      from: offset,
      to: offset + raw.text.length,
      start: raw.start_ms,
      ...(typeof raw.end_ms === "number" ? { end: raw.end_ms } : {}),
    });
    offset += raw.text.length;
  }
  if (segments.map((part) => part.text).join("") !== text) return undefined;
  const result: LrcWordStart[] = [];
  for (const token of text.matchAll(/\S+/gu)) {
    const from = token.index!,
      to = from + token[0].length;
    const parts = segments.filter((part) => part.to > from && part.from < to);
    if (!parts.length) return undefined;
    // A segment may contain a syllable or one whitespace-delimited token.
    // A phrase segment cannot create separate times for its multiple words.
    if (
      parts.some((part) => {
        const content = part.text.trim();
        if (!content) return false;
        const left =
          part.from + part.text.length - part.text.trimStart().length;
        const right = part.to - (part.text.length - part.text.trimEnd().length);
        return left < from || right > to;
      })
    )
      return undefined;
    result.push({
      text: token[0],
      start: parts[0].start / 1000,
      ...(parts.at(-1)!.end === undefined
        ? {}
        : { end: parts.at(-1)!.end! / 1000 }),
    });
  }
  return result.length ? result : undefined;
}

/** Safe, conservative Lyricsfile 1.0 adapter to the existing LRC import API.
 * No end times are inferred. Unsupported words fall back to line timing;
 * overlapping voices remain review-only. Does not alter a Song or its text. */
export function parseLyricsfile(source: string): {
  rows: LrcRow[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const fail = (message: string) => ({
    rows: [] as LrcRow[],
    warnings: [message],
  });
  if (
    source.length > MAX_BYTES ||
    new TextEncoder().encode(source).length > MAX_BYTES
  )
    return fail("Lyricsfile: размер превышает 1 MiB.");
  try {
    const counter = new LineCounter();
    const doc = parseDocument(source, {
      version: "1.2",
      schema: "core",
      strict: true,
      uniqueKeys: true,
      customTags: [],
      lineCounter: counter,
    });
    if (doc.errors.length || doc.warnings.length)
      return fail(
        "Lyricsfile: ошибка YAML: " +
          (doc.errors[0]?.message ?? doc.warnings[0].message).slice(0, 400),
      );
    let problem = "",
      nodes = 0;
    // Inspect before toJS, so aliases are never expanded and tags never execute.
    visit(doc, (_key, node, path) => {
      nodes++;
      if (nodes > 60_000) problem = "слишком много узлов YAML.";
      else if (path.filter(isCollection).length > MAX_DEPTH)
        problem = "глубина YAML превышает 32.";
      else if (
        isAlias(node) ||
        (isNode(node) && "anchor" in node && node.anchor)
      )
        problem = "YAML anchors/aliases не поддерживаются.";
      else if (isNode(node) && node.tag && !CORE_TAGS.has(node.tag))
        problem = "пользовательские или неподдерживаемые YAML tags запрещены.";
      else if (
        isScalar(node) &&
        !(
          node.value === null ||
          typeof node.value === "string" ||
          typeof node.value === "boolean" ||
          (typeof node.value === "number" && Number.isSafeInteger(node.value))
        )
      )
        problem = "разрешены только строки, целые числа, boolean и null.";
      else if (
        isMap(node) &&
        node.items.some(
          (pair) => !isScalar(pair.key) || typeof pair.key.value !== "string",
        )
      )
        problem = "ключи YAML должны быть строками.";
      if (problem) return visit.BREAK;
    });
    if (problem) return fail("Lyricsfile: " + problem);
    const value: unknown = doc.toJS({ maxAliasCount: 0 });
    if (!record(value) || value.version !== "1.0")
      return fail('Lyricsfile: требуется точная строковая version: "1.0".');
    const metadata = value.metadata;
    if (
      !record(metadata) ||
      typeof metadata.title !== "string" ||
      typeof metadata.artist !== "string"
    )
      return fail(
        "Lyricsfile: metadata.title и metadata.artist должны быть строками.",
      );
    if (
      metadata.duration_ms !== undefined &&
      !milliseconds(metadata.duration_ms)
    )
      return fail("Lyricsfile: недопустимая metadata.duration_ms.");
    if (
      metadata.instrumental !== undefined &&
      typeof metadata.instrumental !== "boolean"
    )
      return fail("Lyricsfile: metadata.instrumental должен быть boolean.");
    if (
      metadata.offset_ms !== undefined &&
      (!Number.isSafeInteger(metadata.offset_ms) || metadata.offset_ms !== 0)
    )
      return fail(
        "Lyricsfile: ненулевой offset_ms не поддерживается — его смысл не определён спецификацией.",
      );
    if (value.plain !== undefined && typeof value.plain !== "string")
      return fail("Lyricsfile: plain должен быть строкой.");
    if (value.lines !== undefined && !Array.isArray(value.lines))
      return fail("Lyricsfile: lines должен быть массивом.");
    const lines = (value.lines ?? []) as unknown[];
    if (metadata.instrumental === true) {
      if (
        lines.length ||
        (typeof value.plain === "string" && value.plain.length)
      )
        return fail("Lyricsfile: instrumental несовместим с непустыми lyrics.");
      return fail(
        "Lyricsfile: инструментальная запись, синхронизированного текста нет.",
      );
    }
    if (!lines.length)
      return fail(
        "Lyricsfile: синхронизированных строк нет; plain не содержит времён.",
      );
    if (lines.length > MAX_LINES) return fail("Lyricsfile: больше 2000 строк.");
    if (
      lines.reduce<number>(
        (sum, line) =>
          sum +
          (record(line) && Array.isArray(line.words) ? line.words.length : 0),
        0,
      ) > MAX_WORDS
    )
      return fail("Lyricsfile: больше 2000 слов/сегментов в документе.");
    const lineNodes = doc.get("lines", true);
    const rows: LrcRow[] = [];
    lines.forEach((line, index) => {
      const node = isSeq(lineNodes) ? lineNodes.items[index] : undefined;
      const sourceLine =
        isNode(node) && node.range
          ? counter.linePos(node.range[0]).line
          : index + 1;
      const label = "Строка " + sourceLine + ": ";
      if (
        !record(line) ||
        typeof line.text !== "string" ||
        !milliseconds(line.start_ms)
      ) {
        warnings.push(
          label +
            "нужны строковый text и целый неотрицательный start_ms; пропущено.",
        );
        return;
      }
      const endValid =
        line.end_ms === undefined ||
        (milliseconds(line.end_ms) && line.end_ms > line.start_ms);
      const endMs =
        endValid && milliseconds(line.end_ms) ? line.end_ms : undefined;
      const row: LrcRow = {
        time: line.start_ms / 1000,
        text: line.text,
        sourceLine,
        endPolicy: "explicit",
        ...(endMs !== undefined ? { end: endMs / 1000 } : {}),
      };
      if (!endValid) {
        row.reviewReason =
          label + "нулевой или некорректный интервал строки; нужна проверка.";
        warnings.push(row.reviewReason);
      }
      if (
        line.words !== undefined &&
        (!Array.isArray(line.words) || line.words.length)
      ) {
        const words = wordIntervals(
          line.text,
          line.words,
          line.start_ms,
          endMs,
        );
        if (words?.every((word) => word.end !== undefined))
          row.words = words as LrcWord[];
        else if (words) {
          row.wordStarts = words;
          warnings.push(
            label +
              "есть начала слов без полных концов; длительность подсветки приблизительная.",
          );
        } else {
          row.wordTimingIssue =
            "Неполные, перекрывающиеся или несовместимые словные сегменты; оставлены только времена строки.";
          warnings.push(label + row.wordTimingIssue);
        }
      }
      if (endMs === undefined)
        warnings.push(label + "нет явного end_ms строки; конец не вычислялся.");
      rows.push(row);
    });
    rows.sort((a, b) => a.time - b.time);
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        const left = rows[i],
          right = rows[j];
        const end = left.end ?? left.words?.at(-1)?.end;
        if (
          left.time !== right.time &&
          (end === undefined || end <= right.time)
        )
          break;
        const message =
          "Перекрывающиеся или одновременные строки Lyricsfile; нужна проверка нескольких голосов.";
        left.reviewReason = message;
        right.reviewReason = message;
      }
    if (rows.some((row) => row.reviewReason))
      warnings.push(
        "Строки с конфликтами времени помечены review и не применяются автоматически.",
      );
    return { rows, warnings };
  } catch (error) {
    return fail(
      "Lyricsfile: не удалось безопасно прочитать YAML: " +
        (error instanceof Error
          ? error.message.slice(0, 300)
          : "ошибка разбора."),
    );
  }
}
