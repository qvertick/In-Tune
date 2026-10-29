import type { Line } from "./model";
import { validWords, validWordStarts } from "./timeline";
import { linePresentation } from "./songPresentation";

export type WordPlan = {
  kind: "exact" | "word-starts" | "approximate";
  words: { text: string; start: number; end: number }[];
};

/** Estimates are view data only: never written into the song's source timestamps. */
export function wordPlan(
  line: Line,
  start?: number,
  end?: number,
  approximate = false,
): WordPlan | undefined {
  if (linePresentation(line).kind !== "vocal") return;
  if (validWords(line)) return { kind: "exact", words: line.words! };
  if (validWordStarts(line))
    return {
      kind: "word-starts",
      words: line.wordStarts!.map((word, i, all) => ({
        ...word,
        end:
          word.end ??
          Math.min(all[i + 1]?.start ?? end ?? Infinity, word.start + 2.5),
      })),
    };
  if (
    !approximate ||
    line.timingReview ||
    start === undefined ||
    end === undefined
  )
    return;
  const tokens = line.text.match(/\S+/gu) ?? [];
  const span = end - start;
  // A long boundary may include an instrumental break. Prefer line-only highlighting.
  if (
    !tokens.length ||
    span < 0.3 ||
    span > Math.min(18, Math.max(6, tokens.length * 1.5))
  )
    return;
  if (
    !/[\p{L}]/u.test(line.text) ||
    /^(?:[↓↑xхvV\s\-–—|×\d]+|(?:бой|strumming|ритм)\s*:.*)$/iu.test(
      line.text.trim(),
    )
  )
    return;
  const weights = tokens.map(
    (text) =>
      Math.max(1, Array.from(text.replace(/[^\p{L}\p{N}]/gu, "")).length) +
      (/[,.!?;:…]$/u.test(text) ? 2 : 0),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = start;
  return {
    kind: "approximate",
    words: tokens.map((text, i) => {
      const next =
        i === tokens.length - 1 ? end : cursor + (span * weights[i]) / total;
      const word = { text, start: cursor, end: next };
      cursor = next;
      return word;
    }),
  };
}

export function wordPhase(time: number, word: { start: number; end: number }) {
  return time < word.start ? "future" : time >= word.end ? "past" : "active";
}
