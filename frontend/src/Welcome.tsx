import { useEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowRight,
  Music2,
  FileMusic,
  AlignLeft,
  SlidersHorizontal,
} from "lucide-react";
import { useI18n } from "./i18n";
import { APP_NAME, PRODUCT_NAME, WELCOME_VIDEO } from "./config";
import PolicyFooter from "./PolicyFooter";
import { useWelcomeLight } from "./useWelcomeScene";
import "./welcome.css";
import WelcomeDemo from "./WelcomeDemo";
import WelcomeChords from "./WelcomeChords";
import WelcomeGuitars from "./WelcomeGuitars";
import WelcomeMusicScore from "./WelcomeMusicScore";
import { useWelcomePosition } from "./welcomePosition";

function WelcomeMedia({
  video = WELCOME_VIDEO,
}: {
  video?: { src: string; type: string } | null;
}) {
  if (!video) return null;
  return (
    <video
      className="welcome-video"
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
    >
      <source src={video.src} type={video.type} />
    </video>
  );
}
export default function Welcome({
  onLibrary,
  onContinue,
  lastTitle,
  onWorkspace,
  hasAudio = false,
}: {
  onLibrary: (search?: boolean) => void;
  onContinue?: () => void;
  lastTitle?: string;
  onWorkspace?: (panel: "sync" | "mixer") => void;
  hasAudio?: boolean;
}) {
  const { t, locale, setLocale } = useI18n();
  const hero = useRef<HTMLElement>(null),
    page = useRef<HTMLDivElement>(null);
  useWelcomePosition(page);
  useWelcomeLight(hero);
  useEffect(() => {
    const node = page.current;
    if (!node) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const sections = Array.from(
      node.querySelectorAll<HTMLElement>("[data-welcome-section]"),
    );
    if (typeof IntersectionObserver === "undefined") {
      return;
    }
    const revealed = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          if (entry.isIntersecting) element.dataset.revealed = "true";
        }
      },
      { threshold: 0.08 },
    );
    for (const section of sections) {
      if (!reduced?.matches) section.dataset.reveal = "true";
      revealed.observe(section);
    }
    const show = () => {
      if (reduced?.matches)
        sections.forEach((section) => {
          section.dataset.revealed = "true";
        });
    };
    reduced?.addEventListener?.("change", show);
    return () => {
      revealed.disconnect();
      reduced?.removeEventListener?.("change", show);
    };
  }, []);
  const sections = [
    {
      id: "welcome-home",
      label: t("Начало"),
      description: t("Текст, аккорды и запись — в одном пространстве."),
    },
    {
      id: "welcome-score",
      label: t("Текст и аккорды"),
      description: t("Посмотри, как слова и аккорды следуют по разметке."),
    },
    {
      id: "welcome-sound",
      label: t("Твой звук"),
      description: t("Три шага от разбора к своему звучанию."),
    },
    {
      id: "welcome-start",
      label: t("Начать"),
      description: t("Выбери аккорд и открой свою библиотеку."),
    },
  ];
  function jump(id: string) {
    page.current?.querySelector(`#${id}`)?.scrollIntoView({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
  }
  return (
    <div ref={page} className="welcome-page">
      <a className="skip-link" href="#welcome-main">
        {t("К содержимому")}
      </a>
      <header className="welcome-nav">
        <a
          href="/welcome"
          className="welcome-brand"
          aria-label={`${PRODUCT_NAME} / ${APP_NAME}`}
        >
          <Music2 size={22} />
          <strong>{PRODUCT_NAME}</strong>
          <span>/ {APP_NAME}</span>
        </a>
        <nav aria-label={t("Навигация приветствия")}>
          <button
            className="text-button welcome-about"
            onClick={() => jump("welcome-score")}
          >
            {t("Возможности")}
          </button>
          <select
            className="welcome-language"
            aria-label={t("Язык интерфейса")}
            value={locale}
            onChange={(event) => setLocale(event.target.value as "ru" | "en")}
          >
            <option value="ru">RU</option>
            <option value="en">EN</option>
          </select>
          <button className="welcome-enter" onClick={() => onLibrary()}>
            {t("В библиотеку")}
            <ArrowRight size={16} />
          </button>
        </nav>
      </header>
      <nav className="welcome-rail" aria-label={t("Разделы приветствия")}>
        {sections.map((section, i) => (
          <div className="rail-group" key={section.id}>
            <button
              data-section-mark
              aria-label={`${String(i + 1).padStart(2, "0")} — ${section.label}`}
              aria-describedby={`rail-card-${i}`}
              onFocus={(event) => {
                delete event.currentTarget.dataset.tooltipDismissed;
              }}
              onPointerEnter={(event) => {
                delete event.currentTarget.dataset.tooltipDismissed;
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape")
                  event.currentTarget.dataset.tooltipDismissed = "true";
              }}
              onClick={() => jump(section.id)}
            >
              <span className="rail-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <i className="rail-major" aria-hidden="true" />
              <span className="rail-card" id={`rail-card-${i}`} role="tooltip">
                <span className="rail-card-index">0{i + 1}</span>
                <strong>{section.label}</strong>
                <span>{section.description}</span>
              </span>
            </button>
            {i < sections.length - 1 && (
              <span className="rail-minors" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
        ))}
      </nav>
      <main id="welcome-main">
        <section
          ref={hero}
          id="welcome-home"
          className="welcome-hero"
          data-welcome-section
        >
          <WelcomeMedia />
          <div className="welcome-light-surface" aria-hidden="true" />
          <WelcomeMusicScore />
          <div className="hero-meta">
            <span>01 / {t("Личное музыкальное пространство")}</span>
            <span>{t("Локально. В твоём ритме.")}</span>
          </div>
          <div className="hero-content">
            <p className="hero-product">
              {PRODUCT_NAME} <span>/ {APP_NAME}</span>
            </p>
            <h1>
              {t("Твой голос.")}
              <br />
              {t("Твои струны.")}
              <br />
              <em>{t("В одном ритме.")}</em>
            </h1>
            <p className="hero-description">
              {t(
                "Текст, аккорды и музыка в одном месте. Чтобы меньше искать — и больше играть.",
              )}
            </p>
            <div className="hero-actions">
              <button className="primary" onClick={() => onLibrary()}>
                {t("Открыть библиотеку")}
                <ArrowRight size={18} />
              </button>
              {onContinue && (
                <button className="text-button" onClick={onContinue}>
                  {t("Продолжить")}
                  <span className="continue-title">{lastTitle}</span>
                </button>
              )}
            </div>
          </div>
          <div className="hero-bottom">
            <button
              className="welcome-scroll"
              onClick={() => jump("welcome-score")}
            >
              <ArrowDown size={16} />
              {t("Ниже — ближе к музыке")}
            </button>
            <span>{t("Без облака для твоих записей")}</span>
          </div>
        </section>
        <section
          id="welcome-score"
          className="welcome-section welcome-score-section"
          data-welcome-section
        >
          <div className="welcome-section-label">
            02 / {t("Текст и аккорды")}
          </div>
          <div className="welcome-section-grid">
            <div>
              <h2>
                {t("Слова —")}
                <br />
                <em>{t("на своём месте.")}</em>
              </h2>
              <p>
                {t(
                  "Аккорды над нужными буквами. Следующие строки — заранее. Текст следует за временем записи и оставляет тебе место для музыки.",
                )}
              </p>
              <span className="welcome-small-note">
                {t(
                  "С настоящей разметкой — по словам. Без неё — по строкам или приблизительно.",
                )}
              </span>
            </div>
            <WelcomeDemo />
          </div>
        </section>
        <section
          id="welcome-sound"
          className="welcome-section welcome-sound-section"
          data-welcome-section
        >
          <div className="welcome-section-label">03 / {t("Твой звук")}</div>
          <div className="welcome-section-grid">
            <div>
              <h2>
                {t("От первой строки")}
                <br />
                <em>{t("до твоего звучания.")}</em>
              </h2>
              <p>
                {t(
                  "Собери песню так, как удобно тебе. Все правки, аккорды и записи остаются в твоей локальной библиотеке.",
                )}
              </p>
            </div>
            <div className="welcome-workflow">
              {[
                {
                  icon: FileMusic,
                  action: () => onLibrary(true),
                  title: t("Найди свою песню"),
                  text: t(
                    "Импортируй разбор из поддерживаемого источника или добавь собственный текст с аккордами.",
                  ),
                },
                {
                  icon: AlignLeft,
                  action: () =>
                    onWorkspace ? onWorkspace("sync") : onLibrary(),
                  title: t("Добавь время словам"),
                  text: t(
                    "Найди синхронизацию в LRCLIB, импортируй LRC или отметь строки под свою запись.",
                  ),
                },
                {
                  icon: SlidersHorizontal,
                  action: () =>
                    onWorkspace ? onWorkspace("mixer") : onLibrary(),
                  title: t("Настрой звучание"),
                  text: t(
                    "Играй под оригинал, готовый вокал или сопровождение. В микшере можно собрать свой баланс.",
                  ),
                },
              ].map((item, i) => (
                <button
                  type="button"
                  data-workflow-step
                  key={i}
                  onClick={item.action}
                >
                  <span className="workflow-index">0{i + 1}</span>
                  <div>
                    <item.icon size={21} />
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                    <span className="workflow-action">
                      {i === 0
                        ? t("Найти разбор")
                        : i === 2 && lastTitle && !hasAudio
                          ? t("Прикрепить MP3")
                          : lastTitle
                            ? t("Открыть для «{title}»", { title: lastTitle })
                            : t("Выбрать песню")}
                      <ArrowRight size={14} />
                    </span>
                  </div>
                </button>
              ))}
              <p className="welcome-small-note">
                {t(
                  "Разделение дорожек требует отдельной локальной установки. Модели не загружаются из приветствия.",
                )}
              </p>
            </div>
          </div>
        </section>
        <section
          id="welcome-start"
          className="welcome-section welcome-start-section"
          data-welcome-section
        >
          <div className="welcome-section-label">04 / {t("Начать")}</div>
          <Music2 size={30} aria-hidden="true" />
          <h2>{t("Пусть звучит.")}</h2>
          <p>{t("Одна песня. Немного времени. Твой собственный ритм.")}</p>
          <button className="primary" onClick={() => onLibrary()}>
            {t("Открыть библиотеку")}
            <ArrowRight size={18} />
          </button>
          <WelcomeChords />
          <WelcomeGuitars />
          <PolicyFooter />
        </section>
      </main>
    </div>
  );
}
