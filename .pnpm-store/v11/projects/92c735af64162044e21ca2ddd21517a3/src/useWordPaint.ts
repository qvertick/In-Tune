import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { wordPhase, type WordPlan } from "./wordTiming";

/** Only the active row paints locally. No React render loop for word animation. */
export function useWordPaint(
  root: RefObject<HTMLElement | null>,
  plan: WordPlan | undefined,
  position: number,
  active: boolean,
  playing: boolean,
  readPosition: () => number,
  enabled = true,
) {
  const read = useRef(readPosition);
  read.current = readPosition;
  const paint = useRef<(time: number) => void>(() => {});
  useLayoutEffect(() => {
    // textContent includes chord labels, so use letter glyphs to skip only blank groups.
    const groups = [
      ...(root.current?.querySelectorAll<HTMLElement>(".lyric-word") ?? []),
    ].filter((e) =>
      [...e.querySelectorAll(".letter")]
        .map((l) => l.textContent)
        .join("")
        .replace(/\u200b/g, "")
        .trim(),
    );
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const phases = new Map<HTMLElement, string | null>();
    groups.forEach((element) => {
      element.classList.toggle("timed-word", !!plan && enabled);
      element.classList.toggle(
        "approximate-word",
        plan?.kind === "approximate" && enabled,
      );
    });
    paint.current = (time) => {
      groups.forEach((element, i) => {
        const word = plan?.words[i];
        const phase = word ? wordPhase(time, word) : null;
        if (phases.get(element) !== phase || !phases.has(element)) {
          for (const name of ["active", "past", "future"])
            element.classList.toggle(`word-${name}`, enabled && phase === name);
          element.dataset.followWord = phase === "active" ? "true" : "false";
          phases.set(element, phase);
        }
        if (word) {
          const progress =
            phase === "past"
              ? 100
              : phase === "future"
                ? 0
                : reduced
                  ? 100
                  : 100 *
                    Math.max(
                      0,
                      Math.min(
                        1,
                        (time - word.start) / (word.end - word.start),
                      ),
                    );
          const value = `${progress.toFixed(1)}%`;
          if (element.style.getPropertyValue("--word-progress") !== value)
            element.style.setProperty("--word-progress", value);
        } else element.style.removeProperty("--word-progress");
      });
    };
    paint.current(position);
    return () => {
      paint.current = () => {};
    };
  }, [root, plan, enabled]);
  useLayoutEffect(() => {
    paint.current(position);
  }, [position, plan]);
  useEffect(() => {
    if (!active || !playing || !plan) return;
    let frame: number | null = null;
    const draw = () => {
      frame = null;
      if (document.hidden) return;
      paint.current(read.current());
      frame = requestAnimationFrame(draw);
    };
    const visible = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      paint.current(read.current());
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    visible();
    document.addEventListener("visibilitychange", visible);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [active, playing, plan]);
}
