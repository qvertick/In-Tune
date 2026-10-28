import type { Line, Song } from "./model";

export const normalized = (s: string) =>
  s
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]/gu, "");
export function validWords(line: Line) {
  const tokens = line.text.match(/\S+/gu) || [];
  return (
    !line.timingReview &&
    !!line.words?.length &&
    tokens.length === line.words.length &&
    line.words.every(
      (w, i, all) =>
        normalized(w.text) === normalized(tokens[i]) &&
        w.end > w.start &&
        w.start >= (line.start ?? 0) &&
        w.end <= (line.end ?? Infinity) &&
        (i === 0 || w.start >= all[i - 1].end),
    )
  );
}
export function validWordStarts(line: Line) {
  const tokens = line.text.match(/\S+/gu) ?? [];
  return (
    !line.timingReview &&
    !!line.wordStarts?.length &&
    tokens.length === line.wordStarts.length &&
    line.wordStarts.every(
      (word, i, all) =>
        normalized(word.text) === normalized(tokens[i]) &&
        Number.isFinite(word.start) &&
        word.start >= (line.start ?? 0) &&
        word.start < (line.end ?? Infinity) &&
        (word.end === undefined ||
          (Number.isFinite(word.end) &&
            word.end > word.start &&
            word.end <= (line.end ?? Infinity))) &&
        (i === 0 ||
          (word.start > all[i - 1].start &&
            word.start >= (all[i - 1].end ?? all[i - 1].start))),
    )
  );
}
export type TimedLine = {
  line: Line;
  start: number;
  end: number;
  vocal: boolean;
};
export function timeline(song: Song): TimedLine[] {
  const lines = song.sections.flatMap((s) => s.lines);
  return lines
    .flatMap((line, i) => {
      if (line.timingReview) return [];
      const words = validWords(line) ? line.words : undefined;
      const start = line.start ?? words?.[0].start;
      // A next-line boundary is useful for line-only maps, but is NOT a known vocal gap.
      const end =
        line.end ??
        words?.at(-1)?.end ??
        lines[i + 1]?.start ??
        song.audio?.duration;
      return start !== undefined && end !== undefined && end > start
        ? [{ line, start, end, vocal: !!line.text.trim() }]
        : [];
    })
    .sort((a, b) => a.start - b.start);
}
export type Anchor = {
  songTime: number;
  audioTime: number;
  capturedAt: number;
  uncertainty?: number;
};
export class PerformanceClock {
  private base = 0;
  private at = 0;
  speed = 1;
  running = false;
  generation = 0;
  state = "Прогноз по карте";
  correction = 0;
  confirmed: number | null = null;
  private lastAudio = -Infinity;
  private lastCorrection = -Infinity;
  private slew = 0;
  private pairs: Anchor[] = [];
  private recovery: Anchor | null = null;
  private budgetAt = 0;
  private vocalBudget = 0;
  private held = false;
  constructor(private now = () => performance.now() / 1000) {}
  get countIn() {
    return this.running ? Math.max(0, Math.ceil(this.at - this.now())) : 0;
  }
  position(t = this.now()) {
    const dt = this.running ? Math.max(0, t - this.at) : 0;
    return Math.max(
      0,
      this.base + dt * this.speed + Math.min(dt, 2) * this.slew,
    );
  }
  private rebase() {
    this.base = this.position();
    this.at = this.now();
    this.slew = 0;
  }
  seek(position: number) {
    this.base = Math.max(0, position);
    this.at = this.now();
    this.slew = 0;
    this.generation++;
    this.pairs = [];
    this.recovery = null;
    this.confirmed = null;
    this.lastAudio = -Infinity;
    this.lastCorrection = -Infinity;
    this.vocalBudget = 0;
    this.budgetAt = this.base;
    this.held = false;
    this.state = "Прогноз по карте";
  }
  start(delay = 0) {
    if (this.running) return;
    this.at = this.now() + delay;
    this.running = true;
    this.held = false;
  }
  pause() {
    this.rebase();
    this.running = false;
    this.held = false;
  }
  setSpeed(speed: number) {
    this.rebase();
    this.speed = Math.max(0.5, Math.min(1.5, speed));
    this.pairs = [];
  }
  correct(anchor: Anchor, generation: number) {
    const now = this.now(),
      age = now - anchor.capturedAt;
    if (
      generation !== this.generation ||
      (!this.running && !this.held) ||
      age < 0 ||
      age > 5 ||
      anchor.audioTime <= this.lastAudio ||
      now - this.lastCorrection < 0.8
    )
      return false;
    const target = anchor.songTime + age * this.speed;
    const difference = target - this.position();
    const error =
      Math.sign(difference) *
      Math.max(0, Math.abs(difference) - (anchor.uncertainty ?? 0));
    if (Math.abs(error) > 3) {
      const previous = this.recovery;
      this.recovery = anchor;
      this.state = "Уточняю место";
      if (
        !previous ||
        anchor.audioTime - previous.audioTime < 0.5 ||
        Math.abs(
          anchor.songTime -
            previous.songTime -
            (anchor.audioTime - previous.audioTime) * this.speed,
        ) > 1
      )
        return false;
      this.base = target;
      this.at = now;
      this.slew = 0;
      this.pairs = [];
    } else {
      this.rebase();
      this.slew = Math.max(-0.15, Math.min(0.15, error / 2));
    }
    this.recovery = null;
    if (!anchor.uncertainty) this.pairs.push(anchor);
    this.pairs = this.pairs.slice(-5);
    if (this.pairs.length >= 3) {
      const first = this.pairs[0],
        last = this.pairs.at(-1)!;
      const elapsed = last.audioTime - first.audioTime;
      const estimate = (last.songTime - first.songTime) / elapsed;
      if (elapsed >= 2 && estimate >= 0.5 && estimate <= 1.5)
        this.speed += Math.max(
          -0.03,
          Math.min(0.03, (estimate - this.speed) * 0.25),
        );
    }
    this.lastAudio = anchor.audioTime;
    this.lastCorrection = now;
    this.confirmed = anchor.songTime;
    this.correction = error;
    this.vocalBudget = 0;
    this.budgetAt = this.position();
    if (this.held) {
      this.running = true;
      this.at = now;
      this.held = false;
    }
    this.state = anchor.uncertainty
      ? "Подтверждена строка · время приблизительное"
      : "Подтверждено голосом";
    return true;
  }
  tick(map: TimedLine[], follow: boolean) {
    const p = this.position();
    if (this.running && follow) {
      // Count map time WITH expected vocals, even if the page skipped animation frames.
      for (const entry of map)
        if (entry.vocal)
          this.vocalBudget += Math.max(
            0,
            Math.min(p, entry.end) - Math.max(this.budgetAt, entry.start),
          );
      this.budgetAt = p;
      if (this.vocalBudget > 6) {
        this.rebase();
        this.running = false;
        this.held = true;
        this.state = "Потеряно место — выберите строку или дождитесь голоса";
      } else if (!map.some((e) => e.vocal && p >= e.start && p < e.end))
        this.state = "Ожидаемый проигрыш · прогноз";
      else if (this.vocalBudget > 3)
        this.state = "Нет подтверждения голоса · прогноз";
    }
    const end = map.at(-1)?.end;
    if (end !== undefined && p >= end) {
      this.base = end;
      this.at = this.now();
      this.running = false;
    }
    return this.position();
  }
}
