import { useLayoutEffect, useRef } from "react";
import type { Line, PaletteChord } from "./model";

type Label = { x: number; row: number; width: number };
/** Collisions affect annotation lanes only, never the positions of lyric glyphs. */
export function placeChordLabels(labels: Label[], available: number, gap = 6) {
  const lanes = new Map<number, number[]>();
  const placed = labels
    .map((label, index) => ({
      ...label,
      index,
      left: Math.max(0, Math.min(label.x, available - label.width)),
    }))
    .sort((a, b) => a.row - b.row || a.left - b.left || a.index - b.index);
  let count = 1;
  const result = labels.map(() => ({ left: 0, lane: 0, anchor: 0 }));
  for (const label of placed) {
    const ends = lanes.get(label.row) ?? [];
    let lane = ends.findIndex((end) => end + gap <= label.left);
    if (lane < 0) lane = ends.length;
    ends[lane] = label.left + label.width;
    lanes.set(label.row, ends);
    count = Math.max(count, lane + 1);
    result[label.index] = {
      left: label.left,
      lane,
      anchor: label.x - label.left,
    };
  }
  return { placements: result, count };
}

/** Empty instrumental lines have no letter geometry to stretch. Space their labels in the annotation layer. */
export function placeInstrumentalLabels(
  widths: number[],
  available: number,
  gap = 14,
) {
  let left = 0,
    lane = 0;
  const placements = widths.map((width) => {
    if (left > 0 && left + width > available) {
      left = 0;
      lane++;
    }
    const placement = { left, lane, anchor: 0 };
    left += width + gap;
    return placement;
  });
  return { placements, count: lane + 1 };
}

export function useChordLayer(line: Line, palette: PaletteChord[]) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let disposed = false,
      frame: number | null = null;
    const property = (node: HTMLElement, name: string, value: string) => {
      if (node.style.getPropertyValue(name) !== value)
        node.style.setProperty(name, value);
    };
    const measure = () => {
      frame = null;
      if (disposed) return;
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0) return; // No layout in a hidden view or DOM-only test.
      property(element, "--chord-max-width", `${bounds.width}px`);
      const nodes = [
        ...element.querySelectorAll<HTMLElement>(".above > .chord"),
      ];
      const labels = nodes.map((node) => {
        const cell = node
          .closest<HTMLElement>(".lyric-cell")!
          .getBoundingClientRect();
        const label = node.getBoundingClientRect();
        return {
          x: cell.left - bounds.left,
          row: Math.round(cell.top - bounds.top),
          width: label.width,
          height: label.height,
        };
      });
      const step = Math.max(22, ...labels.map((label) => label.height)) + 4;
      const layout = line.text.trim()
        ? placeChordLabels(labels, bounds.width)
        : placeInstrumentalLabels(
            labels.map((label) => label.width),
            bounds.width,
          );
      // All glyphs reserve the same vertical room. No horizontal dimensions change.
      property(element, "--chord-space", `${layout.count * step}px`);
      layout.placements.forEach((placement, i) => {
        property(nodes[i], "--chord-x", `${placement.left - labels[i].x}px`);
        property(nodes[i], "--chord-y", `${placement.lane * step}px`);
        property(nodes[i], "--chord-anchor-x", `${placement.anchor}px`);
        property(nodes[i], "--chord-tether", `${placement.anchor}px`);
        nodes[i].dataset.shifted = placement.anchor > 0.5 ? "true" : "false";
      });
    };
    const schedule = () => {
      if (disposed || frame !== null) return;
      if (typeof requestAnimationFrame === "function")
        frame = requestAnimationFrame(measure);
      else measure();
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(element);
    window.addEventListener("resize", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    void document.fonts?.ready.then(schedule);
    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [line.text, line.chords, palette]);
  return root;
}
