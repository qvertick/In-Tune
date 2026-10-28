import { useI18n, translateError } from "./i18n";
import DisclosureSummary from "./DisclosureSummary";
import { useMemo, useState } from "react";
import type { Song } from "./model";
import { applyLrc, matchLrc, parseLrc } from "./lrc";
import { allLines, formatTime } from "./playerTiming";
import { parseLyricsfile } from "./lyricsfile";

export default function LrcImport({
  song,
  duration,
  onApply,
  initiallyOpen = false,
}: {
  song: Song;
  duration: number;
  onApply: (song: Song) => void;
  initiallyOpen?: boolean;
}) {
  const { t, locale } = useI18n();
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const parsed = useMemo(
    () =>
      /^\s*version\s*:/m.test(source)
        ? parseLyricsfile(source)
        : parseLrc(source),
    [source],
  );
  const matches = useMemo(() => matchLrc(song, parsed.rows), [song, parsed]);
  const targetIds = new Set(
    matches.flatMap(
      (row) =>
        row.targets?.map((target) => target.lineId) ??
        (row.lineId ? [row.lineId] : []),
    ),
  );
  const count = targetIds.size;
  const lines = allLines(song);
  const replacing = lines.filter(
    (line) =>
      targetIds.has(line.id) &&
      (line.start !== undefined || line.words?.length),
  ).length;
  return (
    <details className="player-lrc" open={initiallyOpen || undefined}>
      <DisclosureSummary>{t("Импорт времён из LRC")}</DisclosureSummary>
      <p>
        {t(
          "Совпадения ищутся по тексту и порядку, включая повторные припевы. Текст песни и позиции аккордов сохраняются. Несовпавшие строки пропускаются.",
        )}
      </p>
      <label>
        {t("Файл LRC / Lyricsfile")}
        <input
          type="file"
          accept=".lrc,.yaml,.yml,text/plain,application/yaml"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 1_000_000) {
              setError("Выберите LRC меньше 1 МБ.");
              return;
            }
            try {
              setSource(await file.text());
              setConfirm(false);
              setError("");
            } catch {
              setError("Не удалось прочитать LRC.");
            }
            event.target.value = "";
          }}
        />
      </label>
      <label>
        {t("Текст LRC")}
        <textarea
          rows={5}
          value={source}
          placeholder={t("[00:12.50]Первая строка")}
          onChange={(event) => {
            setSource(event.target.value);
            setConfirm(false);
            setError("");
          }}
        />
      </label>
      {source && (
        <>
          <p role="status">
            {t("Совпало: ")}
            {count} {t(" из ")}
            {matches.length}
            {t(". Строк песни без совпадения:")} {lines.length - count}.
          </p>
          <div className="player-lrc-preview">
            <table>
              <thead>
                <tr>
                  <th>{t("Время")}</th>
                  <th>LRC</th>
                  <th>{t("Строка песни")}</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((row, index) => (
                  <tr key={index}>
                    <td>{formatTime(row.time)}</td>
                    <td>{row.text || t("Пустая строка")}</td>
                    <td>
                      {row.targets?.length
                        ? row.targets
                            .map(
                              (target) =>
                                lines.find((line) => line.id === target.lineId)
                                  ?.text,
                            )
                            .join(" / ")
                        : row.lineId
                          ? `${lines.findIndex((line) => line.id === row.lineId) + 1}. ${lines.find((line) => line.id === row.lineId)?.text}`
                          : translateError(locale, row.reason || "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.warnings.map((warning, i) => (
            <p key={i}>{translateError(locale, warning)}</p>
          ))}
          {replacing > 0 && (
            <label className="lrclib-confirm">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(event) => setConfirm(event.target.checked)}
              />
              {t("Заменить существующие отметки сопоставленных строк")}:{" "}
              {replacing}
            </label>
          )}
          <button
            type="button"
            disabled={!count || (replacing > 0 && !confirm)}
            onClick={() => {
              onApply(applyLrc(song, matches, duration || undefined));
              setSource("");
            }}
          >
            {t("Применить времена к существующим строкам")}
          </button>
          <p>
            {t(
              "Пересечения с сохранёнными отметками получат пометку «проверить».",
            )}
          </p>
        </>
      )}
      {error && <p role="alert">{translateError(locale, error)}</p>}
    </details>
  );
}
