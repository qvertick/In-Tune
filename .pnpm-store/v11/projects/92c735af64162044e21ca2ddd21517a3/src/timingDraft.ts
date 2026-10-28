import type { Song } from "./model";

export const timingDraftKey = (id: string) => "vlad-timing-draft-" + id;
/** A draft may only restore onto the exact document/audio it was made from. */
export function recoverTimingDraft(
  song: Song,
  raw: string | null,
): Song | null {
  if (!raw || raw.length > 2_500_000) return null;
  try {
    const saved = JSON.parse(raw);
    if (
      saved.version !== 1 ||
      saved.audio !== (song.audio?.url ?? "") ||
      saved.base !== JSON.stringify(song.sections) ||
      !Array.isArray(saved.sections)
    )
      return null;
    const old = song.sections.flatMap((section) => section.lines);
    const lines = saved.sections.flatMap(
      (section: Song["sections"][number]) => section.lines,
    );
    if (
      old.length !== lines.length ||
      lines.some(
        (line: (typeof old)[number], i: number) =>
          line.id !== old[i].id ||
          line.text !== old[i].text ||
          !Array.isArray(line.chords) ||
          (line.start !== undefined &&
            (!Number.isFinite(line.start) || line.start < 0)) ||
          (line.end !== undefined &&
            (!Number.isFinite(line.end) || line.end <= (line.start ?? -1))),
      )
    )
      return null;
    return { ...song, sections: saved.sections };
  } catch {
    return null;
  }
}
export function serializeTimingDraft(base: Song, draft: Song) {
  return JSON.stringify({
    version: 1,
    audio: base.audio?.url ?? "",
    base: JSON.stringify(base.sections),
    sections: draft.sections,
  });
}
