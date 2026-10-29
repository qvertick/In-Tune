import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import type { Song } from "./model";
import { applyLrc, matchLrc, parseLrc } from "./lrc";
import { allLines, formatTime } from "./playerTiming";
import { getLrclibTrack, searchLrclib, type LrclibTrack } from "./lrclibClient";
import { parseLyricsfile } from "./lyricsfile";
import { useI18n, translateError } from "./i18n";
import "./lrclib.css";
import { ApiError } from "./api";

type Lookup =
  | { kind: "url"; url: string }
  | {
      kind: "search";
      track: string;
      artist: string;
      album: string;
      duration?: number;
    };

export default function LrclibDialog({
  song,
  onApply,
  onClose,
}: {
  song: Song;
  onApply: (next: Song) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null),
    audio = useRef<HTMLAudioElement>(null);
  const [track, setTrack] = useState(song.title),
    [artist, setArtist] = useState(song.artist),
    [album, setAlbum] = useState("");
  const [url, setUrl] = useState(""),
    [results, setResults] = useState<LrclibTrack[]>([]),
    [selected, setSelected] = useState<LrclibTrack | null>(null);
  const [busy, setBusy] = useState(false),
    [searched, setSearched] = useState(false),
    [error, setError] = useState<string | Error>(""),
    [suggestLrclib, setSuggestLrclib] = useState(false);
  const [shift, setShift] = useState("0"),
    [confirm, setConfirm] = useState(false);
  const request = useRef<AbortController | null>(null),
    generation = useRef(0);
  const lastQuery = useRef<Lookup | null>(null);
  const [retryUntil, setRetryUntil] = useState(0),
    [retrySeconds, setRetrySeconds] = useState(0);
  const duration = song.audio?.duration;
  const parsed = useMemo(() => readLyrics(selected), [selected]);
  const shifted = useMemo(() => {
    const delta = Number(shift);
    return parsed.rows.map((row) => ({
      ...row,
      time: row.time + delta,
      ...(row.end !== undefined ? { end: row.end + delta } : {}),
      ...(row.wordStarts
        ? {
            wordStarts: row.wordStarts.map((word) => ({
              ...word,
              start: word.start + delta,
              ...(word.end !== undefined ? { end: word.end + delta } : {}),
            })),
          }
        : {}),
      ...(row.words
        ? {
            words: row.words.map((word) => ({
              ...word,
              start: word.start + delta,
              end: word.end + delta,
            })),
          }
        : {}),
    }));
  }, [parsed, shift]);
  const matches = useMemo(() => matchLrc(song, shifted), [song, shifted]);
  const lines = allLines(song);
  const matchedIds = new Set(
    matches.flatMap(
      (row) =>
        row.targets?.map((target) => target.lineId) ??
        (row.lineId ? [row.lineId] : []),
    ),
  );
  const replacing = lines.filter(
    (line) =>
      matchedIds.has(line.id) &&
      (line.start !== undefined || line.words?.length),
  ).length;
  const validShift =
    shift.trim() !== "" &&
    Number.isFinite(Number(shift)) &&
    shifted.every((row) => row.time >= 0 && (!duration || row.time < duration));
  const hasWords = parsed.rows.some(
    (row) => row.words?.length || row.wordStarts?.length,
  );
  const hasStartsOnly = parsed.rows.some(
    (row) => !row.words?.length && row.wordStarts?.length,
  );
  useEffect(() => {
    const node = dialog.current,
      recording = audio.current;
    node?.showModal();
    return () => {
      generation.current++;
      request.current?.abort();
      recording?.pause();
      node?.close();
    };
  }, []);
  useEffect(() => {
    const recording = audio.current;
    return () => recording?.pause();
  }, [selected]);
  useEffect(() => {
    const update = () =>
      setRetrySeconds(Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000)));
    update();
    if (retryUntil <= Date.now()) return;
    const timer = setInterval(() => {
      update();
      if (retryUntil <= Date.now()) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [retryUntil]);
  async function load(query: Lookup) {
    if (busy || retryUntil > Date.now()) return;
    lastQuery.current = query;
    request.current?.abort();
    const controller = new AbortController(),
      token = ++generation.current;
    request.current = controller;
    setBusy(true);
    setResults([]);
    setError("");
    setSuggestLrclib(false);
    setRetryUntil(0);
    setSearched(true);
    setSelected(null);
    setConfirm(false);
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      if (query.kind === "url") {
        // Validate the literal before URL parsing can normalize dot segments,
        // backslashes, default ports or whitespace into an accepted link.
        const literal =
          /^https:\/\/lrclib\.net\/tracks\/[1-9][0-9]{0,18}$/.exec(query.url);
        if (!literal || literal[0] !== query.url)
          throw new Error("Вставьте ссылку https://lrclib.net/tracks/число.");
      }
      const found =
        query.kind === "url"
          ? [await getLrclibTrack(query.url, controller.signal)]
          : await searchLrclib(
              query.track,
              query.artist,
              query.album,
              query.duration,
              controller.signal,
            );
      if (token !== generation.current) return;
      setResults(found);
      if (query.kind === "url" && found[0]) setSelected(found[0]);
    } catch (cause) {
      if (token !== generation.current) return;
      setResults([]);
      setSuggestLrclib(
        cause instanceof ApiError &&
          (cause.status === 429 || cause.status >= 500),
      );
      if (
        cause instanceof ApiError &&
        cause.retryAfter !== undefined &&
        Number.isFinite(cause.retryAfter)
      )
        setRetryUntil(Date.now() + Math.max(0, cause.retryAfter) * 1000);
      setError(
        controller.signal.aborted
          ? "Запрос не завершился вовремя. Повторите попытку или импортируйте LRC вручную."
          : cause instanceof Error
            ? cause
            : String(cause),
      );
    } finally {
      clearTimeout(timeout);
      if (token === generation.current) setBusy(false);
    }
  }
  function choose(result: LrclibTrack) {
    if (busy) return;
    setSelected(result);
    setConfirm(false);
    setShift("0");
    setError("");
  }
  return (
    <dialog
      ref={dialog}
      className="lrclib-dialog"
      aria-labelledby="lrclib-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <p className="overline">LRCLIB</p>
          <h2 id="lrclib-title">{t("Найти синхронизацию")}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
          <X size={19} />
        </button>
      </div>
      <p className="muted">
        {t(
          "Выберите ту же версию записи. Совпадение названия не гарантирует совпадения времени.",
        )}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load({ kind: "search", track, artist, album, duration });
        }}
      >
        <div className="lrclib-fields">
          <label>
            {t("Название")}
            <input
              value={track}
              onChange={(event) => setTrack(event.target.value)}
              maxLength={200}
              required
            />
          </label>
          <label>
            {t("Исполнитель")}
            <input
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
              maxLength={200}
            />
          </label>
          <label>
            {t("Альбом (если известен)")}
            <input
              value={album}
              onChange={(event) => setAlbum(event.target.value)}
              maxLength={200}
            />
          </label>
        </div>
        <div className="lrclib-search-actions">
          <span className="muted">
            {t("Наша запись")}:{" "}
            {duration ? formatTime(duration) : t("аудио не прикреплено")}
          </span>
          <button
            className="primary"
            disabled={busy || retrySeconds > 0 || !track.trim()}
          >
            <Search size={16} />
            {t("Найти варианты")}
          </button>
        </div>
      </form>
      <form
        className="lrclib-url"
        onSubmit={(event) => {
          event.preventDefault();
          void load({ kind: "url", url });
        }}
      >
        <label>
          {t("Или ссылка LRCLIB")}
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://lrclib.net/tracks/20902008"
            type="url"
            required
          />
        </label>
        <button disabled={busy || retrySeconds > 0 || !url.trim()}>
          {t("Открыть ссылку")}
        </button>
      </form>
      {busy && <p role="status">{t("Поиск в LRCLIB…")}</p>}
      {error && (
        <div>
          <p role="alert" className="error">
            {translateError(locale, error)}
            {retrySeconds > 0 && (
              <span>
                {" "}
                {t("Повторите через {seconds} с.", { seconds: retrySeconds })}
              </span>
            )}
          </p>
          <button
            type="button"
            disabled={busy || retrySeconds > 0}
            onClick={() => {
              if (lastQuery.current) void load(lastQuery.current);
            }}
          >
            {t("Повторить запрос")}
          </button>
          {suggestLrclib && (
            <a
              className="lrclib-site-link"
              href="https://lrclib.net"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={15} />
              {t("Открыть LRCLIB")}
            </a>
          )}
        </div>
      )}
      {!busy && searched && !results.length && !error && (
        <p role="status">
          {t(
            "Варианты не найдены. Уточните запрос или импортируйте LRC вручную.",
          )}
        </p>
      )}
      {results.length > 0 && (
        <div className="lrclib-results" aria-label={t("Варианты LRCLIB")}>
          {results.map((result) => {
            const available = readLyrics(result);
            const synced = !!available.rows.length;
            const wordMarks = available.rows.some(
              (row) => row.words?.length || row.wordStarts?.length,
            );
            const delta = duration ? result.duration - duration : undefined;
            return (
              <button
                key={result.id}
                type="button"
                className={
                  selected?.id === result.id
                    ? "lrclib-result selected"
                    : "lrclib-result"
                }
                aria-pressed={selected?.id === result.id}
                onClick={() => choose(result)}
              >
                <span>
                  <strong>{result.trackName}</strong>
                  <span>
                    {result.artistName}
                    {result.albumName ? ` · ${result.albumName}` : ""}
                  </span>
                </span>
                <span className="lrclib-result-meta">
                  <span>
                    {formatTime(result.duration)}
                    {delta !== undefined
                      ? ` · Δ ${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} ${t("с")}`
                      : ""}
                  </span>
                  <span className={synced ? "sync-badge" : "muted"}>
                    {t(
                      wordMarks
                        ? "Отметки слов"
                        : synced
                          ? "Отметки строк"
                          : result.instrumental
                            ? "Инструментальная запись"
                            : "Без синхронизации",
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {selected && (
        <section
          className="lrclib-preview"
          aria-label={t("Предпросмотр синхронизации")}
        >
          <div className="lrclib-preview-heading">
            <h3>{selected.trackName}</h3>
            <a
              href={`https://lrclib.net/tracks/${selected.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              LRCLIB <ExternalLink size={13} />
            </a>
          </div>
          <p className="muted">
            {selected.artistName}
            {selected.albumName ? ` · ${selected.albumName}` : ""} ·{" "}
            {formatTime(selected.duration)}
          </p>
          {song.audio && (
            <label>
              {t("Прослушать нашу запись")}
              <audio
                ref={audio}
                controls
                src={song.audio.url}
                preload="metadata"
              />
            </label>
          )}
          {!parsed.rows.length ? (
            <>
              <p role="status">
                {t(
                  "В этом варианте нет синхронизированного текста. Временная карта не будет создана.",
                )}
              </p>
              <pre className="lrclib-plain">
                {selected.plainLyrics || t("Текст отсутствует.")}
              </pre>
            </>
          ) : (
            <>
              <p>
                {t(
                  hasWords
                    ? "Есть реальные отметки слов из файла."
                    : "Здесь есть только отметки строк. Подсветку слов можно включить приблизительно в настройках плеера.",
                )}
              </p>
              {hasStartsOnly && (
                <p className="muted">
                  {t(
                    "Начала слов заданы в источнике; длительность заливки между ними приблизительная.",
                  )}
                </p>
              )}
              <label>
                {t("Общий сдвиг, секунды")}
                <input
                  type="number"
                  step="0.1"
                  value={shift}
                  onChange={(event) => setShift(event.target.value)}
                />
              </label>
              {!validShift && (
                <p role="alert">
                  {t("Сдвиг должен оставлять отметки внутри записи.")}
                </p>
              )}
              <p role="status">
                {t("Сопоставлено строк")}: {matchedIds.size} /{" "}
                {lines.filter((line) => line.text.trim()).length}.{" "}
                {t("Не найдено")}:{" "}
                {
                  lines.filter(
                    (line) => line.text.trim() && !matchedIds.has(line.id),
                  ).length
                }
                .
              </p>
              <div className="lrclib-map">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Время")}</th>
                      <th>LRCLIB</th>
                      <th>{t("Строка песни")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((row, i) => (
                      <tr key={i}>
                        <td>{formatTime(row.time)}</td>
                        <td>{row.text || "—"}</td>
                        <td>
                          {row.targets?.length
                            ? row.targets
                                .map(
                                  (target) =>
                                    lines.find(
                                      (line) => line.id === target.lineId,
                                    )?.text,
                                )
                                .join(" / ")
                            : row.lineId
                              ? lines.find((line) => line.id === row.lineId)
                                  ?.text
                              : translateError(
                                  locale,
                                  row.reason ?? t("Требует проверки"),
                                )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>{t("Строки без совпадения")}</summary>
                <ul>
                  {lines
                    .filter(
                      (line) => line.text.trim() && !matchedIds.has(line.id),
                    )
                    .map((line) => (
                      <li key={line.id}>{line.text}</li>
                    ))}
                </ul>
              </details>
              {parsed.warnings.map((warning, i) => (
                <p className="muted" key={i}>
                  {translateError(locale, warning)}
                </p>
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
              <p className="muted">
                {t(
                  "Текст, аккорды и их позиции сохраняются. Применение можно отменить.",
                )}
              </p>
              <button
                className="primary"
                type="button"
                disabled={
                  busy ||
                  !validShift ||
                  !matchedIds.size ||
                  (replacing > 0 && !confirm)
                }
                onClick={() => {
                  onApply(applyLrc(song, matches, duration));
                  onClose();
                }}
              >
                {t("Применить синхронизацию")}
              </button>
            </>
          )}
        </section>
      )}
      <p className="lrclib-footnote">
        {t(
          "Запрос отправляется LRCLIB. Аудио не отправляется. При недоступности сервиса используйте ручной импорт LRC или разметку.",
        )}
      </p>
    </dialog>
  );
}

export function readLyrics(track: LrclibTrack | null) {
  if (track?.lyricsfile) {
    const parsed = parseLyricsfile(track.lyricsfile);
    if (parsed.rows.length) return parsed;
    const legacy = parseLrc(track.syncedLyrics ?? "");
    return { ...legacy, warnings: [...parsed.warnings, ...legacy.warnings] };
  }
  return parseLrc(track?.syncedLyrics ?? "");
}
