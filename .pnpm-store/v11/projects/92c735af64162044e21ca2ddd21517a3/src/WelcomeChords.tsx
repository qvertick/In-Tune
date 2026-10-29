import { useId, useRef, useState } from "react";
import { useI18n } from "./i18n";

// Standard open voicings, string order: low E, A, D, G, B, high E.
export const WELCOME_CHORDS = [
  {
    name: "Am",
    frets: [-1, 0, 2, 2, 1, 0],
    fingers: [0, 0, 2, 3, 1, 0],
    label: "Ля минор",
  },
  {
    name: "C",
    frets: [-1, 3, 2, 0, 1, 0],
    fingers: [0, 3, 2, 0, 1, 0],
    label: "До мажор",
  },
  {
    name: "G",
    frets: [3, 2, 0, 0, 0, 3],
    fingers: [2, 1, 0, 0, 0, 3],
    label: "Соль мажор",
  },
  {
    name: "Em",
    frets: [0, 2, 2, 0, 0, 0],
    fingers: [0, 2, 3, 0, 0, 0],
    label: "Ми минор",
  },
];
export default function WelcomeChords() {
  const { t } = useI18n();
  const [selected, setSelected] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const title = useId(),
    chord = WELCOME_CHORDS[selected];
  return (
    <div className="welcome-chord-lab">
      <div className="chord-lab-copy">
        <span className="overline">{t("Без звука · попробуй")}</span>
        <h3>{t("Собери свой аккорд")}</h3>
        <p>
          {t(
            "Четыре знакомые формы. Выбери аккорд — посмотри, куда поставить пальцы.",
          )}
        </p>
        <div
          ref={root}
          className="chord-lab-options"
          role="radiogroup"
          aria-label={t("Аккорды для примера")}
        >
          {WELCOME_CHORDS.map((item, i) => (
            <button
              key={item.name}
              role="radio"
              aria-checked={selected === i}
              tabIndex={selected === i ? 0 : -1}
              onPointerEnter={(e) => {
                if (e.pointerType !== "touch") setSelected(i);
              }}
              onFocus={() => setSelected(i)}
              onClick={() => setSelected(i)}
              onKeyDown={(event) => {
                if (
                  ![
                    "ArrowRight",
                    "ArrowDown",
                    "ArrowLeft",
                    "ArrowUp",
                    "Home",
                    "End",
                  ].includes(event.key)
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 3
                      : (i +
                          (["ArrowRight", "ArrowDown"].includes(event.key)
                            ? 1
                            : 3)) %
                        4;
                setSelected(next);
                root.current
                  ?.querySelectorAll<HTMLButtonElement>("button")
                  [next].focus();
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
        <span className="welcome-small-note">
          {t("От толстой струны E к тонкой e. ○ — открытая, × — не играть.")}
        </span>
      </div>
      <figure className="chord-lab-figure">
        <svg viewBox="0 0 180 159" role="img" aria-labelledby={title}>
          <title id={title}>
            {t("Аппликатура {chord}: {frets}", {
              chord: chord.name,
              frets: chord.frets
                .map((n) => (n < 0 ? "×" : String(n)))
                .join(" · "),
            })}
          </title>
          {[0, 1, 2, 3, 4].map((fret) => (
            <line
              key={"f" + fret}
              x1="30"
              x2="150"
              y1={34 + fret * 24}
              y2={34 + fret * 24}
              className={fret === 0 ? "chord-nut" : "chord-fret"}
            />
          ))}
          {chord.frets.map((fret, i) => (
            <g key={i}>
              <line
                x1={30 + i * 24}
                x2={30 + i * 24}
                y1="34"
                y2="130"
                className="chord-string"
              />
              {fret === 0 && (
                <circle cx={30 + i * 24} cy="19" r="4" className="chord-open" />
              )}
              {fret < 0 && (
                <path
                  d={`M${26 + i * 24} 15l8 8m0-8l-8 8`}
                  className="chord-mute"
                />
              )}
              {fret > 0 && (
                <>
                  <circle
                    cx={30 + i * 24}
                    cy={34 + (fret - 0.5) * 24}
                    r="8"
                    className="chord-finger"
                  />
                  <text
                    x={30 + i * 24}
                    y={34 + (fret - 0.5) * 24 + 3}
                    className="chord-finger-number"
                  >
                    {chord.fingers[i]}
                  </text>
                </>
              )}
              <text x={30 + i * 24} y="149" className="chord-string-label">
                {["E", "A", "D", "G", "B", "e"][i]}
              </text>
            </g>
          ))}
          {[1, 2, 3, 4].map((fret) => (
            <text
              key={fret}
              x="13"
              y={38 + (fret - 0.5) * 24}
              className="chord-fret-label"
            >
              {fret}
            </text>
          ))}
        </svg>
        <figcaption aria-live="polite">
          <strong>{chord.name}</strong>
          <span>{t(chord.label)}</span>
        </figcaption>
      </figure>
    </div>
  );
}
