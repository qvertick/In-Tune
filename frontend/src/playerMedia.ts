import { useEffect, useRef, useState } from "react";
import { TextClock, finiteTime } from "./playerTiming";

export type MixMode =
  | "original"
  | "vocals"
  | "accompaniment"
  | "custom"
  | "text";
export type Stems = {
  ready: boolean;
  vocalsUrl?: string;
  accompanimentUrl?: string;
  duration?: number;
  error?: string;
};
export type StemMix = { volume: number; muted: boolean };
export function usePlayerMedia(
  key: string,
  originalUrl: string | undefined,
  stems: Stems | null,
  textDuration: number,
) {
  const original = useRef<HTMLAudioElement>(null),
    vocals = useRef<HTMLAudioElement>(null),
    accompaniment = useRef<HTMLAudioElement>(null);
  const [mode, setModeState] = useState<MixMode>(
    originalUrl ? "original" : "text",
  );
  const [position, setPosition] = useState(0),
    [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false),
    [buffering, setBuffering] = useState(false);
  const [jump, setJump] = useState<{
    source: "user" | "internal";
    sequence: number;
  }>({ source: "internal", sequence: 0 });
  const [error, setError] = useState(""),
    [rate, setRateState] = useState(1),
    [volume, setVolume] = useState(0.8);
  const [vocalMix, setVocalMix] = useState<StemMix>({
    volume: 1,
    muted: false,
  });
  const [backingMix, setBackingMix] = useState<StemMix>({
    volume: 1,
    muted: false,
  });
  const [loop, setLoop] = useState<{ a: number; b: number; enabled: boolean }>({
    a: 0,
    b: 0,
    enabled: false,
  });
  const clock = useRef(new TextClock()),
    generation = useRef(0),
    desired = useRef(0);
  const wanted = useRef(false),
    previewUntil = useRef<number | null>(null);
  const stalled = useRef(new Set<HTMLAudioElement>()),
    suspended = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const state = useRef({
    mode,
    rate,
    volume,
    vocalMix,
    backingMix,
    loop,
    textDuration,
  });
  state.current = {
    mode,
    rate,
    volume,
    vocalMix,
    backingMix,
    loop,
    textDuration,
  };
  const all = () =>
    [original.current, vocals.current, accompaniment.current].filter(
      (a): a is HTMLAudioElement => !!a,
    );
  function master(selected = modeRef.current) {
    return selected === "original"
      ? original.current
      : selected === "vocals"
        ? vocals.current
        : selected === "text"
          ? null
          : accompaniment.current;
  }
  function group(selected = modeRef.current) {
    return (
      selected === "custom"
        ? [vocals.current, accompaniment.current]
        : [master(selected)]
    ).filter((a): a is HTMLAudioElement => !!a);
  }
  function readPosition() {
    return modeRef.current === "text"
      ? clock.current.position()
      : (master()?.currentTime ?? desired.current);
  }
  function pause() {
    wanted.current = false;
    stalled.current.clear();
    suspended.current = false;
    generation.current++;
    clock.current.pause();
    all().forEach((audio) => audio.pause());
    setPosition(readPosition());
    setPlaying(false);
    setBuffering(false);
  }
  function seek(time: number, source: "user" | "internal" = "internal") {
    if (!finiteTime(time)) return;
    previewUntil.current = null;
    const length =
      modeRef.current === "text"
        ? state.current.textDuration
        : master()?.duration;
    const next =
      finiteTime(length) && length > 0 ? Math.min(time, length) : time;
    desired.current = next;
    clock.current.seek(next);
    all().forEach((audio) => {
      try {
        audio.currentTime = next;
      } catch {
        /* loadedmetadata retries pending seeks */
      }
    });
    setPosition(next);
    setJump((previous) => ({ source, sequence: previous.sequence + 1 }));
    return next;
  }
  function configure(selected = modeRef.current) {
    const current = state.current,
      active = group(selected);
    all().forEach((audio) => {
      audio.playbackRate = current.rate;
      audio.preservesPitch = true;
      const mix =
        audio === vocals.current ? current.vocalMix : current.backingMix;
      audio.volume =
        current.volume * (audio === original.current ? 1 : mix.volume);
      audio.muted =
        !active.includes(audio) || (audio !== original.current && mix.muted);
    });
  }
  async function play(selected = modeRef.current) {
    const request = ++generation.current;
    wanted.current = true;
    setError("");
    if (selected === "text") {
      if (state.current.textDuration <= 0) return;
      if (clock.current.position() >= state.current.textDuration)
        clock.current.seek(0);
      clock.current.play();
      setPlaying(true);
      return;
    }
    const active = group(selected),
      primary = master(selected);
    if (
      !primary?.getAttribute("src") ||
      active.some((a) => !a.getAttribute("src"))
    ) {
      setError(
        "Аудиодорожка недоступна. Выберите оригинал или подготовьте дорожки.",
      );
      return;
    }
    configure(selected);
    all()
      .filter((audio) => !active.includes(audio))
      .forEach((audio) => audio.pause());
    if (primary.ended) seek(0);
    active.forEach((audio) => {
      if (audio !== primary) audio.currentTime = primary.currentTime;
    });
    setBuffering(true);
    try {
      // Invoke every play() inside the user gesture, including both custom stems.
      await Promise.all(active.map((audio) => audio.play()));
      if (request !== generation.current) {
        const currentGroup = group();
        active
          .filter(
            (audio) =>
              !wanted.current ||
              !currentGroup.includes(audio) ||
              modeRef.current === "text",
          )
          .forEach((audio) => audio.pause());
        return;
      }
      if (suspended.current) return;
      setPlaying(!primary.paused);
      setBuffering(false);
    } catch {
      if (request !== generation.current) return;
      pause();
      setError(
        "Не удалось включить аудио. Проверьте файл и нажмите «Воспроизвести» ещё раз.",
      );
    }
  }
  function changeMode(next: MixMode) {
    if (next === modeRef.current) return;
    const time = readPosition(),
      resume =
        modeRef.current === "text"
          ? clock.current.running
          : wanted.current || !master()?.paused;
    pause();
    modeRef.current = next;
    setModeState(next);
    seek(time);
    configure(next);
    if (resume) void play(next);
  }
  function listen(from: number, to?: number) {
    seek(Math.max(0, from - 0.5));
    previewUntil.current = finiteTime(to) ? to + 0.5 : null;
    void play();
  }
  function setRate(next: number) {
    if (!Number.isFinite(next) || next < 0.5 || next > 1.5) return;
    clock.current.setRate(next);
    setRateState(next);
    all().forEach((audio) => {
      audio.playbackRate = next;
      audio.preservesPitch = true;
    });
  }
  const latest = useRef({
    pause,
    seek,
    readPosition,
    configure,
    master,
    group,
  });
  latest.current = { pause, seek, readPosition, configure, master, group };
  function sample() {
    const current = state.current,
      primary = master();
    let time = readPosition();
    const running =
      current.mode === "text"
        ? clock.current.running
        : primary && !primary.paused && !primary.ended;
    if (
      running &&
      previewUntil.current !== null &&
      time >= previewUntil.current
    ) {
      previewUntil.current = null;
      pause();
      return;
    }
    if (
      running &&
      current.loop.enabled &&
      current.loop.b > current.loop.a &&
      time >= current.loop.b
    ) {
      seek(current.loop.a);
      time = current.loop.a;
    } else if (
      current.mode === "text" &&
      clock.current.running &&
      time >= current.textDuration
    ) {
      clock.current.seek(current.textDuration);
      clock.current.pause();
      setPlaying(false);
      time = current.textDuration;
    }
    if (primary && running && !primary.seeking && primary.readyState >= 2)
      group().forEach((audio) => {
        if (
          audio !== primary &&
          audio.readyState >= 2 &&
          Math.abs(audio.currentTime - time) > 0.05
        )
          audio.currentTime = time;
      });
    if (Number.isFinite(time)) {
      desired.current = time;
      setPosition(time);
    }
    const length =
      current.mode === "text" ? current.textDuration : primary?.duration;
    setDuration(finiteTime(length) ? length : 0);
  }
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  useEffect(() => {
    configure();
  }, [mode, volume, vocalMix, backingMix, stems]);
  useEffect(() => {
    let frame = 0,
      last = 0;
    const draw = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      if (now - last >= 100) {
        sampleRef.current();
        last = now;
      }
      frame = requestAnimationFrame(draw);
    };
    if ((playing || buffering) && !document.hidden)
      frame = requestAnimationFrame(draw);
    const visible = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      sampleRef.current();
      if ((playing || buffering) && !document.hidden)
        frame = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", visible);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", visible);
    };
  }, [playing, buffering]);
  useEffect(() => {
    const mountedAudio = all();
    return () => {
      latest.current.pause();
      mountedAudio.forEach((audio) => audio.pause());
    };
  }, []);
  useEffect(() => {
    latest.current.pause();
    clock.current.seek(0);
    desired.current = 0;
    modeRef.current = originalUrl ? "original" : "text";
    setModeState(modeRef.current);
    setPosition(0);
    setDuration(0);
    setError("");
    setLoop({ a: 0, b: 0, enabled: false });
  }, [key, originalUrl]);
  function events(kind: "original" | "vocals" | "accompaniment") {
    const element = () =>
      kind === "original"
        ? original.current
        : kind === "vocals"
          ? vocals.current
          : accompaniment.current;
    const isMaster = () => element() === master();
    const isActive = () => group().includes(element()!);
    const ready = () => {
      const audio = element();
      if (!audio || !isActive()) return;
      stalled.current.delete(audio);
      if (suspended.current && !stalled.current.size && wanted.current) {
        suspended.current = false;
        void play();
      }
    };
    return {
      onLoadedMetadata: () => {
        const audio = element();
        if (audio) audio.currentTime = desired.current;
        configure();
        sample();
      },
      onDurationChange: () => sample(),
      onTimeUpdate: () => {
        if (isMaster()) sample();
      },
      onSeeked: () => {
        if (isMaster()) {
          const time = master()!.currentTime;
          group().forEach((audio) => {
            if (audio !== master()) audio.currentTime = time;
          });
          sample();
        }
      },
      onPlay: () => {
        if (!isActive() || !wanted.current) {
          element()?.pause();
          return;
        }
        if (isMaster()) {
          setPlaying(true);
        }
      },
      onPause: () => {
        if (!isActive()) return;
        if (!suspended.current && wanted.current) {
          wanted.current = false;
          generation.current++;
          group()
            .filter((audio) => audio !== element())
            .forEach((audio) => audio.pause());
          setBuffering(false);
        }
        if (isMaster() || !suspended.current) {
          setPlaying(false);
          sample();
        }
      },
      onWaiting: () => {
        const audio = element();
        if (!audio || !isActive() || !wanted.current) return;
        stalled.current.add(audio);
        suspended.current = true;
        setBuffering(true);
        group().forEach((track) => track.pause());
      },
      onCanPlay: ready,
      onPlaying: () => {
        if (!isActive() || !wanted.current) {
          element()?.pause();
          return;
        }
        ready();
        if (!isMaster()) return;
        if (suspended.current) return;
        setBuffering(false);
        setPlaying(true);
        group()
          .filter((audio) => audio !== master())
          .forEach((audio) => {
            audio.currentTime = master()!.currentTime;
            if (audio.paused)
              void audio.play().catch(() => {
                pause();
                setError("Дорожка не включилась. Повторите воспроизведение.");
              });
          });
      },
      onEnded: () => {
        if (!isActive()) return;
        const primary = master();
        const at = primary?.currentTime ?? 0;
        if (
          state.current.loop.enabled &&
          state.current.loop.b > state.current.loop.a &&
          at >= state.current.loop.b - 0.05
        ) {
          seek(state.current.loop.a);
          void play();
        } else {
          const early =
            !isMaster() &&
            primary &&
            (!finiteTime(primary.duration) || at < primary.duration - 0.1);
          pause();
          sample();
          if (early)
            setError(
              "Одна из дорожек закончилась раньше другой. Микс остановлен; выберите оригинал или подготовьте дорожки заново.",
            );
        }
      },
      onError: () => {
        if (!group().includes(element()!)) return;
        pause();
        setError(
          "Не удалось загрузить аудиодорожку. Проверьте файл или вернитесь к оригиналу.",
        );
      },
    };
  }
  return {
    original,
    vocals,
    accompaniment,
    mode,
    changeMode,
    position,
    duration,
    playing,
    buffering,
    error,
    rate,
    setRate,
    volume,
    setVolume,
    vocalMix,
    setVocalMix,
    backingMix,
    setBackingMix,
    loop,
    setLoop,
    play,
    pause,
    seek,
    listen,
    readPosition,
    events,
    jump,
  };
}
