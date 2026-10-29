import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import "./lyricFollow.css";

export interface LyricFollowOptions {
  reader: RefObject<HTMLDivElement | null>;
  root: RefObject<HTMLElement | null>;
  playing: boolean;
  disabled: boolean;
  activeId: string | null;
  fontSize: number;
  /** Visual clock, including the caller's reverse seek transition. */
  readPosition?: () => number;
  /** A caller-owned visual transition may continue while audio is paused. */
  moving: boolean;
}

export interface LyricFollowUpdate {
  force?: boolean;
  start?: boolean;
  instant?: boolean;
}

function scrollOwner(reader: HTMLElement, root: HTMLElement): HTMLElement {
  let fallback: HTMLElement | null = null;
  for (let node: HTMLElement | null = reader; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (/^(auto|scroll|overlay)$/.test(overflow)) {
      if (node.scrollHeight > node.clientHeight + 1) return node;
      fallback ??= node;
    }
    if (node === root) break;
  }
  return fallback ?? reader;
}

function usableRects(element: Element): DOMRect[] {
  const fragments = Array.from(element.getClientRects()).filter(
    (rect) => rect.height > 0 && rect.width > 0,
  );
  if (fragments.length) return fragments;
  const bounds = element.getBoundingClientRect();
  return bounds.height > 0 && bounds.width > 0 ? [bounds] : [];
}

/** Flex word boxes can cover several visual rows; follow the painted glyph. */
function readingFragment(row: HTMLElement): DOMRect | undefined {
  const word =
    row.querySelector<HTMLElement>('[data-follow-word="true"]') ??
    row.querySelector<HTMLElement>(".word-active");
  const rawProgress = parseFloat(
    word?.style.getPropertyValue("--word-progress") || "0",
  );
  const progress = Number.isFinite(rawProgress)
    ? Math.max(0, Math.min(1, rawProgress / 100))
    : 0;
  const letters = Array.from(
    (word ?? row).querySelectorAll<HTMLElement>(".letter"),
  ).filter((letter) => letter.textContent?.replace(/[\s\u200b]/g, ""));
  if (letters.length) {
    const index = Math.min(
      letters.length - 1,
      Math.floor(progress * letters.length),
    );
    const rects = usableRects(letters[index]);
    if (rects.length)
      return rects[
        Math.min(rects.length - 1, Math.floor(progress * rects.length))
      ];
  }
  const rects = usableRects(word ?? row);
  const rect =
    rects[Math.min(rects.length - 1, Math.floor(progress * rects.length))];
  // Untimed/instrumental rows may have no glyphs. Avoid following the bottom
  // of an entire tall row when only its beginning is the reading target.
  if (rect && !word && !letters.length)
    return new DOMRect(rect.x, rect.y, rect.width, Math.min(rect.height, 32));
  return rect;
}

/**
 * Checks the caller's painted DOM at most every 80 ms while playing/moving.
 * update() is also available after an explicit visual commit. Only raw manual
 * input suspends; resume() always permits one reposition while fully paused.
 */
export function useLyricFollow(options: LyricFollowOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [suspended, setSuspended] = useState(false);
  const manuallySuspended = useRef(false);
  const mounted = useRef(false);
  const dirty = useRef(true);
  const queuedResume = useRef<number | null>(null);
  const motion = useRef<{
    frame: number;
    owner: HTMLElement;
    target: number;
  } | null>(null);
  const last = useRef<{
    row: HTMLElement;
    id: string;
    owner: HTMLElement;
  } | null>(null);

  const cancelMotion = useCallback(() => {
    if (motion.current) cancelAnimationFrame(motion.current.frame);
    motion.current = null;
  }, []);

  const moveTo = useCallback(
    (owner: HTMLElement, target: number, force: boolean, instant = false) => {
      if (
        instant ||
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ) {
        cancelMotion();
        if (Math.abs(target - owner.scrollTop) > 1)
          owner.scrollTo({ top: target, behavior: "instant" });
        return;
      }
      if (
        motion.current?.owner === owner &&
        Math.abs(motion.current.target - target) <= 1
      )
        return;
      cancelMotion();
      const from = owner.scrollTop;
      if (Math.abs(target - from) <= 1) return;
      const duration = latest.current.moving ? 160 : 220;
      let started: number | undefined;
      const tick = (timestamp: number) => {
        const current = latest.current;
        if (
          !mounted.current ||
          current.disabled ||
          manuallySuspended.current ||
          (!current.playing && !current.moving && !force)
        ) {
          motion.current = null;
          return;
        }
        started ??= timestamp;
        const progress = Math.min(
          1,
          Math.max(0, (timestamp - started) / duration),
        );
        const eased = 1 - (1 - progress) ** 3;
        owner.scrollTo({
          top: from + (target - from) * eased,
          behavior: "instant",
        });
        if (progress < 1) {
          motion.current = {
            owner,
            target,
            frame: requestAnimationFrame(tick),
          };
        } else motion.current = null;
      };
      motion.current = { owner, target, frame: requestAnimationFrame(tick) };
    },
    [cancelMotion],
  );

  const measure = useCallback(
    ({
      force = false,
      start = false,
      instant = false,
    }: LyricFollowUpdate = {}) => {
      const { reader, root, playing, moving, disabled, activeId } =
        latest.current;
      if (
        !mounted.current ||
        disabled ||
        manuallySuspended.current ||
        (!playing && !moving && !force && !start) ||
        !reader.current ||
        !root.current
      )
        return;

      const lyrics = reader.current;
      const surface = root.current;
      const owner = scrollOwner(lyrics, surface);
      if (start) {
        cancelMotion();
        if (owner.scrollTop !== 0)
          owner.scrollTo({ top: 0, behavior: "instant" });
        if (owner !== lyrics && lyrics.scrollTop !== 0)
          lyrics.scrollTo({ top: 0, behavior: "instant" });
        dirty.current = true;
        return;
      }
      if (activeId === null) return;
      const row = lyrics.querySelector<HTMLElement>(
        '[data-follow-row="true"]',
      ) ?? lyrics.querySelector<HTMLElement>('.player-line[aria-current="step"]');
      if (!row) return;
      const ownerRect = owner.getBoundingClientRect();
      const rootRect = surface.getBoundingClientRect();
      const readerRect = lyrics.getBoundingClientRect();
      let top = Math.max(0, rootRect.top, ownerRect.top + owner.clientTop);
      let bottom = Math.min(
        window.innerHeight,
        rootRect.bottom,
        owner.clientHeight
          ? ownerRect.top + owner.clientTop + owner.clientHeight
          : ownerRect.bottom,
      );
      const transport = surface.querySelector<HTMLElement>(".player-transport");
      if (transport) {
        const rect = transport.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > top)
          bottom = Math.min(bottom, rect.top);
      }
      // An offscreen reader under timing tools must still be scrollable into view.
      if (readerRect.bottom > top && readerRect.top < bottom) {
        top = Math.max(top, readerRect.top);
        bottom = Math.min(bottom, readerRect.bottom);
      }
      const height = bottom - top;
      if (height <= 1) return;
      const fragment = readingFragment(row);
      if (!fragment) return;
      const changed =
        dirty.current ||
        last.current?.row !== row ||
        last.current?.id !== activeId ||
        last.current?.owner !== owner;
      const outside =
        fragment.top < top + height * 0.1 ||
        fragment.bottom > top + height * 0.65;
      dirty.current = false;
      last.current = { row, id: activeId, owner };
      if (!force && !changed && !outside) return;
      const target =
        top + Math.min(height * 0.3, Math.max(0, height - fragment.height));
      const next = Math.max(
        0,
        Math.min(
          Math.max(0, owner.scrollHeight - owner.clientHeight),
          owner.scrollTop + fragment.top - target,
        ),
      );
      // A local cancellable tween overrides inherited scroll-behavior:smooth.
      moveTo(owner, next, force, instant);
    },
    [cancelMotion, moveTo],
  );

  const update = useCallback(
    (settings: LyricFollowUpdate = {}) => measure(settings),
    [measure],
  );
  const resume = useCallback(
    (settings: LyricFollowUpdate = {}) => {
      if (!mounted.current) return;
      manuallySuspended.current = false;
      setSuspended(false);
      dirty.current = true;
      if (queuedResume.current !== null)
        cancelAnimationFrame(queuedResume.current);
      // A seek may update activeId and aria-current in the same event. Wait until
      // React has committed them before selecting the new visual reading target.
      queuedResume.current = requestAnimationFrame(() => {
        queuedResume.current = null;
        measure({ ...settings, force: settings.force ?? true });
      });
    },
    [measure],
  );

  useLayoutEffect(() => {
    mounted.current = true;
    const surface = options.root.current;
    const lyrics = options.reader.current;
    if (!surface || !lyrics)
      return () => {
        mounted.current = false;
      };
    const suspend = () => {
      if (latest.current.disabled || manuallySuspended.current) return;
      cancelMotion();
      if (queuedResume.current !== null)
        cancelAnimationFrame(queuedResume.current);
      queuedResume.current = null;
      manuallySuspended.current = true;
      setSuspended(true);
    };
    const withinOwner = (target: EventTarget | null) => {
      const owner = scrollOwner(lyrics, surface);
      return (
        target instanceof Node && (owner === target || owner.contains(target))
      );
    };
    const manual = (event: Event) => {
      if (withinOwner(event.target)) suspend();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !["PageUp", "PageDown", "Home", "End"].includes(event.key)
      )
        return;
      const target = event.target;
      const owner = scrollOwner(lyrics, surface);
      // Child buttons, inputs and editable tools retain their keyboard actions.
      if (
        (target === lyrics || target === owner) &&
        (document.activeElement === lyrics || document.activeElement === owner)
      )
        suspend();
    };
    const pointer = (event: PointerEvent) => {
      const owner = scrollOwner(lyrics, surface);
      if (event.target !== owner || event.button !== 0) return;
      const rect = owner.getBoundingClientRect();
      const left = rect.left + owner.clientLeft;
      const right = left + owner.clientWidth;
      const bottom = rect.top + owner.clientTop + owner.clientHeight;
      // Native scrollbar gutters, including an RTL scrollbar on the left.
      if (
        (event.clientX >= Math.min(right, rect.right - 8) &&
          event.clientX <= rect.right) ||
        (event.clientX >= rect.left && event.clientX < left) ||
        (event.clientY >= bottom && event.clientY <= rect.bottom)
      )
        suspend();
    };
    const invalidate = () => {
      dirty.current = true;
      update(); // Fully paused or manually suspended: record invalidation only.
    };
    surface.addEventListener("wheel", manual, { passive: true, capture: true });
    surface.addEventListener("touchstart", manual, {
      passive: true,
      capture: true,
    });
    surface.addEventListener("pointerdown", pointer, true);
    surface.addEventListener("keydown", keyboard);
    window.addEventListener("resize", invalidate);
    document.addEventListener("fullscreenchange", invalidate);
    const fonts = document.fonts;
    fonts?.addEventListener("loadingdone", invalidate);
    let disposed = false;
    void fonts?.ready.then(() => {
      if (!disposed) invalidate();
    });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(invalidate);
    for (const element of new Set([
      surface,
      lyrics,
      lyrics.closest(".player-main"),
      surface.querySelector(".player-transport"),
    ]))
      if (element) observer?.observe(element);
    update();
    return () => {
      mounted.current = false;
      cancelMotion();
      if (queuedResume.current !== null)
        cancelAnimationFrame(queuedResume.current);
      queuedResume.current = null;
      disposed = true;
      surface.removeEventListener("wheel", manual, true);
      surface.removeEventListener("touchstart", manual, true);
      surface.removeEventListener("pointerdown", pointer, true);
      surface.removeEventListener("keydown", keyboard);
      window.removeEventListener("resize", invalidate);
      document.removeEventListener("fullscreenchange", invalidate);
      fonts?.removeEventListener("loadingdone", invalidate);
      observer?.disconnect();
    };
  }, [options.reader, options.root, update, cancelMotion]);

  useLayoutEffect(() => {
    if ((!options.playing && !options.moving) || options.disabled)
      cancelMotion();
    if (options.disabled && queuedResume.current !== null) {
      cancelAnimationFrame(queuedResume.current);
      queuedResume.current = null;
    }
  }, [options.playing, options.moving, options.disabled, cancelMotion]);

  useLayoutEffect(() => {
    dirty.current = true;
    update();
  }, [
    options.activeId,
    options.fontSize,
    options.disabled,
    options.playing,
    options.moving,
    update,
  ]);

  useLayoutEffect(() => {
    if ((!options.playing && !options.moving) || options.disabled || suspended)
      return;
    let frame: number | null = null;
    let previousCheck = -Infinity;
    let previousPosition: number | undefined;
    const tick = (timestamp: number) => {
      frame = null;
      if (document.hidden || !mounted.current) return;
      if (timestamp - previousCheck >= 80) {
        previousCheck = timestamp;
        const position = latest.current.readPosition?.();
        if (
          position === undefined ||
          position !== previousPosition ||
          dirty.current
        )
          update();
        previousPosition = position;
      }
      frame = requestAnimationFrame(tick);
    };
    const visible = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      previousCheck = -Infinity;
      previousPosition = undefined;
      if (!document.hidden) frame = requestAnimationFrame(tick);
    };
    visible();
    document.addEventListener("visibilitychange", visible);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [options.playing, options.moving, options.disabled, suspended, update]);

  return { suspended, update, resume };
}
