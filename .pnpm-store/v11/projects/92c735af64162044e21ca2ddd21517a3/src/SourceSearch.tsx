import { useI18n, translateError } from "./i18n";
import DisclosureSummary from "./DisclosureSummary";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Search, Plus, X, FileText } from "lucide-react";
import { api } from "./api";
import { Lyrics } from "./App";
import type { Song } from "./model";
import {
  groupResults,
  rankResults,
  relevance,
  type SearchResult,
} from "./searchRanking";
import "./sources.css";

type Source = {
  id: string;
  name: string;
  host: string;
  searchAvailable: boolean;
  importAvailable: boolean;
  searchUrl: string;
  note?: string;
};
type Preview = {
  song: Song;
  warnings: string[];
  source: {
    id: string;
    name: string;
    url: string;
    author?: string;
    variant?: string;
  };
};
type SourceState = {
  pending: boolean;
  results: SearchResult[];
  error?: string;
};
const webLink = (url: string) => /^https?:\/\//i.test(url);

export default function SourceSearch({
  query,
  songs,
  onAdded,
  onOpen,
  autoSearch = 0,
}: {
  query: string;
  autoSearch?: number;
  songs: Song[];
  onAdded: (song: Song) => void;
  onOpen: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [sources, setSources] = useState<Source[]>([]),
    [states, setStates] = useState<Record<string, SourceState>>({});
  const [searched, setSearched] = useState("");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false),
    [importing, setImporting] = useState(false);
  const [manual, setManual] = useState(false),
    [manualText, setManualText] = useState("");
  const [title, setTitle] = useState(""),
    [artist, setArtist] = useState("");
  const searchRequest = useRef<AbortController | null>(null),
    previewRequest = useRef<AbortController | null>(null);
  const epoch = useRef(0),
    previewEpoch = useRef(0),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<{ sources: Source[] }>("/sources", { signal: controller.signal })
      .then((value) => setSources(value.sources))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      searchRequest.current?.abort();
      previewRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!preview || !dialog.current) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!dialog.current.open) dialog.current.showModal();
    return () => previous?.focus();
  }, [preview]);
  async function showPreview(link: string) {
    if (!link.trim()) return;
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    const version = ++previewEpoch.current;
    setPreviewBusy(true);
    setError("");
    try {
      const value = await api<Preview>(
        "/sources/preview?url=" + encodeURIComponent(link.trim()),
        { signal: controller.signal },
      );
      if (version === previewEpoch.current) setPreview(value);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (version === previewEpoch.current) setPreviewBusy(false);
    }
  }
  async function search() {
    const value = query.trim();
    if (!value) return;
    if (/^https?:\/\//i.test(value)) {
      setUrl(value);
      void showPreview(value);
      return;
    }
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    const version = ++epoch.current;
    setSearched(value);
    setError("");
    const available = sources.filter((source) => source.searchAvailable);
    setStates(
      Object.fromEntries(
        available.map((s) => [s.id, { pending: true, results: [] }]),
      ),
    );
    const pending = [...available];
    async function worker() {
      while (pending.length && !controller.signal.aborted) {
        const source = pending.shift()!;
        try {
          const result = await api<{
            source: string;
            results: SearchResult[];
            error?: string;
          }>(
            "/sources/search?source=" +
              source.id +
              "&query=" +
              encodeURIComponent(value),
            { signal: controller.signal },
          );
          if (version === epoch.current)
            setStates((s) => ({
              ...s,
              [source.id]: {
                pending: false,
                results: result.results,
                error: result.error,
              },
            }));
        } catch (e) {
          if (!controller.signal.aborted && version === epoch.current)
            setStates((s) => ({
              ...s,
              [source.id]: {
                pending: false,
                results: [],
                error: (e as Error).message,
              },
            }));
        }
      }
    }
    await Promise.all([worker(), worker()]);
  }
  async function previewManual() {
    setError("");
    setPreviewBusy(true);
    try {
      setPreview(
        await api<Preview>("/sources/manual", {
          method: "POST",
          body: JSON.stringify({
            title: title || "Новая песня",
            artist,
            text: manualText,
          }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  }
  async function add() {
    if (!preview || importing) return;
    setImporting(true);
    setError("");
    try {
      onAdded(
        await api<Song>("/import", {
          method: "POST",
          body: JSON.stringify(preview.song),
        }),
      );
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }
  useEffect(() => {
    if (autoSearch && sources.length) void search();
  }, [autoSearch, sources]);
  const results = rankResults(
    Object.values(states).flatMap((s) => s.results),
    searched,
  );
  const duplicate =
    preview?.song.origin &&
    songs.find(
      (song) =>
        song.origin?.url.replace(/\/$/, "") ===
        preview.song.origin?.url.replace(/\/$/, ""),
    );
  const busy = Object.values(states).some((s) => s.pending);
  return (
    <section className="source-search" aria-label={t("Найти разбор")}>
      <div className="source-search-intro">
        <div>
          <p className="overline">{t("Готовый текст и аккорды")}</p>
          <h2>{t("Найти разбор")}</h2>
          <p className="muted">
            {t(
              "Введите название или исполнителя в поиске выше. Можно вставить прямую ссылку.",
            )}
          </p>
        </div>
        <button
          className="primary"
          disabled={!query.trim() || !sources.length}
          onClick={() => void search()}
        >
          <Search size={17} />
          {busy ? t("Искать заново") : t("Найти разборы")}
        </button>
      </div>
      <form
        className="source-link-form"
        onSubmit={(e) => {
          e.preventDefault();
          void showPreview(url);
        }}
      >
        <label>
          {t("Ссылка на разбор")}
          <input
            type="url"
            placeholder="https://akkords.pro/songs/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <button disabled={previewBusy || !url.trim()}>
          {t("Предпросмотр ссылки")}
        </button>
      </form>
      {previewBusy && <p role="status">{t("Подготавливаю предпросмотр…")}</p>}
      {error && (
        <p role="alert" className="error">
          {translateError(locale, error)}
        </p>
      )}
      <div className="source-status-grid">
        {sources.map((source) => {
          const state = states[source.id];
          return (
            <article className="source-status" key={source.id}>
              <span className="source-initial" aria-hidden="true">
                {source.name.slice(0, 1)}
              </span>
              <strong>{source.name}</strong>
              <small>
                {source.searchAvailable ? t("Поиск") : t("Поиск недоступен")} ·{" "}
                {source.importAvailable
                  ? t("Импорт по ссылке")
                  : t("Импорт недоступен")}
              </small>
              <p role={state?.pending ? "status" : undefined}>
                {state?.pending
                  ? t("Ищу…")
                  : state?.error
                    ? translateError(locale, state.error)
                    : state
                      ? t("{value0} результатов", {
                          value0: state.results.length,
                        })
                      : translateError(locale, source.note || "")}
              </p>
              {source.searchUrl && webLink(source.searchUrl) && (
                <a
                  href={source.searchUrl.replace(
                    "{query}",
                    encodeURIComponent(query),
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Открыть поиск на сайте ")}
                  <ExternalLink size={12} />
                </a>
              )}
            </article>
          );
        })}
      </div>
      {searched && (
        <p className="muted" role="status">
          {busy
            ? t("Результаты поступают…")
            : results.length
              ? t("Найдено вариантов: {value0}", { value0: results.length })
              : t(
                  "Подходящих результатов не получено. Проверьте сообщения источников или вставьте прямую ссылку.",
                )}
        </p>
      )}
      <div className="source-results">
        {groupResults(results).map((group) => (
          <article key={group[0].url} className="source-result-group">
            <h3>
              {group[0].artist ? `${group[0].artist} — ` : ""}
              {group[0].title}
            </h3>
            {group.map((result) => (
              <div className="source-result" key={result.url}>
                <span className="source-initial" aria-hidden="true">
                  {sources
                    .find((s) => s.id === result.source)
                    ?.name.slice(0, 1) || "♪"}
                </span>
                <div>
                  <strong>
                    {sources.find((s) => s.id === result.source)?.name ||
                      result.source}
                  </strong>
                  {result.variant && <small>{result.variant}</small>}
                  {result.source === "akkords" &&
                    relevance(result, searched).exact && (
                      <span className="recommendation">{t("Рекомендуем")}</span>
                    )}
                </div>
                <button
                  disabled={previewBusy}
                  onClick={() => void showPreview(result.url)}
                >
                  {t("Предпросмотр")}
                </button>
              </div>
            ))}
          </article>
        ))}
      </div>
      <details
        open={manual}
        onToggle={(e) => setManual(e.currentTarget.open)}
        className="manual-import"
      >
        <DisclosureSummary>
          <FileText size={16} />
          {t("Вставить текст с аккордами вручную")}
        </DisclosureSummary>
        <p className="muted">
          {t(
            "Скопируйте только разбор. Поддерживаются аккорды над текстом и вставки [Am]внутри строки. Пробелы над текстом задают позиции аккордов.",
          )}
        </p>
        <div className="manual-import-meta">
          <label>
            {t("Название")}
            <input
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            {t("Исполнитель")}
            <input
              value={artist}
              maxLength={200}
              onChange={(e) => setArtist(e.target.value)}
            />
          </label>
        </div>
        <label>
          {t("Текст с аккордами")}
          <textarea
            rows={10}
            maxLength={200000}
            value={manualText}
            placeholder={t("[Куплет]\nAm         E\nВаши слова здесь")}
            onChange={(e) => setManualText(e.target.value)}
          />
        </label>
        <button
          disabled={!manualText.trim() || previewBusy}
          onClick={() => void previewManual()}
        >
          {t("Проверить импорт")}
        </button>
      </details>
      {preview && (
        <dialog
          ref={dialog}
          className="source-preview"
          onCancel={(e) => {
            if (importing) e.preventDefault();
            else setPreview(null);
          }}
        >
          <header>
            <div>
              <p className="overline">{t("Предпросмотр")}</p>
              <h2>{preview.song.title}</h2>
              <p className="muted">{preview.song.artist}</p>
            </div>
            <button
              aria-label={t("Закрыть предпросмотр")}
              disabled={importing}
              onClick={() => setPreview(null)}
            >
              <X size={18} />
            </button>
          </header>
          {preview.source.url && webLink(preview.source.url) && (
            <a href={preview.source.url} target="_blank" rel="noreferrer">
              {t(preview.source.name)} {t(" · Открыть источник")}{" "}
              <ExternalLink size={13} />
            </a>
          )}
          {preview.source.author && (
            <p className="muted">
              {t("Подбор: ")}
              {preview.source.author}
            </p>
          )}
          {preview.warnings.map((warning, i) => (
            <p className="notice" key={i}>
              {translateError(locale, warning)}
            </p>
          ))}
          {duplicate && (
            <p className="notice">
              {t("Этот источник уже есть в библиотеке.")}{" "}
              <button
                onClick={() => {
                  setPreview(null);
                  onOpen(duplicate.id);
                }}
              >
                {t("Открыть существующую песню")}
              </button>
            </p>
          )}
          <div className="source-preview-lyrics">
            {preview.song.sections.map((section) => (
              <section key={section.id}>
                <h3>{section.name}</h3>
                {section.lines.map((line) => (
                  <Lyrics key={line.id} line={line} song={preview.song} />
                ))}
              </section>
            ))}
          </div>
          {error && (
            <p className="error" role="alert">
              {translateError(locale, error)}
            </p>
          )}
          <footer>
            <span className="muted">{t("Аудио прикрепляется отдельно.")}</span>
            <button
              className="primary"
              disabled={importing}
              onClick={() => void add()}
            >
              <Plus size={16} />
              {importing
                ? t("Добавляю…")
                : duplicate
                  ? t("Создать отдельную копию")
                  : t("Добавить в библиотеку")}
            </button>
          </footer>
        </dialog>
      )}
    </section>
  );
}
