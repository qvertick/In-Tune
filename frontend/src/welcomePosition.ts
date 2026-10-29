import { useEffect, type RefObject } from "react";

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
export function sectionAt(tops: number[], anchor: number) {
  let active = 0;
  tops.forEach((top, i) => {
    if (top <= anchor) active = i;
  });
  return active;
}
export function nearestStep(centers: number[], anchor: number) {
  return centers.reduce(
    (best, center, i) =>
      Math.abs(center - anchor) < Math.abs(centers[best] - anchor) ? i : best,
    0,
  );
}

/** Measure on layout changes; a scroll frame only reads the cached geometry. */
export function useWelcomePosition(page: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = page.current;
    if (!root) return;
    const sections = [
      ...root.querySelectorAll<HTMLElement>("[data-welcome-section]"),
    ];
    const marks = [
      ...root.querySelectorAll<HTMLElement>("[data-section-mark]"),
    ];
    const steps = [
      ...root.querySelectorAll<HTMLElement>("[data-workflow-step]"),
    ];
    let tops: number[] = [],
      centers: number[] = [],
      maxScroll = 1;
    let frame: number | null = null,
      dirty = true,
      section = -1,
      step = -1;
    const draw = () => {
      frame = null;
      if (document.hidden) return;
      const y = window.scrollY;
      if (dirty) {
        tops = sections.map((el) => el.getBoundingClientRect().top + y);
        centers = steps.map((el) => {
          const r = el.getBoundingClientRect();
          return r.top + y + r.height / 2;
        });
        maxScroll = Math.max(
          1,
          document.documentElement.scrollHeight - window.innerHeight,
        );
        dirty = false;
      }
      const next = sectionAt(tops, y + window.innerHeight * 0.35);
      if (next !== section) {
        section = next;
        marks.forEach((el, i) => {
          if (i === next) el.setAttribute("aria-current", "location");
          else el.removeAttribute("aria-current");
          el.dataset.passed = String(i < next);
        });
      }
      root.style.setProperty("--page-progress", String(clamp01(y / maxScroll)));
      const nextStep = nearestStep(centers, y + window.innerHeight * 0.48);
      if (nextStep !== step) {
        step = nextStep;
        steps.forEach((el, i) => {
          if (i === nextStep) el.setAttribute("aria-current", "step");
          else el.removeAttribute("aria-current");
        });
      }
    };
    const schedule = () => {
      if (frame === null && !document.hidden)
        frame = requestAnimationFrame(draw);
    };
    const measure = () => {
      dirty = true;
      schedule();
    };
    const visibility = () => {
      if (document.hidden && frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      if (!document.hidden) measure();
    };
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    sections.forEach((el) => resize?.observe(el));
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", measure);
    document.addEventListener("visibilitychange", visibility);
    measure();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [page]);
}
