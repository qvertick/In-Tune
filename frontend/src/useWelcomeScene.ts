import { useEffect, type RefObject } from "react";

/** One small DOM-only spotlight. No pointer state enters React. */
export function useWelcomeLight(hero: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = hero.current;
    if (!node) return;
    const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let visible = true,
      attached = false,
      frame: number | null = null,
      bounds: DOMRect | null = null,
      x = 0,
      y = 0;
    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const leave = () => {
      cancel();
      bounds = null;
      node.style.setProperty("--light-opacity", "0");
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      bounds ??= node.getBoundingClientRect();
      x = event.clientX - bounds.left;
      y = event.clientY - bounds.top;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        node.style.setProperty("--light-x", `${x}px`);
        node.style.setProperty("--light-y", `${y}px`);
        node.style.setProperty("--light-opacity", "1");
      });
    };
    const invalidate = () => {
      bounds = null;
    };
    const sync = () => {
      const dynamic = !!fine?.matches && !reduced?.matches;
      node.dataset.light = dynamic ? "pointer" : "static";
      if (!dynamic) {
        node.style.removeProperty("--light-x");
        node.style.removeProperty("--light-y");
        node.style.removeProperty("--light-opacity");
      }
      const enabled = dynamic && visible && !document.hidden;
      if (enabled && !attached) {
        node.addEventListener("pointermove", move, { passive: true });
        node.addEventListener("pointerleave", leave);
        window.addEventListener("scroll", invalidate, { passive: true });
        window.addEventListener("resize", invalidate);
        attached = true;
      }
      if (!enabled && attached) {
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerleave", leave);
        window.removeEventListener("scroll", invalidate);
        window.removeEventListener("resize", invalidate);
        attached = false;
        leave();
      }
      if (!enabled) cancel();
      const video = node.querySelector("video");
      if (video) {
        if (!visible || document.hidden || reduced?.matches) video.pause();
        else void video.play().catch(() => {});
      }
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries)
                if (entry.target === node) {
                  visible = entry.isIntersecting;
                  sync();
                }
            },
            { threshold: 0.01 },
          );
    observer?.observe(node);
    sync();
    fine?.addEventListener?.("change", sync);
    reduced?.addEventListener?.("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancel();
      observer?.disconnect();
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", invalidate);
      window.removeEventListener("resize", invalidate);
      fine?.removeEventListener?.("change", sync);
      reduced?.removeEventListener?.("change", sync);
      document.removeEventListener("visibilitychange", sync);
      node.querySelector("video")?.pause();
    };
  }, [hero]);
}
