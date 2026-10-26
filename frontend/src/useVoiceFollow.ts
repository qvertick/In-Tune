import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Song } from "./model";
import { LatestAudio, pcm16, resample } from "./audio/stream";

type Status =
  | "listening"
  | "recognizing"
  | "following"
  | "uncertain"
  | "no_voice";
export const FOLLOW_LABELS: Record<Status, string> = {
  listening: "Слушаю",
  recognizing: "Распознаю",
  following: "Следую",
  uncertain: "Уточняю место",
  no_voice: "Не слышу голос",
};
type Health = {
  version: string | null;
  models: Record<
    string,
    { installed: boolean; name: string; sizeMB: number; command: string }
  >;
};
type Result = {
  anchor?: { songTime: number; audioTime: number; uncertainty?: number } | null;
  lineId: string;
  generation: number;
  sequence: number;
  status: Status;
  processingMs: number;
  audioSeconds: number;
  transcript: string;
  stale?: boolean;
  discarded?: boolean;
};
type Session = {
  id: string;
  generation: number;
  sequence: number;
  buffer: LatestAudio;
  node: AudioWorkletNode | null;
  gain: GainNode | null;
  source: MediaStreamAudioSourceNode;
  abort: AbortController | null;
  busy: boolean;
  resetting: boolean;
  stopped: boolean;
  lastSignal: number;
  streaming: boolean;
  latestCapture: { sample: number; at: number };
};

export function useVoiceFollow(
  song: Song,
  onLine: (lineId: string) => void,
  onFatal: () => void,
  correction?: {
    position: (at: number) => number;
    onAnchor: (anchor: {
      songTime: number;
      audioTime: number;
      capturedAt: number;
      uncertainty?: number;
    }) => void;
  },
) {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<Status>("listening");
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [measurement, setMeasurement] = useState<{
    processingMs: number;
    roundTripMs: number;
    audioSeconds: number;
    audioAgeMs?: number;
  } | null>(null);
  const [transcript, setTranscript] = useState("");
  const current = useRef<Session | null>(null);
  const attempt = useRef(0);
  const handlers = useRef({ onLine, onFatal, correction });
  handlers.current = { onLine, onFatal, correction };
  useEffect(() => {
    let mounted = true;
    api<Health>("/follow/status")
      .then((value) => {
        if (mounted) setHealth(value);
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      });
    return () => {
      mounted = false;
    };
  }, []);

  function stop() {
    attempt.current++;
    const session = current.current;
    current.current = null;
    setActive(false);
    if (!session) return;
    session.stopped = true;
    session.abort?.abort();
    session.buffer.clear();
    if (session.node) {
      session.node.port.onmessage = null;
      session.node.port.close();
      try {
        session.source.disconnect(session.node);
      } catch {}
      session.node.disconnect();
    }
    session.gain?.disconnect();
    void fetch("/api/follow/sessions/" + session.id, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => {});
  }

  function fatal(message: string) {
    setError(message);
    stop();
    handlers.current.onFatal();
  }

  async function pump(session: Session) {
    if (
      session.stopped ||
      session.busy ||
      session.resetting ||
      current.current !== session
    )
      return;
    const window = session.buffer.take();
    if (!window) return;
    session.busy = true;
    const generation = session.generation;
    const sequence = ++session.sequence;
    const controller = new AbortController();
    session.abort = controller;
    const started = performance.now();
    const capture = { ...session.latestCapture };
    setStatus("recognizing");
    try {
      const samples = await resample(window.samples, session.buffer.sampleRate);
      if (session.stopped || generation !== session.generation) return;
      const query = new URLSearchParams({
        sequence: String(sequence),
        generation: String(generation),
        startSample: String(window.startSample),
        endSample: String(window.startSample + samples.length),
        sampleRate: "16000",
        channels: "1",
        encoding: "pcm_s16le",
        expectedPosition: String(
          Math.max(0, handlers.current.correction?.position(capture.at) ?? 0),
        ),
      });
      const response = await fetch(
        "/api/follow/sessions/" + session.id + "/audio?" + query,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: pcm16(samples),
          signal: controller.signal,
        },
      );
      if (
        session.stopped ||
        current.current !== session ||
        generation !== session.generation
      )
        return;
      if (response.status === 409) {
        setStatus("uncertain");
        return;
      }
      if (!response.ok) {
        let message = "Ошибка обработки микрофона.";
        try {
          message = (await response.json()).detail || message;
        } catch {}
        throw new Error(message);
      }
      const result = (await response.json()) as Result;
      if (
        session.stopped ||
        generation !== session.generation ||
        result.generation !== generation ||
        result.sequence !== sequence ||
        result.stale
      )
        return;
      const elapsed = performance.now() - started;
      setMeasurement({
        processingMs: result.processingMs,
        roundTripMs: Math.round(elapsed),
        audioSeconds: result.audioSeconds,
        audioAgeMs: Math.max(
          0,
          Math.round(performance.now() - capture.at * 1000),
        ),
      });
      // Very late hypotheses are not allowed to pull the reader back into old audio.
      if (elapsed > 5000 || result.discarded) {
        setStatus("uncertain");
        return;
      }
      setTranscript(result.transcript);
      setStatus(
        performance.now() - session.lastSignal > 1500
          ? "no_voice"
          : result.status,
      );
      if (session.streaming && result.anchor) {
        const capturedAt =
          capture.at - (capture.sample / 16000 - result.anchor.audioTime);
        handlers.current.correction?.onAnchor({ ...result.anchor, capturedAt });
      } else if (!session.streaming && result.status === "following")
        handlers.current.onLine(result.lineId);
    } catch (e) {
      if (
        session.stopped ||
        generation !== session.generation ||
        (e instanceof DOMException && e.name === "AbortError")
      )
        return;
      fatal((e as Error).message);
    } finally {
      session.busy = false;
      if (session.abort === controller) session.abort = null;
      if (!session.stopped && current.current === session) void pump(session);
    }
  }

  async function start(
    context: AudioContext,
    source: MediaStreamAudioSourceNode,
    language: string,
    lineId: string,
  ) {
    stop();
    const version = attempt.current;
    setError("");
    setMeasurement(null);
    setTranscript("");
    setStatus("listening");
    let session: Session | null = null;
    try {
      const created = await api<{ id: string }>("/follow/sessions", {
        method: "POST",
        body: JSON.stringify({
          songId: song.id,
          language,
          lineId,
          ...(correction ? { streaming: true } : {}),
        }),
      });
      session = {
        id: created.id,
        generation: 0,
        sequence: 0,
        buffer: new LatestAudio(context.sampleRate, !!correction),
        streaming: !!correction,
        latestCapture: { sample: 0, at: performance.now() / 1000 },
        node: null,
        gain: null,
        source,
        abort: null,
        busy: false,
        resetting: false,
        stopped: false,
        lastSignal: performance.now(),
      };
      if (version !== attempt.current) {
        void fetch("/api/follow/sessions/" + session.id, { method: "DELETE" });
        return;
      }
      current.current = session;
      await context.audioWorklet.addModule("/audio/capture-worklet.js");
      if (session.stopped || version !== attempt.current) return;
      session.node = new AudioWorkletNode(context, "voice-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      session.gain = context.createGain();
      session.gain.gain.value = 0;
      source.connect(session.node);
      session.node.connect(session.gain);
      session.gain.connect(context.destination);
      const captured = session;
      session.node.port.onmessage = (
        event: MessageEvent<{ samples: ArrayBuffer; endFrame: number }>,
      ) => {
        if (captured.stopped) return;
        const samples = new Float32Array(event.data.samples);
        // AudioContext time includes time before the worklet was attached; endFrame is relative.
        // Worklet supplies the real context frame, so a delayed message cannot look freshly captured.
        const contextFrame = (
          event.data as typeof event.data & { contextFrame?: number }
        ).contextFrame;
        captured.latestCapture = {
          sample: Math.round(
            (event.data.endFrame * 16000) / context.sampleRate,
          ),
          at:
            performance.now() / 1000 -
            (contextFrame === undefined
              ? 0
              : Math.max(
                  0,
                  context.currentTime - contextFrame / context.sampleRate,
                )),
        };
        captured.buffer.append(samples, event.data.endFrame);
        captured.node?.port.postMessage("ack");
        const rms = Math.sqrt(
          samples.reduce((sum, x) => sum + x * x, 0) /
            Math.max(1, samples.length),
        );
        if (rms >= 0.008) captured.lastSignal = performance.now();
        if (performance.now() - captured.lastSignal > 1500)
          setStatus("no_voice");
        void pump(captured);
      };
      session.node.onprocessorerror = () => {
        if (current.current === captured && !captured.stopped)
          fatal("Обработка микрофона остановилась. Включите следование снова.");
      };
      setActive(true);
    } catch (e) {
      if (version === attempt.current) {
        fatal((e as Error).message);
        throw e;
      }
    }
  }

  function manual(lineId: string) {
    const session = current.current;
    if (!session) return;
    const generation = ++session.generation;
    session.resetting = true;
    session.buffer.clear();
    session.abort?.abort();
    setTranscript("");
    setStatus("listening");
    void api("/follow/sessions/" + session.id + "/position", {
      method: "POST",
      body: JSON.stringify({ lineId, generation }),
    })
      .then(() => {
        if (generation === session.generation) {
          session.resetting = false;
          void pump(session);
        }
      })
      .catch((e) => {
        if (!session.stopped && generation === session.generation)
          fatal(e.message);
      });
  }
  useEffect(() => {
    const pagehide = () => {
      stop();
      handlers.current.onFatal();
    };
    window.addEventListener("pagehide", pagehide);
    return () => {
      window.removeEventListener("pagehide", pagehide);
      stop();
    };
  }, [song.id]);
  return {
    active,
    status: FOLLOW_LABELS[status],
    error,
    health,
    measurement,
    transcript,
    start,
    stop,
    manual,
  };
}
