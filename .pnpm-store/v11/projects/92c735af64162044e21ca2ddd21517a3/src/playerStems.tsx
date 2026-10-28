import { useI18n, translateError } from "./i18n";
import DisclosureSummary from "./DisclosureSummary";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Stems, StemMix } from "./playerMedia";

type SeparationStatus = {
  available: boolean;
  modelInstalled: boolean;
  command: string;
  modelSize?: string;
  note?: string;
};
type SeparationJob = {
  id: string;
  songId: string;
  kind: string;
  status: string;
  stage?: string;
  stageLabel?: string;
  error?: string;
  cancelRequested?: boolean;
  progress?: number;
};
export function useStems(songId: string, enabled: boolean) {
  const [stems, setStems] = useState<Stems | null>(null);
  const [status, setStatus] = useState<SeparationStatus | null>(null);
  const [job, setJob] = useState<SeparationJob | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, refresh] = useState(0);
  const request = useRef(0);
  const active = job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    const generation = ++request.current;
    let timer: ReturnType<typeof setTimeout>;
    setStems(null);
    setStatus(null);
    setJob(null);
    setError("");
    if (!enabled) return;
    async function poll() {
      const results = await Promise.allSettled([
        api<Stems>(`/songs/${encodeURIComponent(songId)}/stems`),
        api<SeparationStatus>("/separation/status"),
        api<SeparationJob[]>("/jobs"),
      ]);
      if (request.current !== generation) return;
      const [tracks, setup, jobs] = results;
      if (tracks.status === "fulfilled") setStems(tracks.value);
      if (setup.status === "fulfilled") setStatus(setup.value);
      let current: SeparationJob | undefined;
      if (jobs.status === "fulfilled" && Array.isArray(jobs.value)) {
        const matching = jobs.value.filter(
          (item) => item.songId === songId && item.kind === "separation",
        );
        current =
          matching.find(
            (item) => item.status === "queued" || item.status === "running",
          ) ?? matching[0];
        setJob(current ?? null);
      }
      const failure = results.find((result) => result.status === "rejected");
      setError(
        failure?.status === "rejected"
          ? String(failure.reason?.message ?? failure.reason)
          : "",
      );
      if (current?.status === "queued" || current?.status === "running")
        timer = setTimeout(() => void poll(), 1800);
    }
    void poll();
    return () => {
      request.current++;
      clearTimeout(timer);
    };
  }, [songId, enabled, revision]);
  async function action(cancel = false) {
    const generation = request.current;
    setBusy(true);
    setError("");
    try {
      const result = await api<SeparationJob>(
        cancel
          ? `/jobs/${encodeURIComponent(job!.id)}/cancel`
          : `/songs/${encodeURIComponent(songId)}/separation`,
        { method: "POST" },
      );
      if (generation !== request.current) return;
      setJob(result);
      refresh((value) => value + 1);
    } catch (error) {
      if (generation === request.current) setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return {
    stems,
    status,
    job,
    active,
    busy,
    error,
    start: () => action(),
    cancel: () => action(true),
    refresh: () => refresh((value) => value + 1),
  };
}

export function StemControls({
  separation,
  vocalMix,
  backingMix,
  onVocalMix,
  onBackingMix,
}: {
  separation: ReturnType<typeof useStems>;
  vocalMix: StemMix;
  backingMix: StemMix;
  onVocalMix: (mix: StemMix) => void;
  onBackingMix: (mix: StemMix) => void;
}) {
  const { t, locale } = useI18n();
  const { stems, status, job, error, active, busy } = separation;
  const ready = stems?.ready && stems.vocalsUrl && stems.accompanimentUrl;
  return (
    <details className="player-stems">
      <DisclosureSummary>
        {t("Вокал и аккомпанемент")}{" "}
        {ready
          ? t("· готовы")
          : active
            ? t("· подготовка")
            : t("· подготовить")}
      </DisclosureSummary>
      {ready ? (
        <div className="player-fields">
          <p>
            {t(
              "Дорожки передаются потоком. Плеер корректирует заметное расхождение; синхронизация не является посэмпловой.",
            )}
          </p>
          {(
            [
              [t("Вокал"), vocalMix, onVocalMix],
              [t("Аккомпанемент"), backingMix, onBackingMix],
            ] as const
          ).map(([label, mix, change]) => (
            <div className="player-stem-channel" key={label}>
              <label>
                {label}
                <input
                  aria-label={t("Громкость: {label}", { label: label })}
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={mix.volume}
                  onChange={(event) =>
                    change({ ...mix, volume: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={mix.muted}
                  onChange={(event) =>
                    change({ ...mix, muted: event.target.checked })
                  }
                />
                {t("Без звука: ")}
                {label}
              </label>
            </div>
          ))}
        </div>
      ) : (
        <>
          <p>
            {t(
              "Дорожки ещё не подготовлены. Разделение выполняется локально отдельным заданием.",
            )}
          </p>
          {status && (
            <p>
              {status.available
                ? t("Движок установлен.")
                : t("Установите движок разделения.")}{" "}
              {status.modelInstalled
                ? t("Модель готова.")
                : t("Нужна модель.")}{" "}
            </p>
          )}
          {status && (
            <details>
              <DisclosureSummary>{t("Подробности")}</DisclosureSummary>
              <p>
                {translateError(locale, status.modelSize || "")}{" "}
                {translateError(locale, status.note || "")}
              </p>
            </details>
          )}
          {status?.command && (!status.available || !status.modelInstalled) && (
            <p>
              {t("Команда установки в терминале:")}
              <code className="player-command">{status.command}</code>
            </p>
          )}
          {stems?.error && (
            <p role="alert">{translateError(locale, stems.error)}</p>
          )}
          {job && (
            <p role="status">
              {(
                {
                  queued: t("В очереди"),
                  running: t("Разделение"),
                  completed: t("Задание завершено"),
                  failed: t("Ошибка разделения"),
                  cancelled: t("Отменено"),
                } as Record<string, string>
              )[job.status] ?? job.status}{" "}
              {translateError(locale, job.stageLabel || "") ||
                (
                  {
                    decoding: t("Подготовка аудио"),
                    separating: t("Разделение дорожек"),
                    saving: t("Сохранение дорожек"),
                    queued: t("Ожидание"),
                  } as Record<string, string>
                )[job.stage ?? ""] ||
                ""}{" "}
              {job.cancelRequested ? t("· отмена запрошена") : ""}
            </p>
          )}
          {job?.error && (
            <p role="alert">{translateError(locale, job.error)}</p>
          )}
          <div className="player-actions">
            <button
              type="button"
              disabled={
                busy || active || !status?.available || !status.modelInstalled
              }
              onClick={() => void separation.start()}
            >
              {t("Подготовить дорожки")}
            </button>
            {active && (
              <button
                type="button"
                disabled={busy || job?.cancelRequested}
                onClick={() => void separation.cancel()}
              >
                {t("Отменить разделение")}
              </button>
            )}
            <button type="button" disabled={busy} onClick={separation.refresh}>
              {t("Проверить готовность")}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert">
          {t("Сервис разделения недоступен: ")}
          {translateError(locale, error)}
          {t(". Проверьте сервер и повторите проверку.")}
        </p>
      )}
    </details>
  );
}
