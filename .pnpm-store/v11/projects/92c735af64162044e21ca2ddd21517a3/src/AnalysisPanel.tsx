import { useEffect, useState } from "react";
import { AudioLines, X, FilePlus2, LoaderCircle } from "lucide-react";
import { api } from "./api";
import type { Song } from "./model";

type Job = {
  id: string;
  songId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage?: string;
  error: string | null;
  cancelRequested: boolean;
  resultAvailable: boolean;
};
const labels = {
  queued: "В очереди",
  running: "Подготовка черновика",
  completed: "Черновик готов",
  failed: "Не удалось подготовить",
  cancelled: "Отменено",
};
const stages: Record<string, string> = {
  decoding: "Декодирование аудио",
  transcribing: "Распознавание текста",
  harmony: "Анализ гармонии",
  saving: "Сохранение черновика",
};
export default function AnalysisPanel({
  song,
  beforeStart,
  onResult,
}: {
  song: Song;
  beforeStart: () => Promise<void>;
  onResult: (song: Song) => void;
}) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("transcription");
  const active = job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const jobs = await api<Job[]>("/jobs");
        if (disposed) return;
        const current = jobs.find((j) => j.songId === song.id) || null;
        setJob(current);
        if (
          current &&
          (current.status === "queued" || current.status === "running")
        )
          timer = setTimeout(refresh, 1600);
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    }
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [song.id, busy]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      await beforeStart();
      setJob(
        await api<Job>("/songs/" + song.id + "/analysis?kind=" + kind, {
          method: "POST",
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    try {
      setJob(
        await api<Job>("/jobs/" + job!.id + "/cancel", { method: "POST" }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function importResult() {
    setBusy(true);
    try {
      onResult(
        await api<Song>("/jobs/" + job!.id + "/import-result", {
          method: "POST",
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="analysis-panel">
      <p className="overline">Черновик из аудио</p>
      <label className="analysis-kind">
        Подготовить
        <select
          value={kind}
          disabled={active || busy}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="transcription">Текст · Whisper tiny</option>
          <option value="timing">
            Временная карта известного текста · Vosk
          </option>
          <option value="chords">Аккорды · эксперимент</option>
        </select>
      </label>
      <button
        disabled={!song.audio || active || busy}
        onClick={() => void start()}
      >
        <AudioLines size={16} />
        Начать анализ
      </button>
      {job && (
        <div role="status" className="analysis-status">
          <span>
            {active && <LoaderCircle size={13} />}{" "}
            {job.cancelRequested && active
              ? "Завершаю текущий фрагмент…"
              : active
                ? stages[job.stage || ""] || labels[job.status]
                : labels[job.status]}
          </span>
          {active && (
            <button
              title="Отменить анализ"
              aria-label="Отменить анализ"
              className="icon-button"
              disabled={job.cancelRequested}
              onClick={() => void cancel()}
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}
      {job?.error && (
        <p className="analysis-error" role="alert">
          {job.error}
        </p>
      )}
      {error && (
        <p className="analysis-error" role="alert">
          {error}
        </p>
      )}
      {job?.resultAvailable && (
        <button disabled={busy} onClick={() => void importResult()}>
          <FilePlus2 size={16} />
          Открыть отдельную копию
        </button>
      )}
      <p className="muted">
        {kind === "timing"
          ? "Локальный Vosk сопоставляет известный текст с реальными временами распознанных слов. Пропуски требуют ручной проверки. Результат — отдельная копия; исходная песня сохраняется."
          : kind === "chords"
            ? "Только простые major/minor. Неопределённые интервалы остаются без аккорда. Это не готовая гитарная аранжировка."
            : "Нужна установленная модель Whisper tiny. Отметки времени приблизительные."}
      </p>
    </div>
  );
}
