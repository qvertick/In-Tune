// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TimingEditor from "./TimingEditor";
import { createSong } from "./model";
afterEach(cleanup);
it("saves line-only timing without inventing words and rejects overlapping neighbours", async () => {
  const song=createSong(true), line=song.sections[0].lines[0], save=vi.fn(), user=userEvent.setup();
  song.sections[0].lines[1].start=5;
  render(<TimingEditor song={song} line={line} onSave={save} />);
  await user.click(screen.getByText("Проверка разметки выбранной строки"));
  await user.type(screen.getByLabelText("Начало строки"),"1.25");
  await user.type(screen.getByLabelText("Конец строки"),"6");
  await user.click(screen.getByRole("button",{name:"Сохранить разметку строки"}));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("пересекается");
  await user.clear(screen.getByLabelText("Конец строки"));
  await user.type(screen.getByLabelText("Конец строки"),"4.5");
  await user.click(screen.getByRole("button",{name:"Сохранить разметку строки"}));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({start:1.25,end:4.5,timingReview:false}));
  expect(save.mock.calls[0][0].words).toBeUndefined();
  expect(line.start).toBeUndefined();
});
