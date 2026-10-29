import { memo, useRef } from "react";
import type { RefObject } from "react";
import { Lyrics } from "./App";
import type { Line, Song } from "./model";
import { formatTime, lineStart } from "./playerTiming";
import { useWordPaint } from "./useWordPaint";
import type { WordPlan } from "./wordTiming";
import { useI18n } from "./i18n";

/** Stable row props keep the complete lyric document out of the media frame loop. */
export const PlayerLyricRow = memo(function PlayerLyricRow({
  line,
  song,
  index,
  active,
  selected,
  past,
  position,
  plan,
  playing = false,
  readPosition,
  highlighting = true,
  activeRef,
  onSelect,
}: {
  line: Line;
  song: Song;
  index: number;
  active: boolean;
  selected: boolean;
  past: boolean;
  position?: number;
  plan?: WordPlan;
  playing?: boolean;
  readPosition?: () => number;
  highlighting?: boolean;
  activeRef: RefObject<HTMLButtonElement | null>;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const wordsRoot = useRef<HTMLDivElement>(null);
  useWordPaint(
    wordsRoot,
    plan,
    position ?? 0,
    active,
    playing,
    readPosition ?? (() => position ?? 0),
    highlighting,
  );
  const start = lineStart(line);
  return (
    <button
      type="button"
      className={`player-line${active && highlighting ? " is-active" : ""}${selected ? " is-selected" : ""}${past && highlighting ? " is-past" : ""}`}
      ref={active ? activeRef : undefined}
      aria-label={`${t("Строка")} ${index + 1}: ${line.text || t("Инструментальная строка")}`}
      aria-current={active ? "step" : undefined}
      aria-pressed={selected}
      onClick={() => onSelect(line.id)}
    >
      <span className="player-line-number">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div
        ref={wordsRoot}
        className="player-row-lyrics"
        data-word-timing={plan?.kind ?? "line"}
      >
        <Lyrics line={line} song={song} large />
      </div>
      <span className="player-line-time">
        {line.timingReview
          ? t("проверить")
          : start === undefined
            ? "—"
            : formatTime(start)}
      </span>
    </button>
  );
});
