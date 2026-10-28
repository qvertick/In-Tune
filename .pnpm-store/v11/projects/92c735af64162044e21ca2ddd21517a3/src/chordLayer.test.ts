import { expect, it } from "vitest";
import { placeChordLabels, placeInstrumentalLabels } from "./chordLayer";

it("stacks neighbouring and same-position labels without moving lyric anchors", () => {
  const labels = [
    { x: 0, row: 0, width: 65 },
    { x: 10, row: 0, width: 50 },
    { x: 10, row: 0, width: 30 },
    { x: 80, row: 0, width: 20 },
  ];
  const result = placeChordLabels(labels, 200);
  expect(result.placements.map((p) => p.lane)).toEqual([0, 1, 2, 0]);
  expect(result.placements.map((p) => p.left + p.anchor)).toEqual(
    labels.map((p) => p.x),
  );
  expect(result.count).toBe(3);
});
it("keeps long labels inside the container, with a tether to their true anchor", () => {
  const result = placeChordLabels(
    [
      { x: 145, row: 0, width: 100 },
      { x: 149, row: 0, width: 90 },
    ],
    150,
  );
  expect(result.placements).toEqual([
    { left: 50, lane: 0, anchor: 95 },
    { left: 60, lane: 1, anchor: 89 },
  ]);
});
it("reuses annotation lanes after a visual line wrap", () => {
  expect(
    placeChordLabels(
      [
        { x: 0, row: 0, width: 80 },
        { x: 0, row: 60, width: 80 },
      ],
      100,
    ).count,
  ).toBe(1);
});
it("spaces instrumental chords independently of absent text and wraps within the annotation layer", () => {
  const result = placeInstrumentalLabels([30, 25, 80, 40], 100);
  expect(result.placements.map((p) => [p.left, p.lane])).toEqual([
    [0, 0],
    [44, 0],
    [0, 1],
    [0, 2],
  ]);
  expect(result.count).toBe(3);
});
