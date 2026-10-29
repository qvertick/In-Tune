// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ChordTimingEditor, { markChord } from "./ChordTimingEditor";
import { createSong, id } from "./model";
afterEach(cleanup);
function fixture() {
  const song = createSong(true),
    line = song.sections[0].lines[0];
  line.text = "}x4";
  line.chords = song.palette
    .slice(0, 3)
    .map((p, i) => ({
      id: id(),
      paletteId: p.id,
      offset: i,
      source: "manual",
    }));
  song.audio = { filename: "own.mp3", url: "/own.mp3", duration: 90 };
  return { song, line };
}
it("marks real changes sequentially and closes only the previous known occurrence", () => {
  const { line } = fixture(),
    before = JSON.stringify(line);
  let marked = markChord(line, line.chords[0].id, 5);
  marked = markChord(marked, line.chords[1].id, 8);
  expect(marked.chords[0]).toMatchObject({ start: 5, end: 8 });
  expect(marked.chords[1].start).toBe(8);
  expect(marked.chords[2].start).toBeUndefined();
  expect(marked.text).toBe("}x4");
  expect(JSON.stringify(line)).toBe(before);
  expect(() => markChord(marked, line.chords[2].id, 7)).toThrow();
});
it("reuses shared audio time and passes edits to the existing undo/save mechanism", () => {
  const { song, line } = fixture(),
    save = vi.fn();
  render(
    <ChordTimingEditor
      line={line}
      song={song}
      currentTime={() => 12.75}
      onSave={save}
      enabled
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Отметить следующий аккорд/ }),
  );
  expect(save.mock.calls[0][0].chords[0].start).toBe(12.75);
  expect(save.mock.calls[0][0].chords[1].start).toBeUndefined();
});
it("validates partial intervals and keeps the input after an invalid save", () => {
  const { song, line } = fixture(),
    save = vi.fn();
  render(
    <ChordTimingEditor
      line={line}
      song={song}
      currentTime={() => 3}
      onSave={save}
      enabled
    />,
  );
  fireEvent.change(screen.getByLabelText("Начало аккорда Am"), {
    target: { value: "5" },
  });
  fireEvent.change(screen.getByLabelText("Конец аккорда Am"), {
    target: { value: "4" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Сохранить времена аккордов" }),
  );
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(
    (screen.getByLabelText("Начало аккорда Am") as HTMLInputElement).value,
  ).toBe("5");
});
