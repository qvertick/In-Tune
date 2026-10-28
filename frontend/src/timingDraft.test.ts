import { it, expect } from "vitest";
import { createSong } from "./model";
import { recoverTimingDraft, serializeTimingDraft } from "./timingDraft";
it("recovers timing work only for the same text, chords, map and recording", () => {
  const song = createSong(true),
    draft = structuredClone(song);
  draft.sections[0].lines[0].start = 2;
  draft.sections[0].lines[0].end = 5;
  const raw = serializeTimingDraft(song, draft);
  expect(recoverTimingDraft(song, raw)?.sections[0].lines[0].start).toBe(2);
  const edited = structuredClone(song);
  edited.sections[0].lines[0].text = "Новая строка";
  expect(recoverTimingDraft(edited, raw)).toBeNull();
  expect(
    recoverTimingDraft(
      { ...song, audio: { filename: "other.mp3", url: "/other" } },
      raw,
    ),
  ).toBeNull();
  expect(recoverTimingDraft(song, "not json")).toBeNull();
});
