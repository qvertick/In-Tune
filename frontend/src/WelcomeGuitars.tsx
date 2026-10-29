import { KeyboardEvent, useRef, useState } from "react";
import { useI18n } from "./i18n";

const GUITARS = [
  { id: "acoustic", label: "Акустическая", shape: "round" },
  { id: "transacoustic", label: "Трансакустическая", shape: "round-wave" },
  { id: "electric", label: "Электрогитара", shape: "electric" },
  { id: "electroacoustic", label: "Электроакустическая", shape: "cutaway" },
] as const;

function GuitarShape({ shape }: { shape: (typeof GUITARS)[number]["shape"] }) {
  const body =
    shape === "electric"
      ? "M52 143c-17-10-17-37 3-47 12-6 8-20 18-29 12-9 33-6 38 8 4 11-6 19-15 24-8 5-12 18-18 28-8 12-25 15-37 7-9-6-13-20-12-30z"
      : shape === "cutaway"
        ? "M67 151c-21-12-23-40-5-55 11-9 8-22 18-31 11-10 31-4 36 10 5 13 0 22 14 30 18 10 17 37-4 48-18 10-43 9-59-2z"
        : "M66 154c-22-13-23-43-4-57 13-9 8-23 19-33 12-11 32-4 37 11 5 14 0 23 14 32 19 12 16 43-6 51-18 7-43 6-60-4z";
  return (
    <svg viewBox="0 0 190 184" aria-hidden="true">
      <path className="guitar-neck" d="M96 12h9v76h-9z" />
      <path className="guitar-head" d="M91 8c0-8 20-8 20 0v13H91z" />
      <path className="guitar-body" d={body} />
      <circle
        className="guitar-hole"
        cx="98"
        cy="121"
        r={shape === "electric" ? 0 : 10}
      />
      <path className="guitar-strings" d="M97 14v133m2-133v133m2-133v133" />
      {shape === "electric" && (
        <path className="guitar-pickups" d="M78 112h14v9H78zm26 0h14v9h-14z" />
      )}
      {shape === "round-wave" && (
        <path
          className="guitar-wave"
          d="M122 91c10 5 10 14 0 19m7-25c16 9 16 23 0 32"
        />
      )}
    </svg>
  );
}

export default function WelcomeGuitars() {
  const { t } = useI18n();
  const [active, setActive] = useState("acoustic");
  const root = useRef<HTMLDivElement>(null);
  const activate = (index: number) => {
    setActive(GUITARS[index].id);
    root.current?.querySelectorAll<HTMLButtonElement>("button")[index]?.focus();
  };
  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
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
          ? GUITARS.length - 1
          : (index +
              (["ArrowRight", "ArrowDown"].includes(event.key)
                ? 1
                : GUITARS.length - 1)) %
            GUITARS.length;
    activate(next);
  };
  return (
    <section
      className="welcome-guitars"
      aria-labelledby="welcome-guitars-title"
    >
      <div className="welcome-guitars-copy">
        <span className="overline">{t("Выбери свой инструмент")}</span>
        <h3 id="welcome-guitars-title">{t("У каждой гитары — свой голос.")}</h3>
        <p>
          {t(
            "Нажми на силуэт, чтобы подсветить его. Это небольшой интерактив без звука.",
          )}
        </p>
      </div>
      <div
        ref={root}
        className="guitar-garden"
        role="radiogroup"
        aria-label={t("Виды гитар")}
      >
        {GUITARS.map((guitar, index) => (
          <button
            key={guitar.id}
            type="button"
            role="radio"
            aria-checked={active === guitar.id}
            tabIndex={active === guitar.id ? 0 : -1}
            className={active === guitar.id ? "is-active" : ""}
            onClick={() => setActive(guitar.id)}
            onPointerEnter={(event) => {
              if (event.pointerType !== "touch") setActive(guitar.id);
            }}
            onFocus={() => setActive(guitar.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <GuitarShape shape={guitar.shape} />
            <span>{t(guitar.label)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
