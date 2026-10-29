import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";

type Note = {
  id: string;
  x: number;
  y: number;
  stem: number;
  flag?: boolean;
  group: "upper" | "lower" | "left";
};

const NOTES: Note[] = [
  { id: "upper-a", x: 875, y: 248, stem: 62, flag: true, group: "upper" },
  { id: "upper-b", x: 984, y: 232, stem: 66, group: "upper" },
  { id: "upper-c", x: 1054, y: 256, stem: 66, flag: true, group: "upper" },
  { id: "lower-a", x: 1060, y: 578, stem: -72, group: "lower" },
  { id: "lower-b", x: 1210, y: 546, stem: -72, flag: true, group: "lower" },
  { id: "left-a", x: 96, y: 806, stem: -64, group: "left" },
];

const STAFFS = [
  {
    id: "upper",
    transform: "translate(760 120) rotate(-12)",
    width: 600,
    top: 80,
  },
  {
    id: "lower",
    transform: "translate(900 530) rotate(8)",
    width: 560,
    top: 0,
  },
  {
    id: "left",
    transform: "translate(-90 745) rotate(-8)",
    width: 480,
    top: 0,
  },
];

function keyActivates(event: KeyboardEvent<SVGGElement>) {
  if (event.key !== "Enter" && event.key !== " ") return false;
  event.preventDefault();
  return true;
}

export default function WelcomeMusicScore() {
  const { t } = useI18n();
  const [active, setActive] = useState<string | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    },
    [],
  );
  const pulse = (id: string) => {
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    setActive(id);
    pulseTimer.current = setTimeout(() => setActive(null), 520);
  };
  const label = active?.startsWith("staff-")
    ? t("Подсвечена нотная линейка")
    : active
      ? t("Пульсирует нота")
      : t("Интерактивные ноты");

  return (
    <svg
      className="welcome-music-score"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-label={label}
      role="group"
    >
      {STAFFS.map((staff) => (
        <g
          key={staff.id}
          className={`welcome-staff${active === `staff-${staff.id}` ? " is-pulsing" : ""}`}
          transform={staff.transform}
          role="button"
          tabIndex={0}
          aria-label={t("Подсветить нотную линейку")}
          onClick={() => pulse(`staff-${staff.id}`)}
          onKeyDown={(event) => {
            if (keyActivates(event)) pulse(`staff-${staff.id}`);
          }}
        >
          <path
            className="welcome-staff-hit"
            d={`M0 ${staff.top + 32}h${staff.width}`}
          />
          <path
            d={`M0 ${staff.top}h${staff.width}M0 ${staff.top + 16}h${staff.width}M0 ${staff.top + 32}h${staff.width}M0 ${staff.top + 48}h${staff.width}M0 ${staff.top + 64}h${staff.width}`}
          />
          <path d={`M32 ${staff.top - 16}v96m${staff.width * 0.6} -96v96`} />
        </g>
      ))}
      {NOTES.map((note, index) => (
        <g
          key={note.id}
          className={`welcome-score-note${active === note.id ? " is-pulsing" : ""}`}
          role="button"
          tabIndex={0}
          aria-label={t("Пульсировать ноту {number}", { number: index + 1 })}
          onClick={() => pulse(note.id)}
          onKeyDown={(event) => {
            if (keyActivates(event)) pulse(note.id);
          }}
        >
          <ellipse
            className="score-note-head"
            cx={note.x}
            cy={note.y}
            rx="13"
            ry="9"
            transform={`rotate(-20 ${note.x} ${note.y})`}
          />
          <path
            className="score-note-stem"
            d={`M${note.x + 11} ${note.y}v${-note.stem}h3v${note.stem}z`}
          />
          {note.flag && (
            <path
              className="score-note-flag"
              d={`M${note.x + 14} ${note.y - note.stem}c30 8 32 28 17 39 7-17-3-23-17-25z`}
            />
          )}
          <circle className="score-note-ring" cx={note.x} cy={note.y} r="26" />
        </g>
      ))}
    </svg>
  );
}
