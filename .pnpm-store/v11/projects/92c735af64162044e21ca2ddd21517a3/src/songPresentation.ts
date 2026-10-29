import { normalizeChord, type Line, type Section } from "./model";

/** Display metadata only. The imported text, order and occurrences stay intact. */
export function textPresentation(text: string) {
  const strum =
    /^(бой|перебор|strumming|strum|picking)\s*:\s*([\d\s↓↑↕⇓⇑xхXХvVUDudPIMAima|/\\—–.()+*\-]+)$/iu.exec(
      text.trim(),
    );
  if (strum)
    return {
      kind: "strum" as const,
      label: strum[1],
      pattern: strum[2],
      names: [] as string[],
    };
  const repeat = /(?:[}\])]?\s*[xх×]\s*([1-9]\d{0,3}))\s*$/iu.exec(text.trim());
  const body = (repeat ? text.trim().slice(0, repeat.index) : text).trim();
  const tokens = body
    .replace(/[|()[\],;]/g, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const chordsOnly =
    tokens.length > 0 &&
    tokens.every(
      (token) =>
        normalizeChord(token) !== null || /^[A-G](?:[#♯b♭])?5$/u.test(token),
    );
  const marker =
    /^(?:\[|\()?(?:instrumental|intro|outro|interlude|проигрыш|вступление|инструментал|соло)(?:\]|\))?[:.!\s]*$/iu.test(
      body,
    );
  return {
    kind:
      !body || chordsOnly || marker
        ? ("instrumental" as const)
        : ("vocal" as const),
    names: chordsOnly ? tokens : [],
    repeats: repeat ? Number(repeat[1]) : undefined,
  };
}
export function linePresentation(line: Line) {
  return textPresentation(line.text);
}
export function sectionPresentation(section: Section) {
  const repeat = /\s+[xх×]\s*([1-9]\d{0,3})\s*$/iu.exec(section.name);
  return {
    name: repeat ? section.name.slice(0, repeat.index).trim() : section.name,
    repeats: repeat ? Number(repeat[1]) : undefined,
  };
}
export function instrumentNames(
  line: Line,
  palette: { id: string; name: string }[],
) {
  // Offsets describe the source order; ties keep the occurrence array order.
  return [...line.chords]
    .sort((a, b) => a.offset - b.offset)
    .map((chord) => ({
      id: chord.id,
      name: palette.find((p) => p.id === chord.paletteId)?.name ?? "?",
      chord,
    }));
}
