import { useI18n, translateError, I18nProvider } from "./i18n";
import { useChordLayer } from "./chordLayer";
import DisclosureSummary from "./DisclosureSummary";
import { validWords } from "./timeline";
import {
  memo,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Music2,
  Library,
  Settings2,
  Plus,
  Search,
  Upload,
  Download,
  ArrowLeft,
  Undo2,
  Redo2,
  Play,
  Trash2,
  X,
  Check,
  MoveRight,
  Pencil,
  BookOpen,
  Save,
  Moon,
  Sun,
} from "lucide-react";
import { APP_NAME, PRODUCT_NAME } from "./config";
import {
  NAV_KEYS,
  readSetting,
  useNavigation,
  writeSetting,
  type View,
} from "./navigation";
import { createSong, id, normalizeChord, type Song, type Line } from "./model";
const Performance = lazy(() => import("./Performance"));
const LrclibDialog = lazy(() => import("./LrclibDialog"));
const Welcome = lazy(() => import("./Welcome"));
import PolicyFooter from "./PolicyFooter";
import SourceSearch from "./SourceSearch";
import SongStatus from "./SongStatus";
const SOURCE_NAMES: Record<string, string> = {
  akkords: "Akkords.pro",
  mychords: "MyChords.net",
  chorder: "Chorder.ru",
  ultimate: "Ultimate Guitar",
};
import { splitLine } from "./document";

import { api } from "./api";
import AnalysisPanel from "./AnalysisPanel";

function IconButton({
  title,
  children,
  onClick,
  disabled = false,
}: {
  title: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon-button"
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <IconButton title={t("Закрыть")} onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
type Target = {
  lineId: string;
  offset: number;
  occurrenceId?: string;
  x: number;
  y: number;
  bottom: number;
};
function ChordPopover({
  target,
  song,
  onPick,
  onNew,
  onDelete,
  onMove,
  onClose,
}: {
  target: Target;
  song: Song;
  onPick: (paletteId: string) => void;
  onNew: () => void;
  onDelete: () => void;
  onMove: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(target.bottom + 8);
  useLayoutEffect(() => {
    const el = ref.current!;
    const h = el.offsetHeight;
    setTop(
      target.bottom + h + 16 < innerHeight
        ? target.bottom + 8
        : Math.max(8, target.y - h - 8),
    );
    el.querySelector<HTMLButtonElement>("button")?.focus();
  }, [target]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (
        ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Tab"].includes(
          e.key,
        )
      ) {
        const buttons = Array.from(
          ref.current!.querySelectorAll<HTMLButtonElement>("button"),
        );
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        buttons[
          (at +
            (["ArrowLeft", "ArrowUp"].includes(e.key) || e.shiftKey ? -1 : 1) +
            buttons.length) %
            buttons.length
        ]?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("Выбор аккорда")}
      className="popover"
      style={{ left: Math.max(12, Math.min(target.x, innerWidth - 332)), top }}
    >
      <p className="overline">
        {target.occurrenceId ? t("Заменить аккорд") : t("Добавить аккорд")}
      </p>
      <div className="chord-options">
        {song.palette.map((c) => (
          <button key={c.id} onClick={() => onPick(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      <button className="popover-command" onClick={onNew}>
        <Plus size={16} />
        {t("Другой аккорд…")}
      </button>
      {target.occurrenceId && (
        <>
          <button className="popover-command" onClick={onMove}>
            <MoveRight size={16} />
            {t("Переместить…")}
          </button>
          <button className="popover-command danger" onClick={onDelete}>
            <Trash2 size={16} />
            {t("Удалить в этом месте")}
          </button>
        </>
      )}
    </div>
  );
}
function ChordCreator({
  onDone,
  onClose,
}: {
  onDone: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [root, setRoot] = useState("A");
  const [acc, setAcc] = useState("");
  const [quality, setQuality] = useState("");
  const [bass, setBass] = useState("");
  const normalized = normalizeChord(value);
  function build(r: string, a: string, q: string, b: string) {
    setRoot(r);
    setAcc(a);
    setQuality(q);
    setBass(b);
    setValue(r + a + q + (b ? "/" + b : ""));
  }
  return (
    <Modal title={t("Новый аккорд")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (normalized) onDone(normalized);
        }}
      >
        <label>
          {t("Название")}
          <input
            autoFocus
            placeholder={t("F♯m или D/F♯")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={24}
          />
        </label>
        <div className="builder">
          <label>
            {t("Основа")}
            <select
              value={root}
              onChange={(e) => build(e.target.value, acc, quality, bass)}
            >
              {"ABCDEFG".split("").map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            {t("Знак")}
            <select
              value={acc}
              onChange={(e) => build(root, e.target.value, quality, bass)}
            >
              <option value="">{t("Нет")}</option>
              <option>♯</option>
              <option>♭</option>
            </select>
          </label>
          <label>
            {t("Тип")}
            <select
              value={quality}
              onChange={(e) => build(root, acc, e.target.value, bass)}
            >
              {[
                "",
                "m",
                "7",
                "maj7",
                "m7",
                "sus2",
                "sus4",
                "dim",
                "aug",
                "add9",
              ].map((v) => (
                <option key={v} value={v}>
                  {v || "major"}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Бас")}
            <input
              value={bass}
              placeholder="F♯"
              onChange={(e) => build(root, acc, quality, e.target.value)}
            />
          </label>
        </div>
        <p className="muted">
          {value
            ? normalized
              ? t("Будет добавлен {normalized}", { normalized: normalized })
              : t(
                  "Используйте A–G, ♯/♭, тип из списка и необязательный бас A–G.",
                )
            : t("Введите название или соберите аккорд.")}
        </p>
        <button className="primary" disabled={!normalized} type="submit">
          <Check size={17} />
          {t("Добавить")}
        </button>
      </form>
    </Modal>
  );
}
export const Lyrics = memo(function Lyrics({
  line,
  song,
  onPosition,
  large = false,
  position,
}: {
  line: Line;
  song: Song;
  onPosition?: (
    offset: number,
    occurrenceId: string | undefined,
    el: HTMLElement,
  ) => void;
  large?: boolean;
  position?: number;
}) {
  const { t } = useI18n();
  const lyricRoot = useChordLayer(line, song.palette);
  const chars = Array.from(line.text);
  const groups: { char: string; offset: number }[][] = [];
  let offset = 0;
  for (const token of line.text.match(/\S+\s*|\s+/gu) || []) {
    groups.push(Array.from(token).map((char) => ({ char, offset: offset++ })));
  }
  groups.push([{ char: "", offset: chars.length }]);
  return (
    <div
      ref={lyricRoot}
      className={"lyric-preview" + (large ? " large" : "")}
      aria-label={line.text || t("Инструментальная строка")}
    >
      {groups.map((group, index) => (
        <span
          className={
            "lyric-word" +
            (position !== undefined && validWords(line) && line.words?.[index]
              ? " timed-word" +
                (position >= line.words[index].start ? " word-reached" : "")
              : "")
          }
          key={index}
          style={
            position !== undefined && validWords(line) && line.words?.[index]
              ? ({
                  "--word-progress": `${Math.max(0, Math.min(1, (position - line.words[index].start) / (line.words[index].end - line.words[index].start))) * 100}%`,
                } as React.CSSProperties)
              : undefined
          }
        >
          {group.map(({ char, offset }) => {
            const chords = line.chords.filter((c) => c.offset === offset);
            return (
              <span
                className={
                  "lyric-cell" + (offset === chars.length ? " line-end" : "")
                }
                key={offset}
              >
                <span className="above">
                  {chords.map((c) =>
                    onPosition ? (
                      <button
                        className="chord"
                        key={c.id}
                        title={t("Заменить аккорд")}
                        aria-label={t("Аккорд {value0}, позиция {value1}", {
                          value0: song.palette.find((p) => p.id === c.paletteId)
                            ?.name,
                          value1: offset + 1,
                        })}
                        onClick={(e) =>
                          onPosition(offset, c.id, e.currentTarget)
                        }
                      >
                        {song.palette.find((p) => p.id === c.paletteId)?.name}
                      </button>
                    ) : (
                      <span className="chord" key={c.id}>
                        {song.palette.find((p) => p.id === c.paletteId)?.name}
                      </span>
                    ),
                  )}
                </span>
                {onPosition ? (
                  <button
                    className="letter"
                    aria-label={t(
                      "Поставить аккорд: {value0}, позиция {value1}",
                      { value0: char || t("конец строки"), value1: offset + 1 },
                    )}
                    onClick={(e) =>
                      onPosition(offset, undefined, e.currentTarget)
                    }
                  >
                    {char === " " ? "\u00a0" : char || "\u200b"}
                  </button>
                ) : (
                  <span className="letter">
                    {char === " " ? "\u00a0" : char || "\u200b"}
                  </span>
                )}
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
});
function AppContent() {
  const { t, locale, setLocale, formatDate } = useI18n();
  const { route, navigate, welcomeAtStartup, setWelcomeAtStartup } =
    useNavigation();
  const [lightTheme, setLightTheme] = useState(
    () => readSetting(NAV_KEYS.theme) === "light",
  );
  useEffect(() => {
    const theme = lightTheme ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    writeSetting(NAV_KEYS.theme, theme);
  }, [lightTheme]);
  const view = route.view;
  const [songs, setSongs] = useState<Song[]>([]);
  const [selected, setSelected] = useState<string | null>(
    () => route.songId ?? readSetting(NAV_KEYS.song),
  );
  function setView(view: View) {
    navigate({
      view,
      songId:
        view === "editor" || view === "performance"
          ? (selected ?? undefined)
          : undefined,
    });
  }
  useLayoutEffect(() => {
    if (route.songId) {
      setSelected(route.songId);
      setPast([]);
      setFuture([]);
      setEditing(null);
      setTarget(null);
      setMoving(null);
    }
  }, [route.songId]);
  const [query, setQuery] = useState("");
  const [libraryMode, setLibraryMode] = useState<"local" | "sources">("local");
  const [sourceSearchNonce, setSourceSearchNonce] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncSearch, setSyncSearch] = useState(false);
  const [playerPanel, setPlayerPanel] = useState<
    "sync" | "mixer" | undefined
  >();
  const [states, setStates] = useState<Record<string, string>>({});
  const [past, setPast] = useState<Song[]>([]);
  const [future, setFuture] = useState<Song[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [creator, setCreator] = useState(false);
  const [replace, setReplace] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ lineId: string; id: string } | null>(
    null,
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const latest = useRef(songs);
  latest.current = songs;
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const queue = useRef(Promise.resolve());
  const audioUpdates = useRef<Record<string, Song["audio"]>>({});
  const revisions = useRef<Record<string, number>>({});
  const importer = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const song = songs.find((s) => s.id === selected);
  function status(songId: string, value: string) {
    setStates((s) => ({ ...s, [songId]: value }));
  }
  function save(doc: Song) {
    const revision = revisions.current[doc.id];
    status(doc.id, "Сохраняется");
    const request = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          const result = await api<Song>("/songs/" + doc.id, {
            method: "PUT",
            body: JSON.stringify({
              ...doc,
              audio:
                doc.id in audioUpdates.current
                  ? audioUpdates.current[doc.id]
                  : doc.audio,
            }),
          });
          if (revisions.current[doc.id] === revision) {
            status(doc.id, "Сохранено");
            try {
              localStorage.removeItem("vlad-draft-" + doc.id);
            } catch {}
            setError((current) =>
              current.startsWith("Изменения остались в браузере.")
                ? ""
                : current,
            );
            setSongs((ss) =>
              ss.map((s) =>
                s.id === doc.id ? { ...s, updatedAt: result.updatedAt } : s,
              ),
            );
          }
          return true;
        } catch (e) {
          status(doc.id, "Ошибка сохранения");
          setError("Изменения остались в браузере. " + (e as Error).message);
          return false;
        }
      });
    queue.current = request.then(() => {});
    return request;
  }
  function update(next: Song, history = true) {
    if (!song) return;
    const lines = next.sections.flatMap((s) => s.lines);
    if (
      next.palette.length > 200 ||
      next.sections.length > 200 ||
      lines.length > 2000 ||
      lines.some(
        (l) => Array.from(l.text).length > 10000 || l.chords.length > 2000,
      ) ||
      lines.reduce((n, l) => n + l.chords.length, 0) > 20000 ||
      new TextEncoder().encode(JSON.stringify(next)).length > 2_000_000
    ) {
      setError(
        "Документ превышает лимит: 200 разделов, 200 аккордов в палитре, 2000 строк, 20 000 вхождений и 2 МБ JSON.",
      );
      return;
    }
    if (history) {
      setPast((p) => [...p.slice(-99), structuredClone(song)]);
      setFuture([]);
    }
    const doc = { ...next, updatedAt: new Date().toISOString() };
    revisions.current[doc.id] = (revisions.current[doc.id] || 0) + 1;
    setSongs((ss) => ss.map((s) => (s.id === doc.id ? doc : s)));
    status(doc.id, "Есть изменения");
    try {
      localStorage.setItem("vlad-draft-" + doc.id, JSON.stringify(doc));
    } catch {
      setError(
        "Аварийный черновик не помещается в браузере. Не закрывайте вкладку до сохранения.",
      );
    }
    clearTimeout(timers.current[doc.id]);
    timers.current[doc.id] = setTimeout(() => save(doc), 650);
  }
  function mutate(fn: (draft: Song) => void) {
    if (!song) return;
    const next = structuredClone(song);
    fn(next);
    update(next);
  }
  function changeLine(lineId: string, fn: (line: Line) => Line) {
    mutate((d) => {
      for (const section of d.sections)
        section.lines = section.lines.map((l) => (l.id === lineId ? fn(l) : l));
    });
  }
  function undo() {
    if (!song || !past.length) return;
    setFuture((f) => [structuredClone(song), ...f]);
    update({ ...past[past.length - 1], audio: song.audio }, false);
    setPast((p) => p.slice(0, -1));
    setTarget(null);
  }
  function redo() {
    if (!song || !future.length) return;
    setPast((p) => [...p, structuredClone(song)]);
    update({ ...future[0], audio: song.audio }, false);
    setFuture((f) => f.slice(1));
    setTarget(null);
  }
  useEffect(() => {
    api<Song[]>("/songs")
      .then((result) => {
        const recovered = result.map((s) => {
          try {
            const raw = localStorage.getItem("vlad-draft-" + s.id);
            if (raw) {
              const draft = JSON.parse(raw) as Song;
              if (
                draft.schemaVersion === 1 &&
                draft.id === s.id &&
                Array.isArray(draft.sections) &&
                Array.isArray(draft.palette) &&
                Date.parse(draft.updatedAt) > Date.parse(s.updatedAt)
              ) {
                status(s.id, "Восстановлен черновик");
                return draft;
              }
            }
          } catch {}
          return s;
        });
        setSongs(recovered);
      })
      .catch((e) => setError("Не удалось открыть библиотеку. " + e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (Object.values(states).some((s) => s !== "Сохранено")) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [states]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        view === "editor" &&
        !(
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        )
      ) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    if (view === "settings")
      api<Record<string, unknown>>("/health")
        .then(setHealth)
        .catch((e) => setError(e.message));
  }, [view]);
  async function create(demo = false) {
    try {
      const result = await api<Song>("/songs", {
        method: "POST",
        body: JSON.stringify(createSong(demo)),
      });
      setSongs((s) => [result, ...s]);
      open(result.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function open(songId: string) {
    setSelected(songId);
    navigate({ view: "editor", songId });
    setPast([]);
    setFuture([]);
    setEditing(null);
    setTarget(null);
    setMoving(null);
  }
  function closePopover() {
    setTarget(null);
    returnFocus.current?.focus();
  }
  function position(
    lineId: string,
    offset: number,
    occurrenceId: string | undefined,
    el: HTMLElement,
  ) {
    if (moving) {
      mutate((d) => {
        let occurrence: Line["chords"][number] | undefined;
        for (const s of d.sections)
          for (const l of s.lines) {
            if (l.id === moving.lineId) {
              occurrence = l.chords.find((c) => c.id === moving.id);
              l.chords = l.chords.filter((c) => c.id !== moving.id);
            }
          }
        if (occurrence)
          for (const s of d.sections)
            for (const l of s.lines)
              if (l.id === lineId)
                l.chords.push({
                  ...occurrence,
                  offset,
                  source: "manual",
                  start: undefined,
                  end: undefined,
                });
      });
      setMoving(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    returnFocus.current = el;
    setTarget({
      lineId,
      offset,
      occurrenceId,
      x: rect.left,
      y: rect.top,
      bottom: rect.bottom,
    });
  }
  function pick(paletteId: string) {
    if (!target) return;
    changeLine(target.lineId, (l) => ({
      ...l,
      chords: target.occurrenceId
        ? l.chords.map((c) =>
            c.id === target.occurrenceId
              ? { ...c, paletteId, source: "manual" }
              : c,
          )
        : [
            ...l.chords,
            { id: id(), paletteId, offset: target.offset, source: "manual" },
          ],
    }));
    closePopover();
  }
  function addChord(name: string) {
    mutate((d) => {
      let chord = d.palette.find((p) => p.name === name);
      if (!chord) {
        chord = { id: id(), name };
        d.palette.push(chord);
      }
      if (target)
        for (const section of d.sections)
          for (const l of section.lines)
            if (l.id === target.lineId) {
              if (target.occurrenceId)
                l.chords = l.chords.map((c) =>
                  c.id === target.occurrenceId
                    ? { ...c, paletteId: chord!.id, source: "manual" }
                    : c,
                );
              else
                l.chords.push({
                  id: id(),
                  paletteId: chord.id,
                  offset: target.offset,
                  source: "manual",
                });
            }
    });
    setCreator(false);
    closePopover();
  }
  function exportSong() {
    if (!song) return;
    const blob = new Blob([JSON.stringify(song, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      (song.title.replace(/[<>:"/\\|?*]/g, "_") || "Песня") + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importSong(file: File) {
    try {
      if (file.size > 2_000_000)
        throw new Error("JSON должен быть меньше 2 МБ.");
      const parsed = JSON.parse(await file.text());
      const result = await api<Song>("/import", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      setSongs((s) => [result, ...s]);
      open(result.id);
    } catch (e) {
      setError("Не удалось импортировать песню. " + (e as Error).message);
    }
  }
  async function uploadAudio(file: File, currentSong = song) {
    if (!currentSong) return;
    const songId = currentSong.id;
    try {
      if (file.size > 50 * 1024 * 1024)
        throw new Error("MP3 должен быть меньше 50 МиБ.");
      clearTimeout(timers.current[songId]);
      save(currentSong);
      const upload = queue.current.then(async () => {
        const result = await api<Song>(
          "/songs/" +
            songId +
            "/audio?filename=" +
            encodeURIComponent(file.name),
          {
            method: "PUT",
            body: file,
            headers: { "Content-Type": "audio/mpeg" },
          },
        );
        const current = latest.current.find((s) => s.id === songId);
        if (!current) return;
        audioUpdates.current[songId] = result.audio;
        const merged = {
          ...current,
          audio: result.audio,
          sections: current.audio
            ? current.sections.map((section) => ({
                ...section,
                lines: section.lines.map((line) =>
                  line.start !== undefined || line.words
                    ? { ...line, timingReview: true }
                    : line,
                ),
              }))
            : current.sections,
          updatedAt: new Date().toISOString(),
        };
        revisions.current[songId] = (revisions.current[songId] || 0) + 1;
        try {
          localStorage.setItem("vlad-draft-" + songId, JSON.stringify(merged));
        } catch {
          setError("Не удалось сохранить аварийный черновик в браузере.");
        }
        latest.current = latest.current.map((d) =>
          d.id === songId ? merged : d,
        );
        setSongs((ss) => ss.map((d) => (d.id === songId ? merged : d)));
        return merged;
      });
      queue.current = upload.then(
        () => {},
        () => {},
      );
      const merged = await upload;
      if (merged) {
        clearTimeout(timers.current[songId]);
        save(merged);
      }
    } catch (e) {
      setError("Не удалось загрузить MP3. " + (e as Error).message);
    }
  }
  const replacementCount =
    song?.sections
      .flatMap((s) => s.lines)
      .flatMap((l) => l.chords)
      .filter((c) => c.paletteId === from).length || 0;
  const lastSong = songs.find((item) => item.id === readSetting(NAV_KEYS.song));
  if (view === "welcome")
    return (
      <Suspense fallback={null}>
        <Welcome
          onLibrary={(search = false) => {
            setLibraryMode(search ? "sources" : "local");
            setView("library");
          }}
          onContinue={lastSong ? () => open(lastSong.id) : undefined}
          lastTitle={lastSong?.title}
          hasAudio={!!lastSong?.audio}
          onWorkspace={(panel) => {
            if (!lastSong) {
              setLibraryMode("local");
              setView("library");
              return;
            }
            setSelected(lastSong.id);
            if (panel === "mixer" && !lastSong.audio) {
              navigate({view:"editor", songId:lastSong.id});
              return;
            }
            setPlayerPanel(panel);
            navigate({ view: "performance", songId: lastSong.id });
          }}
        />
      </Suspense>
    );
  return (
    <div className={`app app-${view}`}>
      <a className="skip-link" href="#workspace-main">
        {t("К содержимому")}
      </a>
      <aside className="sidebar">
        <button
          className="brand"
          aria-label={t("Открыть приветствие")}
          title={t("Открыть приветствие")}
          onClick={() => setView("welcome")}
        >
          <span className="brand-mark">
            <Music2 size={23} />
          </span>
          <span className="brand-name">
            {PRODUCT_NAME}
            <small>{APP_NAME}</small>
          </span>
        </button>
        <nav>
          <button
            className={view === "library" ? "active" : ""}
            aria-current={view === "library" ? "page" : undefined}
            onClick={() => setView("library")}
          >
            <Library size={19} />
            {t("Библиотека")}
            <span>{songs.length}</span>
          </button>
          {song && (
            <button
              className={
                view === "editor" || view === "performance" ? "active" : ""
              }
              onClick={() => setView("editor")}
            >
              <BookOpen size={19} />
              {t("Открытая песня")}
            </button>
          )}
          <button
            className={view === "settings" ? "active" : ""}
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => setView("settings")}
          >
            <Settings2 size={19} />
            {t("Настройки")}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="local-dot" /> {t(" На этом компьютере")}
          <p>{t("Ваша музыка остаётся у вас.")}</p>
        </div>
      </aside>
      <main id="workspace-main">
        <input
          ref={importer}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            if (e.target.files?.[0]) void importSong(e.target.files[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={audioInput}
          type="file"
          accept=".mp3,audio/mpeg"
          hidden
          onChange={(e) => {
            if (e.target.files?.[0]) {
              const file = e.target.files[0];
              if (view === "library")
                void (async () => {
                  try {
                    const doc = createSong();
                    doc.title = file.name.replace(/\\.mp3$/i, "");
                    const created = await api<Song>("/songs", {
                      method: "POST",
                      body: JSON.stringify(doc),
                    });
                    setSongs((s) => [created, ...s]);
                    open(created.id);
                    await uploadAudio(file, created);
                  } catch (error) {
                    setError((error as Error).message);
                  }
                })();
              else void uploadAudio(file);
            }
            e.target.value = "";
          }}
        />
        {error && (
          <div className="error" role="alert">
            {translateError(locale, error)}
            <IconButton
              title={t("Закрыть сообщение")}
              onClick={() => setError("")}
            >
              <X size={17} />
            </IconButton>
          </div>
        )}
        {view === "library" && (
          <>
            <header className="page-header">
              <div>
                <p className="overline">{t("Личное пространство")}</p>
                <h1>{t("Библиотека")}</h1>
                <p className="muted">
                  {t("Песни, к которым хочется возвращаться.")}
                </p>
              </div>
              <div className="actions">
                <button onClick={() => audioInput.current?.click()}>
                  <Upload size={17} />
                  {t("Загрузить MP3")}
                </button>
                <button onClick={() => importer.current?.click()}>
                  <Upload size={17} />
                  {t("Импорт JSON")}
                </button>
                <button className="primary" onClick={() => void create()}>
                  <Plus size={18} />
                  {t("Новая песня")}
                </button>
              </div>
            </header>
            <div className="library-tools">
              <label className="search">
                <Search size={18} />
                <input
                  aria-label={t("Поиск песен")}
                  placeholder={t("Название песни или исполнитель")}
                  value={query}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && query.trim()) {
                      setLibraryMode("sources");
                      setSourceSearchNonce((n) => n + 1);
                    }
                  }}
                  onPaste={(e) => {
                    if (
                      /^https?:\/\//i.test(
                        e.clipboardData.getData("text").trim(),
                      )
                    ) {
                      setLibraryMode("sources");
                      setSourceSearchNonce((n) => n + 1);
                    }
                  }}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <span className="muted">
                {t("Песен: {count}", { count: songs.length })}
              </span>
            </div>
            <div className="library-mode" aria-label={t("Где искать")}>
              <button
                aria-pressed={libraryMode === "local"}
                onClick={() => setLibraryMode("local")}
              >
                {t("Моя библиотека")}
              </button>
              <button
                aria-pressed={libraryMode === "sources"}
                onClick={() => setLibraryMode("sources")}
              >
                {t("Найти разбор")}
              </button>
            </div>
            {libraryMode === "sources" ? (
              <SourceSearch
                query={query}
                autoSearch={sourceSearchNonce}
                songs={songs}
                onOpen={open}
                onAdded={(created) => {
                  setSongs((current) => [created, ...current]);
                  open(created.id);
                }}
              />
            ) : loading ? (
              <p className="empty">{t("Открываю библиотеку…")}</p>
            ) : songs.length === 0 ? (
              <div className="empty">
                <Music2 size={42} />
                <h2>{t("Начните со своей песни")}</h2>
                <p>
                  {t("Создайте песню, добавьте текст и расставьте аккорды.")}
                  <br />
                  {t("Готовую карточку можно перенести через JSON.")}
                </p>
                <div className="actions">
                  <button className="primary" onClick={() => void create()}>
                    <Plus size={17} />
                    {t("Создать песню")}
                  </button>
                  <button onClick={() => void create(true)}>
                    {t("Открыть авторский пример")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="song-list">
                {songs
                  .filter((s) =>
                    (s.title + " " + s.artist)
                      .toLocaleLowerCase(locale)
                      .includes(query.toLocaleLowerCase(locale)),
                  )
                  .map((s, index) => (
                    <article className="song-row" key={s.id}>
                      <span className="song-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <button className="song-open" onClick={() => open(s.id)}>
                        <span className="song-title">
                          {s.title || t("Без названия")}
                        </span>
                        <span className="muted">
                          {s.artist || t("Исполнитель не указан")}
                        </span>
                      </button>
                      <span className="language">
                        {{ ru: t("РУ"), uk: t("УКР"), en: "EN" }[s.language]}
                      </span>
                      <span className="song-meta">
                        {s.audio ? t("С аудио") : t("Текст и аккорды")}
                        <small>
                          {s.origin
                            ? `${SOURCE_NAMES[s.origin.site] || s.origin.site}${s.origin.variant ? ` · ${s.origin.variant}` : ""}`
                            : s.source === "model"
                              ? t("Черновик анализа")
                              : t("Ручная редакция")}
                        </small>
                        <small>
                          {s.sections.some((section) =>
                            section.lines.some(
                              (line) =>
                                line.start !== undefined && !line.timingReview,
                            ),
                          )
                            ? t("Есть синхронизация")
                            : t("Без синхронизации")}
                        </small>
                        <button
                          className="song-sync-link"
                          onClick={() => {
                            open(s.id);
                            setSyncSearch(true);
                          }}
                        >
                          {t("Найти синхронизацию")}
                        </button>
                      </span>
                      <time dateTime={s.updatedAt}>
                        {formatDate(s.updatedAt)}
                      </time>
                      <IconButton
                        title={t("Переименовать")}
                        onClick={() => open(s.id)}
                      >
                        <Pencil size={16} />
                      </IconButton>
                      <IconButton
                        title={t("Удалить {value0}", { value0: s.title })}
                        onClick={() => setDeleteId(s.id)}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </article>
                  ))}
                {songs.length > 0 &&
                  !songs.some((s) =>
                    (s.title + " " + s.artist)
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  ) && <p className="empty">{t("Песни не найдены.")}</p>}
              </div>
            )}
            <footer className="library-footer">
              {t("Локальная библиотека")}{" "}
              <span>
                {t(
                  "JSON сохраняет текст, аккорды и разметку. Аудио и дорожки переносятся отдельно.",
                )}
              </span>
            </footer>
          </>
        )}
        {view === "editor" && song && (
          <>
            <header className="editor-header">
              <button
                className="text-button"
                onClick={() => setView("library")}
              >
                <ArrowLeft size={17} />
                {t("Библиотека")}
              </button>
              <div className="actions">
                <span
                  className={
                    "save-state " +
                    (states[song.id] === "Ошибка сохранения" ? "danger" : "")
                  }
                  role="status"
                >
                  <span className="local-dot" />
                  {t(states[song.id] || "Сохранено")}
                </span>
                <IconButton
                  title={t("Сохранить сейчас")}
                  onClick={() => {
                    clearTimeout(timers.current[song.id]);
                    save(song);
                  }}
                >
                  <Save size={17} />
                </IconButton>
                <IconButton
                  title={t("Экспорт JSON без MP3")}
                  onClick={exportSong}
                >
                  <Download size={18} />
                </IconButton>
                <button
                  className="primary"
                  onClick={() => {
                    setTarget(null);
                    setView("performance");
                  }}
                >
                  <Play size={16} />
                  {t("Открыть плеер")}
                </button>
              </div>
            </header>
            <div className="song-heading">
              <p className="overline">{t("Редактор песни")}</p>
              <input
                className="title-input"
                aria-label={t("Название песни")}
                value={song.title}
                onChange={(e) =>
                  mutate((d) => {
                    d.title = e.target.value;
                  })
                }
                placeholder={t("Название песни")}
                maxLength={200}
              />
              <div className="song-details">
                <input
                  aria-label={t("Исполнитель")}
                  value={song.artist}
                  onChange={(e) =>
                    mutate((d) => {
                      d.artist = e.target.value;
                    })
                  }
                  placeholder={t("Исполнитель")}
                  maxLength={200}
                />
                <select
                  aria-label={t("Язык песни")}
                  value={song.language}
                  onChange={(e) =>
                    mutate((d) => {
                      d.language = e.target.value as Song["language"];
                    })
                  }
                >
                  <option value="ru">{t("Русский")}</option>
                  <option value="uk">{t("Українська")}</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
            <div className="editor-toolbar">
              <div>
                <span className="overline">{t("Аккорды песни")}</span>
                <div className="palette">
                  {song.palette.map((c) => (
                    <span className="palette-chord" key={c.id}>
                      {c.name}
                    </span>
                  ))}
                  <IconButton
                    title={t("Добавить аккорд в палитру")}
                    onClick={() => {
                      setTarget(null);
                      setCreator(true);
                    }}
                  >
                    <Plus size={17} />
                  </IconButton>
                </div>
              </div>
              <div className="actions">
                <button
                  className="text-button"
                  disabled={song.palette.length < 2}
                  onClick={() => {
                    setFrom(song.palette[0]?.id || "");
                    setTo(song.palette[1]?.id || "");
                    setReplace(true);
                  }}
                >
                  {t("Заменить все…")}
                </button>
                <span className="toolbar-divider" />
                <IconButton
                  title={t("Отменить")}
                  onClick={undo}
                  disabled={!past.length}
                >
                  <Undo2 size={18} />
                </IconButton>
                <IconButton
                  title={t("Повторить")}
                  onClick={redo}
                  disabled={!future.length}
                >
                  <Redo2 size={18} />
                </IconButton>
              </div>
            </div>
            {moving && (
              <div className="notice" role="status">
                {t("Выберите новую позицию аккорда в тексте.")}
                <button onClick={() => setMoving(null)}>{t("Отмена")}</button>
              </div>
            )}
            {song.origin && (
              <p className="source-credit">
                <a href={song.origin.url} target="_blank" rel="noreferrer">
                  {t("Открыть источник ↗")}
                </a>
                <span>
                  {SOURCE_NAMES[song.origin.site] || song.origin.site}
                  {song.origin.author
                    ? t(" · Подбор: {value0}", { value0: song.origin.author })
                    : ""}
                  {song.origin.variant ? ` · ${song.origin.variant}` : ""}
                </span>
              </p>
            )}
            <div className="editor-layout">
              <div className="document">
                {song.sections.map((section, sectionIndex) => (
                  <section className="song-section" key={section.id}>
                    <div className="section-heading">
                      <span className="section-index">
                        {String(sectionIndex + 1).padStart(2, "0")}
                      </span>
                      <input
                        aria-label={t("Название раздела")}
                        value={section.name}
                        maxLength={100}
                        onChange={(e) =>
                          mutate((d) => {
                            d.sections.find((s) => s.id === section.id)!.name =
                              e.target.value;
                          })
                        }
                      />
                      <IconButton
                        title={t("Удалить раздел")}
                        onClick={() => {
                          if (
                            confirm(
                              t(
                                "Удалить раздел вместе со строками? Это можно отменить.",
                              ),
                            )
                          )
                            mutate((d) => {
                              d.sections = d.sections.filter(
                                (s) => s.id !== section.id,
                              );
                            });
                        }}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                    {section.lines.map((line, index) => (
                      <div
                        className={
                          "editor-line " +
                          (editing === line.id ? "editing" : "")
                        }
                        key={line.id}
                      >
                        <span className="line-number">{index + 1}</span>
                        <div className="line-content">
                          {line.start !== undefined && (
                            <small
                              className="line-timestamp"
                              title={t(
                                "Приблизительное начало в исходной записи",
                              )}
                            >
                              {Math.floor(line.start / 60)}:
                              {String(Math.floor(line.start % 60)).padStart(
                                2,
                                "0",
                              )}
                            </small>
                          )}
                          <Lyrics
                            line={line}
                            song={song}
                            onPosition={(o, c, el) =>
                              position(line.id, o, c, el)
                            }
                          />
                          {editing === line.id && (
                            <textarea
                              autoFocus
                              aria-label={t("Текст строки")}
                              value={line.text}
                              rows={Math.max(
                                2,
                                Math.ceil(line.text.length / 60),
                              )}
                              onChange={(e) => {
                                const text = e.target.value;
                                if (
                                  text
                                    .split(/\r?\n/)
                                    .some((t) => Array.from(t).length > 10000)
                                ) {
                                  setError(
                                    "В одной строке может быть до 10 000 символов.",
                                  );
                                  return;
                                }
                                mutate((d) => {
                                  const section = d.sections.find((s) =>
                                    s.lines.some((l) => l.id === line.id),
                                  )!;
                                  const result = splitLine(line, text);
                                  if (
                                    section.lines.length + result.length - 1 >
                                    2000
                                  ) {
                                    setError(
                                      "В разделе может быть до 2000 строк.",
                                    );
                                    return;
                                  }
                                  section.lines = section.lines.flatMap((l) =>
                                    l.id === line.id ? result : [l],
                                  );
                                  if (result.length > 1)
                                    setEditing(result[result.length - 1].id);
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setEditing(null);
                              }}
                            />
                          )}
                          {!line.text && !line.chords.length && (
                            <button
                              className="line-placeholder"
                              onClick={() => setEditing(line.id)}
                            >
                              {line.source === "model" &&
                              line.start !== undefined
                                ? t("Аккорд не определён")
                                : t("Пустая строка")}
                            </button>
                          )}
                        </div>
                        <div className="line-actions">
                          <IconButton
                            title={
                              editing === line.id
                                ? t("Готово")
                                : t("Изменить текст")
                            }
                            onClick={() =>
                              setEditing(editing === line.id ? null : line.id)
                            }
                          >
                            {editing === line.id ? (
                              <Check size={16} />
                            ) : (
                              <Pencil size={15} />
                            )}
                          </IconButton>
                          <IconButton
                            title={t("Удалить строку")}
                            onClick={() =>
                              mutate((d) => {
                                const s = d.sections.find(
                                  (s) => s.id === section.id,
                                )!;
                                s.lines = s.lines.filter(
                                  (l) => l.id !== line.id,
                                );
                              })
                            }
                          >
                            <X size={15} />
                          </IconButton>
                        </div>
                      </div>
                    ))}
                    <button
                      className="add-line text-button"
                      onClick={() => {
                        const lineId = id();
                        mutate((d) =>
                          d.sections
                            .find((s) => s.id === section.id)!
                            .lines.push({ id: lineId, text: "", chords: [] }),
                        );
                        setEditing(lineId);
                      }}
                    >
                      <Plus size={15} />
                      {t("Строка")}
                    </button>
                  </section>
                ))}
                <button
                  className="add-section"
                  onClick={() =>
                    mutate((d) =>
                      d.sections.push({
                        id: id(),
                        name: "Куплет",
                        lines: [{ id: id(), text: "", chords: [] }],
                      }),
                    )
                  }
                >
                  <Plus size={17} />
                  {t("Добавить раздел")}
                </button>
              </div>
              <aside className="audio-panel">
                <SongStatus song={song} />
                <button
                  className="sync-song-button"
                  onClick={() => setSyncSearch(true)}
                >
                  <Search size={16} />
                  {t("Найти синхронизацию")}
                </button>
                <p className="overline">{t("Исходная запись")}</p>
                {song.audio ? (
                  <>
                    <div className="audio-title">
                      <Music2 size={20} />
                      <span>{song.audio.filename}</span>
                    </div>
                    <audio controls preload="metadata" src={song.audio.url} />
                    <button
                      className="text-button"
                      onClick={() => audioInput.current?.click()}
                    >
                      <Upload size={15} />
                      {t("Заменить MP3")}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="audio-empty">
                      <Music2 size={26} />
                      <span>{t("Запись не добавлена")}</span>
                    </div>
                    <button onClick={() => audioInput.current?.click()}>
                      <Upload size={16} />
                      {t("Добавить MP3")}
                    </button>
                  </>
                )}
                <details className="optional-analysis">
                  <DisclosureSummary className="analysis-disclosure">
                    {t("Дополнительный анализ аудио")}
                  </DisclosureSummary>
                  <AnalysisPanel
                    song={song}
                    beforeStart={async () => {
                      clearTimeout(timers.current[song.id]);
                      if (!(await save(song)))
                        throw new Error(
                          "Сначала сохраните песню. Анализ не запущен.",
                        );
                    }}
                    onResult={(result) => {
                      setSongs((s) => [result, ...s]);
                      open(result.id);
                    }}
                  />
                </details>
                <div className="panel-note">{t("Текст и аккорды")}</div>
                <dl>
                  <div>
                    <dt>{t("Разделов")}</dt>
                    <dd>{song.sections.length}</dd>
                  </div>
                  <div>
                    <dt>{t("Строк")}</dt>
                    <dd>
                      {song.sections.reduce((n, s) => n + s.lines.length, 0)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Аккордов")}</dt>
                    <dd>
                      {song.sections
                        .flatMap((s) => s.lines)
                        .reduce((n, l) => n + l.chords.length, 0)}
                    </dd>
                  </div>
                </dl>
              </aside>
            </div>
          </>
        )}
        {view === "performance" && song && (
          <Suspense fallback={<p role="status">{t("Загрузка…")}</p>}>
            <Performance
              song={song}
              initialPanel={playerPanel}
              onPanelOpened={() => setPlayerPanel(undefined)}
              onSong={update}
              saveStatus={states[song.id] || "Сохранено"}
              onBack={() => setView("editor")}
              onSettings={(settings) =>
                mutate((d) => {
                  d.performance = settings;
                })
              }
            />
          </Suspense>
        )}
        {view === "settings" && (
          <div className="settings-page">
            <p className="overline">{t("На этом компьютере")}</p>
            <h1>{t("Настройки")}</h1>
            <p className="settings-intro">
              {t("Твоё пространство. Твои привычки.")}
            </p>
            <section className="startup-setting">
              <div className="settings-section-heading">
                <span>01</span>
                <h2>{t("Начало работы")}</h2>
              </div>
              <label className="setting-toggle">
                <input
                  type="checkbox"
                  aria-label={t("Показывать приветствие при запуске")}
                  aria-describedby="welcome-startup-description"
                  checked={welcomeAtStartup}
                  onChange={(event) =>
                    setWelcomeAtStartup(event.target.checked)
                  }
                />
                <span>
                  {t("Показывать приветствие при запуске")}
                  <small id="welcome-startup-description">
                    {t("Прямые ссылки на песни всегда открывают песню.")}
                  </small>
                </span>
              </label>
              <button
                className="text-button"
                onClick={() => setView("welcome")}
              >
                {t("Открыть приветствие")}
                <MoveRight size={16} />
              </button>
            </section>
            <section>
              <div className="settings-section-heading">
                <span>02</span>
                <h2>{t("Язык интерфейса")}</h2>
              </div>
              <label>
                <span className="sr-only">{t("Язык интерфейса")}</span>
                <select
                  value={locale}
                  onChange={(event) =>
                    setLocale(event.target.value as "ru" | "en")
                  }
                >
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                </select>
              </label>
            </section>
            <section>
              <div className="settings-section-heading">
                <span>03</span>
                <h2>{t("Локальные данные")}</h2>
              </div>
              <p className="muted">
                {t(
                  "Песни и аудио хранятся на этом компьютере. Каталог меняется перед запуском через VLAD_DATA_DIR.",
                )}
              </p>
              <code>
                {health
                  ? String(health.dataDir || health.data_dir || "data/")
                  : t("Загрузка…")}
              </code>
            </section>
            <section>
              <div className="settings-section-heading">
                <span>04</span>
                <h2>{t("Аудио и модели")}</h2>
              </div>
              <p>{t("Редактор и плеер работают без моделей.")}</p>
              <details>
                <DisclosureSummary>{t("Подробности")}</DisclosureSummary>
                <p className="muted">
                  {t(
                    "Разметка строк под запись и импорт LRC не требуют моделей. Распознавание Whisper оставлено как необязательный инструмент. Разделение вокала и сопровождения устанавливается отдельно; его состояние показано в плеере. Модели при запуске не скачиваются.",
                  )}
                </p>
                <p>
                  Whisper tiny:{" "}
                  {health
                    ? health.modelInstalled
                      ? t("модель установлена")
                      : t("модель не установлена")
                    : t("проверка…")}
                </p>
                <p>
                  {t("Обработчик текста:")}{" "}
                  {health
                    ? health.providerAvailable
                      ? t("установлен")
                      : t("не установлен")
                    : t("проверка…")}
                </p>
                <p>
                  FFmpeg:{" "}
                  {health
                    ? String(health.ffmpeg ? t("доступен") : t("не найден"))
                    : t("проверка…")}
                </p>
              </details>
            </section>
            <section>
              <div className="settings-section-heading">
                <span>05</span>
                <h2>{t("Оформление")}</h2>
              </div>
              <button
                type="button"
                className="theme-toggle"
                role="switch"
                aria-label={t("Тема оформления")}
                aria-checked={lightTheme}
                aria-describedby="theme-toggle-description"
                onClick={() => setLightTheme((current) => !current)}
              >
                <Moon size={16} aria-hidden="true" />
                <span className="theme-toggle-track" aria-hidden="true">
                  <span className="theme-toggle-thumb" />
                </span>
                <Sun size={17} aria-hidden="true" />
              </button>
              <p id="theme-toggle-description">
                {t(
                  "Луна — тёмная тема, солнце — светлая. Выбор сохраняется на этом компьютере.",
                )}
              </p>
            </section>
          </div>
        )}
        {!loading && (view === "editor" || view === "performance") && !song && (
          <div className="empty">
            <Music2 size={38} />
            <h1>{t("Песня не найдена")}</h1>
            <p>{t("Возможно, она удалена из локальной библиотеки.")}</p>
            <button className="primary" onClick={() => setView("library")}>
              {t("Открыть библиотеку")}
            </button>
          </div>
        )}
        {view !== "performance" && <PolicyFooter />}
      </main>
      {syncSearch && song && (
        <Suspense fallback={<p role="status">{t("Загрузка…")}</p>}>
          <LrclibDialog
            key={song.id}
            song={song}
            onApply={update}
            onClose={() => setSyncSearch(false)}
          />
        </Suspense>
      )}
      {target && song && !creator && (
        <ChordPopover
          target={target}
          song={song}
          onPick={pick}
          onNew={() => setCreator(true)}
          onClose={closePopover}
          onDelete={() => {
            changeLine(target.lineId, (l) => ({
              ...l,
              chords: l.chords.filter((c) => c.id !== target.occurrenceId),
            }));
            closePopover();
          }}
          onMove={() => {
            setMoving({ lineId: target.lineId, id: target.occurrenceId! });
            closePopover();
          }}
        />
      )}
      {creator && song && (
        <ChordCreator
          onDone={addChord}
          onClose={() => {
            setCreator(false);
            closePopover();
          }}
        />
      )}
      {replace && song && (
        <Modal
          title={t("Заменить все вхождения")}
          onClose={() => setReplace(false)}
        >
          <div className="replacement">
            <label>
              {t("Аккорд")}
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                {song.palette.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <MoveRight size={20} />
            <label>
              {t("Заменить на")}
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                {song.palette.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p>
            {t("Будет заменено вхождений: ")}
            <strong>{replacementCount}</strong>
          </p>
          <button
            className="primary"
            disabled={from === to || !replacementCount}
            onClick={() => {
              mutate((d) => {
                for (const s of d.sections)
                  for (const l of s.lines)
                    for (const c of l.chords)
                      if (c.paletteId === from) {
                        c.paletteId = to;
                        c.source = "manual";
                      }
              });
              setReplace(false);
            }}
          >
            <Check size={17} />
            {t("Подтвердить замену")}
          </button>
        </Modal>
      )}
      {deleteId && (
        <Modal title={t("Удалить песню?")} onClose={() => setDeleteId(null)}>
          <p>
            «{songs.find((s) => s.id === deleteId)?.title}
            {t(
              "» и её локальная аудиозапись будут удалены. Это действие нельзя отменить.",
            )}
          </p>
          <button
            className="destructive"
            onClick={async () => {
              try {
                const deleting = deleteId;
                clearTimeout(timers.current[deleting]);
                await queue.current;
                await api("/songs/" + deleting, { method: "DELETE" });
                localStorage.removeItem("vlad-draft-" + deleting);
                localStorage.removeItem("vlad-timing-draft-" + deleting);
                setSongs((ss) => ss.filter((s) => s.id !== deleting));
                setStates((ss) => {
                  const next = { ...ss };
                  delete next[deleting];
                  return next;
                });
                if (selected === deleting) {
                  setSelected(null);
                  setView("library");
                }
                if (readSetting(NAV_KEYS.song) === deleting)
                  localStorage.removeItem(NAV_KEYS.song);
                setDeleteId(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Trash2 size={17} />
            {t("Удалить песню")}
          </button>
        </Modal>
      )}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}
