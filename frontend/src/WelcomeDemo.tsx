import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, ArrowRight } from "lucide-react";
import { useI18n } from "./i18n";

// Hand-authored timing of this silent example, unrelated to user audio.
export function demoTimeline(lines: string[]) {
  let time = 0;
  const durations = [3600, 3600, 4200, 3200];
  const words = lines.flatMap((text, line) => {
    const tokens = text.split(/\s+/);
    const duration = durations[line] / tokens.length;
    const result = tokens.map((text, word) => ({
      text,
      line,
      word,
      start: time + word * duration,
      end: time + (word + 1) * duration,
    }));
    time += durations[line] + 400;
    return result;
  });
  return { words, duration: time + 1200 };
}

export default function WelcomeDemo() {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const lines = [
    t("Расскажи мне историю этого мира,"),
    t("Удивись количеству прожитых лет,"),
    t("Расскажи, каково быть мишенью в тире,"),
    t("И как выглядит пуля, летящая в свет."),
  ];
  const plan = useMemo(() => demoTimeline(lines), [lines.join("\n")]);
  const [visible, setVisible] = useState(false),
    [paused, setPaused] = useState(false),
    [position, setPosition] = useState(0),
    [revision, setRevision] = useState(0);
  const [reduced, setReduced] = useState(
    () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  const elapsed = useRef(0);
  const epoch = useRef(0);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(!!media?.matches);
    media?.addEventListener?.("change", change);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries)
                setVisible(
                  entry.isIntersecting && entry.intersectionRatio >= 0.35,
                );
            },
            { threshold: [0, 0.35] },
          );
    if (root.current) observer?.observe(root.current);
    if (!observer) setVisible(true);
    return () => {
      observer?.disconnect();
      media?.removeEventListener?.("change", change);
    };
  }, []);
  useEffect(() => {
    elapsed.current = 0;
    epoch.current++;
    setPosition(0);
  }, [plan]);
  useEffect(() => {
    if (!visible || paused || reduced) return;
    const generation = epoch.current;
    let timer: ReturnType<typeof setTimeout> | undefined,
      anchor: number | null = null;
    const boundaries = [
      ...new Set([
        0,
        ...plan.words.flatMap((w) => [w.start, w.end]),
        plan.duration,
      ]),
    ].sort((a, b) => a - b);
    const save = () => {
      if (anchor !== null && generation === epoch.current)
        elapsed.current =
          (elapsed.current + performance.now() - anchor) % plan.duration;
      anchor = null;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const tick = () => {
      if (document.hidden || anchor === null) return;
      const now =
        (elapsed.current + performance.now() - anchor) % plan.duration;
      setPosition(now);
      const next = boundaries.find((b) => b > now + 0.5) ?? plan.duration;
      timer = setTimeout(tick, Math.max(16, next - now + 1));
    };
    const visibility = () => {
      save();
      if (!document.hidden) {
        anchor = performance.now();
        tick();
      }
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      save();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [plan, visible, paused, reduced, revision]);
  const current = plan.words.find(
    (w) => position >= w.start && position < w.end,
  );
  const line =
    current?.line ??
    (position < plan.words.at(-1)!.end
      ? plan.words.filter((w) => w.start <= position).at(-1)?.line
      : undefined);
  useEffect(() => {
    // One local move on a line boundary, never one move per word or frame.
    const score = root.current?.querySelector<HTMLElement>(".demo-score");
    const row = score?.querySelector<HTMLElement>("p.is-current");
    if (!score || !row || score.scrollHeight <= score.clientHeight) return;
    const top = row.offsetTop - score.offsetTop - 12;
    score.scrollTo?.({
      top: Math.max(0, top),
      behavior: reduced ? "instant" : "smooth",
    });
  }, [line, reduced]);
  return (
    <div
      ref={root}
      className="welcome-demo"
      data-demo-running={visible && !paused && !reduced}
    >
      <div className="demo-caption">
        <span>
          <span className="local-dot" />
          {t("В.Цой - группа кино  (Вопрос)")}
        </span>
        <span>{t("Демонстрация · без звука")}</span>
      </div>
      <div className="demo-score" aria-label={t("Пример текста с аккордами")}>
        {lines.map((text, i) => (
          <p key={i} className={line === i ? "is-current" : ""}>
            {text.split(/\s+/).map((word, j) => {
              const chord =
                j === 0
                  ? ["Am", "F", "C", "G"][i]
                  : j === 3
                    ? ["G", "Am", "G", "C"][i]
                    : "";
              const activeChord =
                current?.line === i && (current.word < 3 ? j === 0 : j === 3);
              return (
                <span
                  key={j}
                  className={`demo-word${current?.line === i && j <= current.word ? " is-reached" : ""}${current?.line === i && j === current.word ? " is-current-word" : ""}`}
                >
                  {chord && (
                    <span
                      className={`demo-chord${activeChord ? " is-current-chord" : ""}`}
                      aria-hidden="true"
                    >
                      {chord}
                    </span>
                  )}
                  {word}{" "}
                </span>
              );
            })}
          </p>
        ))}
      </div>
      <div className="demo-bottom">
        <div className="demo-actions">
          {!reduced && (
            <button
              type="button"
              aria-pressed={paused}
              onClick={() => setPaused(!paused)}
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}{" "}
              {paused ? t("Продолжить") : t("Пауза")}
            </button>
          )}
          {reduced && (
            <button
              type="button"
              onClick={() => {
                const next = ((line ?? -1) + 1) % lines.length;
                setPosition(plan.words.find((w) => w.line === next)!.start);
              }}
            >
              <ArrowRight size={15} />
              {t("Следующая строка")}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              epoch.current++;
              elapsed.current = 0;
              setPosition(0);
              setRevision((n) => n + 1);
            }}
          >
            <RotateCcw size={15} />
            {t("Сначала")}
          </button>
        </div>
        <span>{t("Времена примера заданы вручную. Без звука.")}</span>
      </div>
    </div>
  );
}
