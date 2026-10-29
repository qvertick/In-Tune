import { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { useI18n } from "./i18n";

export default function PolicyFooter() {
  const { t } = useI18n();
  const [page, setPage] = useState<"privacy" | "sources" | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (page) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [page]);
  return (
    <>
      <footer className="app-footer">
        <span>
          In-Tune / В лад <span className="footer-author">· @qvertick</span>
        </span>
        <nav aria-label={t("О приложении")}>
          <a
            href="https://github.com/qvertick/In-Tune"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub <ExternalLink size={12} aria-hidden="true" />
          </a>
          <button onClick={() => setPage("privacy")}>
            {t("Конфиденциальность")}
          </button>
          <button onClick={() => setPage("sources")}>
            {t("Источники и лицензии")}
          </button>
        </nav>
      </footer>
      <dialog
        ref={dialog}
        className="policy-dialog"
        aria-labelledby="policy-title"
        onCancel={() => setPage(null)}
        onClick={(event) => {
          if (event.target === dialog.current) setPage(null);
        }}
      >
        <div className="modal-head">
          <h2 id="policy-title">
            {t(
              page === "sources"
                ? "Источники и лицензии"
                : "Конфиденциальность",
            )}
          </h2>
          <button onClick={() => setPage(null)} aria-label={t("Закрыть")}>
            <X size={18} />
          </button>
        </div>
        {page === "privacy" ? (
          <div>
            <p>
              {t(
                "Это локальное приложение для личной работы с песнями. Сервер по умолчанию доступен только на этом компьютере.",
              )}
            </p>
            <h3>{t("Локальные данные")}</h3>
            <p>
              {t(
                "Тексты, аккорды и временные отметки сохраняются в SQLite, аудио и выделенные дорожки — в каталоге данных приложения (по умолчанию data в папке проекта; путь виден в настройках). Выбранный язык, параметры подсветки и аварийные черновики хранятся в браузере. Закрытие вкладки не удаляет песни.",
              )}
            </p>
            <p>
              {t(
                "В браузере также сохраняются настройка приветствия и последняя открытая рабочая страница. Эти сведения не отправляются внешним сервисам.",
              )}
            </p>
            <h3>{t("Обращения к внешним сервисам")}</h3>
            <p>
              {t(
                "По вашему действию поиск разборов передаёт поисковый запрос сайтам Akkords.pro, MyChords.net, Chorder.ru или Ultimate Guitar; импорт запрашивает выбранную страницу. Доступность автоматического поиска зависит от правил каждого сайта.",
              )}
            </p>
            <p>
              {t(
                "Поиск синхронизации передаёт LRCLIB название, исполнителя и заполненный альбом. Длительность помогает сравнивать варианты локально. Вставленная ссылка передаёт ID записи. Сервис получает обычные сетевые сведения запроса, включая IP-адрес. Результаты временно кешируются сервером; библиотека не отправляется целиком.",
              )}
            </p>
            <p>
              {t(
                "MP3, выделенные дорожки и записи не отправляются сайтам разборов или LRCLIB. Необязательная установка моделей отдельно обращается к источнику загрузки; обработка установленных моделей выполняется локально. Следование за микрофоном отсутствует.",
              )}
            </p>
            <h3>{t("Шрифты и аналитика")}</h3>
            <p>
              {t(
                "Интерфейс использует системные шрифты и локальные иконки. В приложении нет аналитики, рекламных трекеров, внешних обложек и обязательной регистрации. Ссылки на внешние сайты открываются только по вашему нажатию; у этих сайтов собственные правила конфиденциальности.",
              )}
            </p>
            <p>
              {t(
                "JSON-экспорт содержит текст, аккорды и отметки, но не аудиофайлы. Содержимое локальных папок может синхронизироваться средствами операционной системы, например OneDrive; приложение этим не управляет.",
              )}
            </p>
          </div>
        ) : (
          <div>
            <p>
              {t(
                "Автор приложения — @qvertick. Исходный код и лицензия проекта доступны в репозитории GitHub.",
              )}
            </p>
            <p>
              {t(
                "Разборы и тексты сохраняют своих авторов и источники. Приложение не становится их автором. Проверяйте разрешения перед распространением или публикацией материалов.",
              )}
            </p>
            <p>
              {t(
                "LRCLIB — внешний источник текстов и построчной синхронизации. Наличие совпадающего названия не гарантирует совпадение версии записи. Отметки слов используются только тогда, когда они действительно присутствуют в данных.",
              )}
            </p>
            <ul>
              <li>
                <a
                  href="https://lrclib.net/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  LRCLIB API
                </a>
              </li>
              <li>
                <a
                  href="https://lrclib.net/developers/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("Условия LRCLIB")}
                </a>
              </li>
              <li>
                YAML · ISC ·{" "}
                <a
                  href="https://github.com/tranxuanthang/lyricsfile"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("Спецификация Lyricsfile")} · CC0 1.0
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/qvertick/In-Tune"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  In-Tune · GitHub
                </a>
              </li>
              <li>
                {t(
                  "React — MIT; Vite — MIT; FastAPI — MIT; Lucide — ISC. Необязательные аудиоинструменты и модели описаны в README и документации проекта.",
                )}
              </li>
            </ul>
          </div>
        )}
      </dialog>
    </>
  );
}
