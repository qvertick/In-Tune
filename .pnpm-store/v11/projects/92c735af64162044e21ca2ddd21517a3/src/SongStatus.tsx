import { useI18n } from "./i18n";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Song } from "./model";

export default function SongStatus({ song }: { song: Song }) {
  const { t } = useI18n();
  const [stems, setStems] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState(false);
  useEffect(() => {
    setStems(null);
    setStatusError(false);
    if (!song.audio) return;
    const controller = new AbortController();
    api<{ ready: boolean }>(`/songs/${song.id}/stems`, {
      signal: controller.signal,
    })
      .then((value) => setStems(value.ready))
      .catch(() => {
        if (!controller.signal.aborted) setStatusError(true);
      });
    return () => controller.abort();
  }, [song.id, song.audio?.url]);
  const lines = song.sections
    .flatMap((section) => section.lines)
    .filter((line) => line.text.trim());
  const timed = lines.filter(
    (line) => line.start !== undefined && !line.timingReview,
  ).length;
  return (
    <dl className="song-preparation">
      <div>
        <dt>{t("Разбор")}</dt>
        <dd>{song.origin ? t("Импортирован") : t("Свой текст")}</dd>
      </div>
      <div>
        <dt>{t("Аудио")}</dt>
        <dd>{song.audio ? t("Прикреплено") : t("Нужно добавить MP3")}</dd>
      </div>
      <div>
        <dt>{t("Синхронизация")}</dt>
        <dd>
          {timed
            ? t("{timed} из {value1} строк", {
                timed: timed,
                value1: lines.length,
              })
            : t("Нужна разметка или LRC")}
        </dd>
      </div>
      <div>
        <dt>{t("Вокал / сопровождение")}</dt>
        <dd>
          {stems === true
            ? t("Готовы")
            : !song.audio
              ? t("Сначала добавьте запись")
              : stems === false
                ? t("Не подготовлены")
                : statusError
                  ? t("Статус недоступен · откройте плеер")
                  : t("Проверка…")}
        </dd>
      </div>
    </dl>
  );
}
