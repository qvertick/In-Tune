import { useEffect, useMemo, useRef, useState } from "react";
import { Lyrics } from "./App";
import type { Song } from "./model";
import { PerformanceClock, timeline, validWords } from "./timeline";
import TimingEditor from "./TimingEditor";
import { useVoiceFollow } from "./useVoiceFollow";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Play,
  Pause,
  Square,
  Mic,
  MicOff,
} from "lucide-react";

type Props = {
  song: Song;
  onBack: () => void;
  onSong?: (song: Song) => void;
  saveStatus?: string;
  onSettings: (settings: Song["performance"]) => void;
};

type MicSession = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  frame: number;
};
type ClickSession = {
  context: AudioContext;
  timer: ReturnType<typeof setInterval> | null;
  voices: Set<OscillatorNode>;
};

function bounded(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function audioError(error: unknown, microphone: boolean) {
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return microphone
      ? "Доступ к микрофону запрещён. Разрешите его в настройках сайта и попробуйте снова."
      : "Браузер запретил воспроизведение. Нажмите «Продолжить», чтобы повторить.";
  }
  if (name === "NotFoundError")
    return "Микрофон не найден. Подключите устройство и попробуйте снова.";
  if (name === "NotReadableError")
    return "Не удалось открыть микрофон. Проверьте, не занят ли он другим приложением.";
  if (name === "OverconstrainedError")
    return "Выбранный микрофон недоступен. Выберите другое устройство.";
  return microphone
    ? "Не удалось включить микрофон. Проверьте подключение и разрешения браузера."
    : "Не удалось запустить метроном. Проверьте вывод звука и попробуйте снова.";
}

export default function Performance({
  song,
  onBack,
  onSettings,
  onSong,
  saveStatus,
}: Props) {
  const rows = song.sections.flatMap((section) =>
    section.lines.map((line) => ({ section, line })),
  );
  const [currentId, setCurrentId] = useState<string | null>(
    () => rows[0]?.line.id ?? null,
  );
  const map = useMemo(() => timeline(song), [song.sections, song.audio]);
  const clock = useRef(new PerformanceClock());
  const referenceAudio = useRef<HTMLAudioElement | null>(null);
  const referenceStarted = useRef(false);
  const [referenceEnabled, setReferenceEnabled] = useState(false);
  const [referenceError, setReferenceError] = useState("");
  const [position, setPosition] = useState(0);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [mappedMode, setMappedMode] = useState<"original" | "follow">(
    "original",
  );
  const mapped = map.length > 0;
  const completeMap = rows
    .filter((r) => r.line.text.trim())
    .every((r) => map.some((e) => e.line.id === r.line.id));
  const clockEnabled = useRef(false);
  clockEnabled.current = mapped;
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<"free" | "metronome">("free");
  const [micState, setMicState] = useState<"off" | "pending" | "on">("off");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [level, setLevel] = useState(0);
  const [appliedSettings, setAppliedSettings] =
    useState<MediaTrackSettings | null>(null);
  const [micError, setMicError] = useState("");
  const [clickError, setClickError] = useState("");
  const [followLanguage, setFollowLanguage] = useState(song.language);
  const [followStarting, setFollowStarting] = useState(false);
  const activeLine = useRef<HTMLButtonElement | null>(null);
  const reader = useRef<HTMLDivElement | null>(null);
  const voice = useVoiceFollow(
    song,
    (lineId) => {
      if (!clockEnabled.current) setCurrentId(lineId);
    },
    () => {
      stopMic();
      clock.current.pause();
      setRunning(false);
    },
    mapped
      ? {
          position: (at) => clock.current.position(at),
          onAnchor: (anchor) => {
            clock.current.correct(anchor, clock.current.generation);
          },
        }
      : undefined,
  );
  const mic = useRef<MicSession | null>(null);
  const micContext = useRef<AudioContext | null>(null);
  const clicks = useRef<ClickSession | null>(null);
  const micRequest = useRef(0);
  const clickRequest = useRef(0);
  const settings = {
    fontSize: bounded(song.performance.fontSize, 16, 60, 24),
    bpm: bounded(song.performance.bpm, 30, 240, 90),
    beats: bounded(song.performance.beats, 1, 12, 4),
  };
  const liveSettings = useRef(settings);
  liveSettings.current = settings;
  const currentIndex = rows.findIndex((row) => row.line.id === currentId);
  const selected = rows[currentIndex];

  useEffect(() => {
    if (!mapped) return;
    let frame = 0,
      previousFrame = -Infinity;
    const draw = () => {
      if (performance.now() - previousFrame < 30) {
        frame = requestAnimationFrame(draw);
        return;
      }
      previousFrame = performance.now();
      const p = clock.current.tick(
        map,
        mappedMode === "follow" && voice.active,
      );
      const audio = referenceAudio.current;
      if (audio) {
        if (referenceEnabled && mappedMode === "original" && clock.current.running && !clock.current.countIn) {
          audio.playbackRate = clock.current.speed;
          if (Math.abs(audio.currentTime - p) > .3) audio.currentTime = p;
          if (!referenceStarted.current) {
            referenceStarted.current = true;
            void audio.play().catch(() => { setReferenceError("Браузер не включил оригинал. Отключите и снова включите прослушивание."); setReferenceEnabled(false); });
          }
        } else { audio.pause(); referenceStarted.current = false; }
      }
      setPosition(p);
      setRunning(clock.current.running);
      if (clock.current.running) {
        const entry =
          map.find((e) => p >= e.start && p < e.end) ||
          [...map].reverse().find((e) => p >= e.start);
        if (entry) setCurrentId(entry.line.id);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [map, mapped, mappedMode, voice.active, referenceEnabled]);

  function releaseMic() {
    voice.stop();
    micRequest.current++;
    const session = mic.current;
    mic.current = null;
    const context = micContext.current;
    micContext.current = null;
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
    if (!session) return;
    cancelAnimationFrame(session.frame);
    session.stream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    session.source.disconnect();
    session.analyser.disconnect();
  }

  function releaseClicks() {
    clickRequest.current++;
    const session = clicks.current;
    clicks.current = null;
    if (!session) return;
    if (session.timer !== null) clearInterval(session.timer);
    session.voices.forEach((voice) => {
      voice.onended = null;
      try {
        voice.stop();
      } catch {
        /* Already ended. */
      }
      voice.disconnect();
    });
    session.voices.clear();
    void session.context.close().catch(() => {});
  }

  function stopMic() {
    if (mappedMode === "follow") {
      clock.current.pause();
      setRunning(false);
    }
    releaseMic();
    setMicState("off");
    setLevel(0);
  }

  async function startMic(nextDevice = deviceId) {
    releaseMic();
    const request = micRequest.current;
    setLevel(0);
    setMicError("");
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === "undefined"
    ) {
      setMicState("off");
      setMicError(
        "Микрофон недоступен. Откройте приложение через localhost или HTTPS в браузере с Web Audio.",
      );
      return;
    }
    setMicState("pending");
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      // Create/resume during the user gesture; never route microphone audio to speakers.
      context = new AudioContext();
      micContext.current = context;
      await context.resume();
      if (request !== micRequest.current) {
        void context.close().catch(() => {});
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(nextDevice ? { deviceId: { exact: nextDevice } } : {}),
          autoGainControl: false,
          noiseSuppression: false,
          echoCancellation: false,
        },
        video: false,
      });
      if (request !== micRequest.current) {
        stream.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => {});
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const session: MicSession = {
        stream,
        context,
        source,
        analyser,
        frame: 0,
      };
      mic.current = session;
      setAppliedSettings(stream.getAudioTracks()[0]?.getSettings() || null);
      const samples = new Float32Array(analyser.fftSize);
      let lastMeter = 0;
      const measure = (timestamp = 0) => {
        if (mic.current !== session) return;
        if (timestamp - lastMeter >= 100) {
          lastMeter = timestamp;
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(
            samples.reduce((sum, sample) => sum + sample * sample, 0) /
              samples.length,
          );
          // dBFS mapped to a visible range of -60 to 0 dB.
          setLevel(
            Math.max(
              0,
              Math.min(1, (20 * Math.log10(Math.max(rms, 0.000001)) + 60) / 60),
            ),
          );
        }
        session.frame = requestAnimationFrame(measure);
      };
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (mic.current !== session) return;
          stopMic();
          setMicError(
            "Микрофон отключён. Подключите устройство и включите его снова.",
          );
        };
      });
      setMicState("on");
      measure();
      try {
        const available = await navigator.mediaDevices.enumerateDevices();
        if (request === micRequest.current)
          setDevices(
            available.filter((device) => device.kind === "audioinput"),
          );
      } catch {
        /* Meter remains usable if device enumeration is unavailable. */
      }
      return session;
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed")
        void context.close().catch(() => {});
      if (request !== micRequest.current) return;
      releaseMic();
      setMicState("off");
      setLevel(0);
      setMicError(audioError(error, true));
    }
  }

  async function startFollowing() {
    if (followStarting) return;
    setFollowStarting(true);
    try {
      const session = mic.current || (await startMic());
      if (session && currentId) {
        await voice.start(
          session.context,
          session.source,
          followLanguage,
          currentId,
        );
        if (mapped) {
          const entry = map.find((e) => e.line.id === currentId);
          const p = clock.current.position();
          clock.current.seek(
            entry && p >= entry.start && p < entry.end
              ? p
              : (entry?.start ?? 0),
          );
          clock.current.start(countdown);
          setRunning(true);
        }
      }
    } catch {
      stopMic();
    } finally {
      setFollowStarting(false);
    }
  }

  function selectLine(lineId: string) {
    setCurrentId(lineId);
    const entry = map.find((e) => e.line.id === lineId);
    if (entry) {
      const resume =
        clock.current.running || (mappedMode === "follow" && voice.active);
      clock.current.seek(entry.start);
      setPosition(entry.start);
      if (resume) clock.current.start();
    } else if (mapped) {
      clock.current.pause();
      setRunning(false);
    }
    voice.manual(lineId);
  }

  useEffect(() => {
    if (!playing || mode !== "metronome") return;
    const request = ++clickRequest.current;
    let disposed = false;
    async function start() {
      try {
        if (typeof AudioContext === "undefined")
          throw new Error("Web Audio unavailable");
        const context = new AudioContext();
        const session: ClickSession = {
          context,
          timer: null,
          voices: new Set(),
        };
        clicks.current = session;
        await context.resume();
        if (disposed || request !== clickRequest.current) return;
        let nextTime = context.currentTime + 0.05;
        let beat = 0;
        const schedule = () => {
          if (context.state !== "running") return;
          // After background throttling, skip missed clicks instead of playing a burst.
          if (nextTime < context.currentTime) {
            nextTime = context.currentTime + 0.03;
            beat = 0;
          }
          while (nextTime < context.currentTime + 0.12) {
            const { bpm, beats } = liveSettings.current;
            beat %= beats;
            const voice = context.createOscillator();
            const gain = context.createGain();
            voice.frequency.value = beat === 0 ? 1200 : 800;
            gain.gain.setValueAtTime(0, nextTime);
            gain.gain.linearRampToValueAtTime(0.16, nextTime + 0.002);
            gain.gain.exponentialRampToValueAtTime(0.001, nextTime + 0.045);
            voice.connect(gain);
            gain.connect(context.destination);
            session.voices.add(voice);
            voice.onended = () => {
              voice.disconnect();
              gain.disconnect();
              session.voices.delete(voice);
            };
            voice.start(nextTime);
            voice.stop(nextTime + 0.05);
            nextTime += 60 / bpm;
            beat = (beat + 1) % beats;
          }
        };
        schedule();
        session.timer = setInterval(schedule, 25);
      } catch (error) {
        if (disposed || request !== clickRequest.current) return;
        releaseClicks();
        setClickError(audioError(error, false));
        setPlaying(false);
      }
    }
    void start();
    return () => {
      disposed = true;
      releaseClicks();
    };
  }, [playing, mode, song.id]);

  useEffect(
    () => () => {
      releaseMic();
      releaseClicks();
    },
    [],
  );

  useEffect(() => {
    setCurrentId(
      song.sections.flatMap((section) => section.lines)[0]?.id ?? null,
    );
    setPlaying(false);
    stopMic();
    setMicError("");
    setClickError("");
    setFollowLanguage(song.language);
  }, [song.id]);

  useEffect(() => {
    if (!rows.some((row) => row.line.id === currentId))
      setCurrentId(rows[0]?.line.id ?? null);
  }, [song.sections, currentId]);

  useEffect(() => {
    if (!activeLine.current || !reader.current) return;
    const top =
      activeLine.current.getBoundingClientRect().top -
      reader.current.getBoundingClientRect().top +
      reader.current.scrollTop -
      reader.current.clientHeight * 0.3;
    reader.current.scrollTo({
      top: Math.max(0, top),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [currentId]);

  function stop() {
    clock.current.pause();
    clock.current.seek(map[0]?.start ?? 0);
    setRunning(false);
    setPosition(map[0]?.start ?? 0);
    releaseClicks();
    setPlaying(false);
    stopMic();
    setCurrentId(rows[0]?.line.id ?? null);
  }

  function move(delta: number) {
    const row =
      rows[Math.max(0, Math.min(rows.length - 1, currentIndex + delta))];
    if (row) selectLine(row.line.id);
  }

  return (
    <div
      className="performance"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest('input, select, textarea, [contenteditable="true"]') ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          move(event.key === "ArrowDown" ? 1 : -1);
        }
      }}
    >
      <header className="performance-header">
        <button
          type="button"
          className="text-button"
          onClick={() => {
            stop();
            onBack();
          }}
        >
          <ArrowLeft size={17} />К редактору
        </button>
        <div>
          <p className="overline">Исполнение</p>
          <h1>{song.title || "Без названия"}</h1>
          {song.artist && <p className="muted">{song.artist}</p>}
        </div>
      </header>

      <details className="performance-options">
        <summary>Раздел, размер текста и метроном</summary>
        <div
          className="performance-toolbar"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "end",
          }}
        >
          <label>
            Режим
            <select
              value={mode}
              onChange={(event) => {
                releaseClicks();
                setPlaying(false);
                setClickError("");
                setMode(event.target.value as "free" | "metronome");
              }}
            >
              <option value="free">Свободное чтение</option>
              <option value="metronome">С метрономом</option>
            </select>
          </label>
          <label>
            Раздел
            <select
              value={selected?.section.id ?? ""}
              disabled={!rows.length}
              onChange={(event) => {
                const first = rows.find(
                  (row) => row.section.id === event.target.value,
                );
                if (first) selectLine(first.line.id);
              }}
            >
              {!rows.length && <option value="">Нет строк</option>}
              {song.sections.map((section, index) => (
                <option
                  key={section.id}
                  value={section.id}
                  disabled={!section.lines.length}
                >
                  {index + 1}. {section.name || "Без названия"}
                  {!section.lines.length ? " (пусто)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Размер текста: {settings.fontSize}
            <input
              aria-label="Размер текста"
              type="range"
              min={16}
              max={60}
              value={settings.fontSize}
              onChange={(event) =>
                onSettings({
                  ...settings,
                  fontSize: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Темп, BPM
            <input
              type="number"
              min={30}
              max={240}
              step={1}
              value={settings.bpm}
              onChange={(event) => {
                if (event.target.value !== "" && event.target.validity.valid)
                  onSettings({ ...settings, bpm: Number(event.target.value) });
              }}
            />
          </label>
          <label>
            Долей в такте
            <select
              value={settings.beats}
              onChange={(event) =>
                onSettings({ ...settings, beats: Number(event.target.value) })
              }
            >
              {Array.from({ length: 12 }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
      {mapped ? (
        <section className="timeline-controls" aria-label="Временная карта">
          {song.audio && <audio ref={referenceAudio} src={song.audio.url} preload="metadata" hidden />}
          {song.audio && mappedMode === "original" && <label><input type="checkbox" checked={referenceEnabled} onChange={e => {
            setReferenceEnabled(e.target.checked); setReferenceError(""); referenceStarted.current = false;
          }} /> Слушать оригинал при проверке</label>}
          {referenceError && <p role="alert" className="error">{referenceError}</p>}
          <div className="actions">
            <label>
              Сопровождение
              <select
                value={mappedMode}
                onChange={(e) => {
                  stopMic();
                  clock.current.pause();
                  setRunning(false);
                  setMappedMode(e.target.value as "original" | "follow");
                }}
              >
                <option value="original">По оригиналу</option>
                <option value="follow">Следовать за мной</option>
              </select>
            </label>
            <label>
              Скорость относительно оригинала
              <input
                type="number"
                min="0.5"
                max="1.5"
                step="0.05"
                value={speed}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 0.5 && n <= 1.5) {
                    setSpeed(n);
                    clock.current.setSpeed(n);
                  }
                }}
              />
            </label>
            <label>
              Отсчёт
              <select
                value={countdown}
                onChange={(e) => setCountdown(Number(e.target.value))}
              >
                <option value={0}>Без отсчёта</option>
                <option value={3}>3 секунды</option>
                <option value={5}>5 секунд</option>
              </select>
            </label>
            <button
              disabled={
                !map.some((e) => e.line.id === currentId) ||
                (mappedMode === "follow" && !voice.active)
              }
              onClick={() => {
                if (running) {
                  clock.current.pause();
                  setRunning(false);
                  if (voice.active) stopMic();
                } else {
                  if (clock.current.position() === 0)
                    clock.current.seek(
                      map.find((e) => e.line.id === currentId)?.start ?? 0,
                    );
                  clock.current.start(countdown);
                  setRunning(true);
                }
              }}
            >
              {running ? "Пауза сопровождения" : "Запустить сопровождение"}
            </button>
          </div>
          <p role="status">
            {mappedMode === "original"
              ? "По временной карте · без коррекции микрофоном"
              : clock.current.state}{" "}
            ·{" "}
            {clock.current.countIn > 0
              ? `Начало через ${clock.current.countIn}…`
              : `${position.toFixed(1)} с`}
            {running ? "" : " · остановлено"}
          </p>
          <p className="muted">
            {!completeMap &&
              "Для микрофонной коррекции сначала разметьте все вокальные строки: неизвестный участок нельзя считать проигрышем. "}
            Оригинал не звучит автоматически. Прослушивание для проверки — ниже.{" "}
            {map.filter((e) => validWords(e.line)).length} строк с отметками
            слов, {map.length} строк на карте. Строки без разметки не
            прогнозируются.
          </p>
          <details>
            <summary>Диагностика часов и коррекции</summary>
            <p>
              Часы: {position.toFixed(2)} с · скорость:{" "}
              {clock.current.speed.toFixed(3)} · подтверждено:{" "}
              {clock.current.confirmed?.toFixed(2) ?? "—"} с
            </p>
            <p>
              Последняя поправка: {clock.current.correction.toFixed(2)} с ·
              состояние: {clock.current.state}
            </p>
            <p>
              Фраза: {voice.transcript || "—"} · возраст конца аудио:{" "}
              {voice.measurement?.audioAgeMs ?? "—"} мс · вычисление:{" "}
              {voice.measurement?.processingMs ?? "—"} мс
            </p>
          </details>
        </section>
      ) : (
        <p className="notice">
          Временная карта пока не готова. Подготовьте её из MP3 в редакторе или
          задайте времена ниже. Пока доступно только распознавание строк с
          задержкой.
        </p>
      )}
      {(!mapped || mappedMode === "follow") && (
        <section className="voice-follow" aria-label="Следование за голосом">
          <div className="actions">
            <label>
              Язык пения
              <select
                value={followLanguage}
                disabled={voice.active || followStarting}
                onChange={(e) =>
                  setFollowLanguage(e.target.value as Song["language"])
                }
              >
                <option value="ru">Русский</option>
                <option value="uk">Українська</option>
                <option value="en">English</option>
              </select>
            </label>
            <button
              className="primary"
              disabled={
                followStarting ||
                micState === "pending" ||
                (mapped && !completeMap) ||
                !rows.some((r) => r.line.text.trim())
              }
              onClick={() => {
                if (voice.active) {
                  stopMic();
                  clock.current.pause();
                  setRunning(false);
                } else void startFollowing();
              }}
            >
              {voice.active ? <MicOff size={17} /> : <Mic size={17} />}{" "}
              {followStarting
                ? "Подключаю…"
                : voice.active
                  ? "Остановить следование"
                  : mapped
                    ? "Начать: следовать за мной"
                    : "Следовать за голосом"}
            </button>
            <span role="status" className="follow-status">
              {voice.active
                ? voice.status
                : followStarting
                  ? "Подключаю микрофон"
                  : "Следование выключено"}
            </span>
          </div>
          {voice.health &&
            (!voice.health.version ||
              !voice.health.models[followLanguage].installed) && (
              <div className="notice follow-install">
                <span>
                  Для этого языка нужна локальная модель{" "}
                  {voice.health.models[followLanguage].name}, около{" "}
                  {voice.health.models[followLanguage].sizeMB} МБ. Выполните в
                  папке приложения и перезапустите сервер:
                </span>
                <code>{voice.health.models[followLanguage].command}</code>
              </div>
            )}
          {voice.error && (
            <p className="error" role="alert">
              {voice.error}
            </p>
          )}
          {voice.measurement && (
            <details className="follow-diagnostics">
              <summary>Диагностика следования</summary>
              <p>
                Окно: {voice.measurement.audioSeconds.toFixed(1)} с · Обработка:{" "}
                {Math.round(voice.measurement.processingMs)} мс · Запрос с
                ресемплингом: {voice.measurement.roundTripMs} мс
              </p>
              {voice.measurement.roundTripMs > 1200 && (
                <p className="danger">
                  Обработка отстаёт от входа. Старые окна пропускаются;
                  попробуйте сначала голос без гитары.
                </p>
              )}
              <p>Распознано: {voice.transcript || "—"}</p>
            </details>
          )}
        </section>
      )}

      <div
        className="performance-transport actions"
        style={{ marginBlock: 20, flexWrap: "wrap" }}
      >
        {mode === "metronome" && (
          <button
            type="button"
            className="primary"
            disabled={!rows.length}
            onClick={() => {
              setClickError("");
              if (playing) releaseClicks();
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}{" "}
            {playing ? "Пауза" : "Продолжить"}
          </button>
        )}
        <button type="button" onClick={stop}>
          <Square size={16} />
          Стоп
        </button>
        <button
          type="button"
          disabled={currentIndex <= 0}
          onClick={() => move(-1)}
        >
          <ArrowUp size={16} />
          Предыдущая строка
        </button>
        <button
          type="button"
          disabled={currentIndex < 0 || currentIndex >= rows.length - 1}
          onClick={() => move(1)}
        >
          <ArrowDown size={16} />
          Следующая строка
        </button>
      </div>
      <p className="performance-status" role="status">
        {mode === "metronome"
          ? playing
            ? "Метроном включён. "
            : "Метроном на паузе. "
          : ""}
        {voice.active
          ? mapped
            ? "Подсветка движется по карте, голос в фоне корректирует её."
            : "Текущая строка определяется по голосу."
          : mapped
            ? "Сопровождение по временной карте"
            : "Ручное чтение"}
      </p>
      {clickError && (
        <p className="error" role="alert">
          {clickError}
        </p>
      )}

      <details className="performance-options">
        <summary>
          Микрофон и уровень входа
          {micState === "on" ? " · включён" : " · выключен"}
        </summary>
        <section
          className="performance-microphone"
          aria-label="Микрофон"
          style={{ marginBlock: 20 }}
        >
          <div className="actions" style={{ flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={followStarting}
              onClick={() => {
                if (micState === "off") void startMic();
                else stopMic();
              }}
            >
              {micState === "off" ? <Mic size={17} /> : <MicOff size={17} />}
              {micState === "pending"
                ? "Отменить включение микрофона"
                : micState === "on"
                  ? "Выключить микрофон"
                  : "Включить микрофон"}
            </button>
            <label>
              Устройство
              <select
                value={deviceId}
                disabled={
                  micState === "pending" || voice.active || followStarting
                }
                onChange={(event) => {
                  const next = event.target.value;
                  setDeviceId(next);
                  if (micState === "on") void startMic(next);
                }}
              >
                <option value="">Системный микрофон</option>
                {devices.map((device, index) => (
                  <option
                    key={device.deviceId || index}
                    value={device.deviceId}
                  >
                    {device.label || `Микрофон ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Уровень входа{" "}
              <meter
                min={0}
                max={1}
                value={level}
                aria-label="Уровень сигнала микрофона"
                style={{ width: 140 }}
              />
            </label>
            <span role="status">
              {micState === "on"
                ? "Микрофон включён"
                : micState === "pending"
                  ? "Ожидаем доступ к микрофону…"
                  : "Микрофон выключен"}
            </span>
          </div>
          {micState === "on" && appliedSettings && (
            <details className="muted">
              <summary>Параметры входа</summary>
              <p>
                Частота: {appliedSettings.sampleRate || "не сообщается"} Гц ·
                Каналов: {appliedSettings.channelCount || "не сообщается"}
              </p>
              <p>
                Подавление эха:{" "}
                {String(appliedSettings.echoCancellation ?? "не сообщается")} ·
                Шумоподавление:{" "}
                {String(appliedSettings.noiseSuppression ?? "не сообщается")} ·
                Автоусиление:{" "}
                {String(appliedSettings.autoGainControl ?? "не сообщается")}
              </p>
            </details>
          )}
        </section>
      </details>
      {micError && (
        <p className="error" role="alert">
          {micError}
        </p>
      )}

      <div
        ref={reader}
        className="performance-reader"
        aria-label="Текст и аккорды"
        style={{
          maxHeight: "65vh",
          overflow: "auto",
          fontSize: settings.fontSize,
        }}
      >
        {!rows.length && (
          <p className="empty">
            В песне пока нет строк. Добавьте текст в редакторе.
          </p>
        )}
        {song.sections.map((section) => (
          <section
            className="performance-section"
            key={section.id}
            aria-label={section.name || "Раздел"}
          >
            <h2 style={{ fontSize: "0.75em" }}>
              {section.name || "Без названия"}
            </h2>
            {section.lines.map((line, index) => (
              <button
                type="button"
                key={line.id}
                ref={line.id === currentId ? activeLine : undefined}
                className={
                  "performance-line" +
                  (line.id === currentId ? " current" : "") +
                  (mapped && (line.end ?? Infinity) < position ? " past" : "")
                }
                aria-current={line.id === currentId ? "step" : undefined}
                aria-label={`Строка ${index + 1}: ${line.text || "Инструментальная строка"}`}
                onClick={() => selectLine(line.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  font: "inherit",
                  padding: "16px 12px",
                  marginBlock: 8,
                  border:
                    line.id === currentId
                      ? "2px solid var(--accent, #b6d98c)"
                      : "2px solid transparent",
                  background:
                    line.id === currentId
                      ? "var(--surface, #242a24)"
                      : "transparent",
                  color: "inherit",
                  borderRadius: 8,
                }}
              >
                <Lyrics
                  line={line}
                  song={song}
                  large
                  position={mapped && validWords(line) ? Math.min(Math.max(position, line.words![0].start - 1), line.words!.at(-1)!.end) : undefined}
                />
                {!line.text && !line.chords.length && (
                  <span className="muted">Пустая строка</span>
                )}
              </button>
            ))}
          </section>
        ))}
      </div>
      {selected && onSong && (
        <>
          <TimingEditor
            song={song}
            line={selected.line}
            disabled={running || voice.active}
            onSave={(line) => {
              const next = structuredClone(song);
              for (const section of next.sections)
                section.lines = section.lines.map((l) =>
                  l.id === line.id ? line : l,
                );
              onSong(next);
            }}
          />
          <p role="status">{saveStatus || ""}</p>
        </>
      )}
    </div>
  );
}
