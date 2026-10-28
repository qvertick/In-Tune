export const REWIND_MS = 350;
export function shouldRewind(
  from: number,
  to: number,
  highlighting: boolean,
  reducedMotion: boolean,
) {
  const distance = from - to;
  return (
    highlighting &&
    !reducedMotion &&
    Number.isFinite(from) &&
    Number.isFinite(to) &&
    distance >= 5 &&
    distance <= 10
  );
}

/** Presentation only. It never owns, advances, or seeks an audio element. */
export class VisualSeekClock {
  private transition: { from: number; at: number } | null = null;
  constructor(private now = () => performance.now()) {}
  get moving() {
    return this.transition !== null;
  }
  cancel() {
    this.transition = null;
  }
  begin(
    from: number,
    to: number,
    enabled: boolean,
    reduced: boolean,
    visualFrom = from,
  ) {
    this.cancel();
    if (shouldRewind(from, to, enabled, reduced))
      this.transition = { from: visualFrom, at: this.now() };
  }
  read(actual: number) {
    const transition = this.transition;
    if (!transition) return actual;
    const fraction = Math.max(0, (this.now() - transition.at) / REWIND_MS);
    if (fraction >= 1) {
      this.cancel();
      return actual;
    }
    const eased = 1 - (1 - fraction) ** 2;
    return transition.from + (actual - transition.from) * eased;
  }
}
