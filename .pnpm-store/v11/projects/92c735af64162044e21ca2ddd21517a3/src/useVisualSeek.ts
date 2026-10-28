import { useCallback, useEffect, useRef, useState } from "react";
import { VisualSeekClock } from "./visualSeek";

export function useVisualSeek(
  readActual: () => number,
  boundaryKey: (time: number) => string,
  highlighting: boolean,
) {
  const inputs = useRef({ readActual, boundaryKey, highlighting });
  inputs.current = { readActual, boundaryKey, highlighting };
  const clock = useRef(new VisualSeekClock()),
    frame = useRef<number | null>(null);
  const [moving, setMoving] = useState(false),
    [revision, refresh] = useState(0);
  const read = useCallback(
    () => clock.current.read(inputs.current.readActual()),
    [],
  );
  const stopFrame = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const cancel = useCallback(() => {
    stopFrame();
    clock.current.cancel();
    setMoving(false);
    refresh((value) => value + 1);
  }, [stopFrame]);
  const begin = useCallback(
    (from: number, to: number, visualFrom = from) => {
      stopFrame();
      clock.current.begin(
        from,
        to,
        inputs.current.highlighting,
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
          false,
        visualFrom,
      );
      setMoving(clock.current.moving);
      refresh((value) => value + 1);
      if (!clock.current.moving) return false;
      let key = inputs.current.boundaryKey(read());
      const draw = () => {
        frame.current = null;
        if (document.hidden) {
          cancel();
          return;
        }
        const next = inputs.current.boundaryKey(read());
        // React changes only at line/word boundaries, not on each animation frame.
        if (next !== key) {
          key = next;
          refresh((value) => value + 1);
        }
        if (clock.current.moving) frame.current = requestAnimationFrame(draw);
        else {
          setMoving(false);
          refresh((value) => value + 1);
        }
      };
      frame.current = requestAnimationFrame(draw);
      return true;
    },
    [read, stopFrame, cancel],
  );
  useEffect(() => {
    if (!highlighting) cancel();
  }, [highlighting, cancel]);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reduced = () => {
      if (media?.matches) cancel();
    };
    const hidden = () => {
      if (document.hidden && clock.current.moving) cancel();
    };
    media?.addEventListener?.("change", reduced);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      stopFrame();
      clock.current.cancel();
      media?.removeEventListener?.("change", reduced);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [cancel, stopFrame]);
  return { read, begin, cancel, moving, revision };
}
