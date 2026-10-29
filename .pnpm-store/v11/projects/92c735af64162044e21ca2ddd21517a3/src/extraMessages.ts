/** Translations shared with Performance, LRCLIB, the lyric rows and policy dialogs. */
const extrasMessages: Record<string, string> = {
  "Песен: {count}": "Songs: {count}",
  "Текст и чтение": "Text and reading",
  "Настройки плеера": "Player settings",
  "О подсветке": "About highlighting",
  "Разметка инструментальной последовательности":
    "Instrumental sequence timing",
  "Отметки берутся из общего плеера. Границы строки необязательны для отметок отдельных аккордов.":
    "Timestamps use the shared player. Line bounds are optional for individual chord timestamps.",
  Звучание: "Sound",
  "Повторов: {count}": "Repeats: {count}",
  "Инструментальная часть": "Instrumental passage",
  "Конец фразы не отмечен": "Phrase end not marked",
  "Конец фразы требует проверки": "Check the phrase end",
  "Вокал через {seconds} с": "Vocals in {seconds} s",
  "Сейчас звучит": "Playing now",
  Далее: "Up next",
  Начало: "Start",
  Конец: "End",
  "Разметить аккорды": "Mark chord changes",
  "Времена инструментальных аккордов": "Instrumental chord timing",
  "Смены аккордов": "Chord changes",
  "Слушайте запись и отмечайте реальные смены. Повторы не получают выдуманные времена.":
    "Listen and mark actual changes. Repeats are never assigned invented timestamps.",
  "Отметить следующий аккорд": "Mark next chord",
  "Отметить конец аккордов": "Mark chord sequence end",
  "Начало аккорда {name}": "Chord start: {name}",
  "Конец аккорда {name}": "Chord end: {name}",
  "Сохранить времена аккордов": "Save chord timing",
  "Отметки аккордов должны идти по порядку.":
    "Chord timestamps must follow their source order.",
  "Проверьте времена аккордов: по порядку, без пересечений.":
    "Check chord times: ordered and without overlaps.",
  "К текущей строке": "Back to current line",
  "Подсветка текста": "Text highlighting",
  "Повторить запрос": "Retry request",
  "LRCLIB перегружен. Повторите запрос позже.":
    "LRCLIB is overloaded. Try again later.",
  "Спецификация Lyricsfile": "Lyricsfile specification",
  "Условия LRCLIB": "LRCLIB terms",
  "Начала слов заданы в источнике; длительность заливки между ними приблизительная.":
    "Word starts come from the source; the fill duration between them is approximate.",
  "есть начала слов без полных концов; длительность подсветки приблизительная.":
    "word starts are present without complete ends; highlight duration is approximate.",
  "Повторите через {seconds} с.": "Try again in {seconds} s.",
  "Следующая строка": "Next line",
  "Начать с первой строки": "Start from the first line",
  "Файл LRC / Lyricsfile": "LRC / Lyricsfile file",
  Подробности: "Details",
  "Lyricsfile: ": "Lyricsfile: ",
  "Lyricsfile: размер превышает 1 MiB.": "Lyricsfile: size exceeds 1 MiB.",
  "Lyricsfile: ошибка YAML: ": "Lyricsfile: YAML error: ",
  "слишком много узлов YAML.": "too many YAML nodes.",
  "глубина YAML превышает 32.": "YAML depth exceeds 32.",
  "YAML anchors/aliases не поддерживаются.":
    "YAML anchors/aliases are not supported.",
  "пользовательские или неподдерживаемые YAML tags запрещены.":
    "custom or unsupported YAML tags are prohibited.",
  "разрешены только строки, целые числа, boolean и null.":
    "only strings, integers, boolean, and null are allowed.",
  "ключи YAML должны быть строками.": "YAML keys must be strings.",
  'Lyricsfile: требуется точная строковая version: "1.0".':
    'Lyricsfile: version must be the exact string "1.0".',
  "Lyricsfile: metadata.title и metadata.artist должны быть строками.":
    "Lyricsfile: metadata.title and metadata.artist must be strings.",
  "Lyricsfile: недопустимая metadata.duration_ms.":
    "Lyricsfile: invalid metadata.duration_ms.",
  "Lyricsfile: metadata.instrumental должен быть boolean.":
    "Lyricsfile: metadata.instrumental must be boolean.",
  "Lyricsfile: ненулевой offset_ms не поддерживается — его смысл не определён спецификацией.":
    "Lyricsfile: a nonzero offset_ms is not supported; its meaning is not defined by the specification.",
  "Lyricsfile: plain должен быть строкой.":
    "Lyricsfile: plain must be a string.",
  "Lyricsfile: lines должен быть массивом.":
    "Lyricsfile: lines must be an array.",
  "Lyricsfile: instrumental несовместим с непустыми lyrics.":
    "Lyricsfile: instrumental is incompatible with nonempty lyrics.",
  "Lyricsfile: инструментальная запись, синхронизированного текста нет.":
    "Lyricsfile: instrumental recording, no synchronized lyrics.",
  "Lyricsfile: синхронизированных строк нет; plain не содержит времён.":
    "Lyricsfile: no synchronized lines; plain contains no timing.",
  "Lyricsfile: больше 2000 строк.": "Lyricsfile: more than 2000 lines.",
  "Lyricsfile: больше 2000 слов/сегментов в документе.":
    "Lyricsfile: more than 2000 words/segments in the document.",
  "Строка {line}: {message}": "Line {line}: {message}",
  "нужны строковый text и целый неотрицательный start_ms; пропущено.":
    "string text and a nonnegative integer start_ms are required; skipped.",
  "нулевой или некорректный интервал строки; нужна проверка.":
    "zero or invalid line interval; review required.",
  "Неполные, перекрывающиеся или несовместимые словные сегменты; оставлены только времена строки.":
    "Incomplete, overlapping, or incompatible word segments; only line timing was retained.",
  "нет явного end_ms строки; конец не вычислялся.":
    "no explicit line end_ms; the end was not inferred.",
  "Перекрывающиеся или одновременные строки Lyricsfile; нужна проверка нескольких голосов.":
    "Overlapping or simultaneous Lyricsfile lines; review multiple voices.",
  "Строки с конфликтами времени помечены review и не применяются автоматически.":
    "Lines with timing conflicts are marked review and are not applied automatically.",
  "Lyricsfile: не удалось безопасно прочитать YAML: ":
    "Lyricsfile: could not safely read YAML: ",
  "ошибка разбора.": "parse error.",
  "Размер текста ·": "Text size ·",
  Повтор: "Loop",
  проверить: "review",
  "Приблизительная подсветка слов": "Approximate word highlighting",
  "Оценка по длительности строки, а не распознавание. Долгие интервалы и проигрыши остаются с подсветкой строки. Реальные отметки слов используются всегда.":
    "Estimated from line duration, without recognition. Long intervals and instrumental passages keep line highlighting. Actual word timestamps are always used when available.",
  "Отменить изменение карты": "Undo timing map change",
  "Синхронизация текста": "Lyrics synchronization",
  "Найти синхронизацию": "Find synced lyrics",
  "Импортировать LRC": "Import LRC",
  "Выберите ту же версию записи. Совпадение названия не гарантирует совпадения времени.":
    "Choose the same recording version. A matching title does not guarantee matching timing.",
  "Альбом (если известен)": "Album (if known)",
  "Наша запись": "Our recording",
  "аудио не прикреплено": "no audio attached",
  "Найти варианты": "Find versions",
  "Или ссылка LRCLIB": "Or an LRCLIB link",
  "Открыть ссылку": "Open link",
  "Поиск в LRCLIB…": "Searching LRCLIB…",
  "Варианты не найдены. Уточните запрос или импортируйте LRC вручную.":
    "No versions found. Refine your search or import an LRC manually.",
  "Варианты LRCLIB": "LRCLIB versions",
  с: "s",
  "Отметки слов": "Word timestamps",
  "Отметки строк": "Line timestamps",
  "Инструментальная запись": "Instrumental recording",
  "Предпросмотр синхронизации": "Timing preview",
  "Прослушать нашу запись": "Listen to our recording",
  "В этом варианте нет синхронизированного текста. Временная карта не будет создана.":
    "This version has no synchronized lyrics. No timing map will be created.",
  "Текст отсутствует.": "No lyrics available.",
  "Есть реальные отметки слов из файла.":
    "The file contains actual word timestamps.",
  "Здесь есть только отметки строк. Подсветку слов можно включить приблизительно в настройках плеера.":
    "This version only has line timestamps. Approximate word highlighting can be enabled in the player settings.",
  "Сдвиг должен оставлять отметки внутри записи.":
    "The shift must keep timestamps within the recording.",
  "Сопоставлено строк": "Matched lines",
  "Не найдено": "Unmatched",
  "Требует проверки": "Needs review",
  "Строки без совпадения": "Unmatched lines",
  "Заменить существующие отметки сопоставленных строк":
    "Replace existing timestamps for matched lines",
  "Текст, аккорды и их позиции сохраняются. Применение можно отменить.":
    "Lyrics, chords, and their positions are preserved. You can undo applying the timing.",
  "Применить синхронизацию": "Apply timing",
  "Запрос отправляется LRCLIB. Аудио не отправляется. При недоступности сервиса используйте ручной импорт LRC или разметку.":
    "The request is sent to LRCLIB. Audio is not sent. If the service is unavailable, import an LRC or mark timing manually.",
  "Запрос не завершился вовремя. Повторите попытку или импортируйте LRC вручную.":
    "The request timed out. Try again or import an LRC manually.",
  "Вставьте ссылку https://lrclib.net/tracks/число.":
    "Paste a link in the form https://lrclib.net/tracks/number.",
  "О приложении": "About the app",
  Конфиденциальность: "Privacy",
  "Источники и лицензии": "Sources and licenses",
  "Это локальное приложение для личной работы с песнями. Сервер по умолчанию доступен только на этом компьютере.":
    "This is a local app for personal work with songs. By default, the server is accessible only on this computer.",
  "Тексты, аккорды и временные отметки сохраняются в SQLite, аудио и выделенные дорожки — в каталоге данных приложения (по умолчанию data в папке проекта; путь виден в настройках). Выбранный язык, параметры подсветки и аварийные черновики хранятся в браузере. Закрытие вкладки не удаляет песни.":
    "Lyrics, chords, and timestamps are saved in SQLite; audio and separated tracks are stored in the app data directory (by default, data in the project folder; the path is shown in Settings). The selected language, highlighting preferences, and recovery drafts are stored in your browser. Closing the tab does not delete songs.",
  "Обращения к внешним сервисам": "External service requests",
  "По вашему действию поиск разборов передаёт поисковый запрос сайтам Akkords.pro, MyChords.net, Chorder.ru или Ultimate Guitar; импорт запрашивает выбранную страницу. Доступность автоматического поиска зависит от правил каждого сайта.":
    "When you search for chord sheets, the search query is sent to Akkords.pro, MyChords.net, Chorder.ru, or Ultimate Guitar; importing requests the selected page. Automated search availability depends on each website's rules.",
  "Поиск синхронизации передаёт LRCLIB название, исполнителя и заполненный альбом. Длительность помогает сравнивать варианты локально. Вставленная ссылка передаёт ID записи. Сервис получает обычные сетевые сведения запроса, включая IP-адрес. Результаты временно кешируются сервером; библиотека не отправляется целиком.":
    "Timing search sends LRCLIB the title, artist, and album if provided. Duration helps compare versions locally. Pasting a link sends the record ID. The service receives normal request information, including the IP address. Results are temporarily cached by the server; your entire library is not sent.",
  "MP3, выделенные дорожки и записи не отправляются сайтам разборов или LRCLIB. Необязательная установка моделей отдельно обращается к источнику загрузки; обработка установленных моделей выполняется локально. Следование за микрофоном отсутствует.":
    "MP3 files, separated tracks, and recordings are not sent to chord websites or LRCLIB. Optional model installation contacts the download source separately; installed models process data locally. Microphone following is not available.",
  "Шрифты и аналитика": "Fonts and analytics",
  "Интерфейс использует системные шрифты и локальные иконки. В приложении нет аналитики, рекламных трекеров, внешних обложек и обязательной регистрации. Ссылки на внешние сайты открываются только по вашему нажатию; у этих сайтов собственные правила конфиденциальности.":
    "The interface uses system fonts and local icons. The app has no analytics, advertising trackers, external cover images, or required registration. External websites open only when you click their links; those sites have their own privacy policies.",
  "JSON-экспорт содержит текст, аккорды и отметки, но не аудиофайлы. Содержимое локальных папок может синхронизироваться средствами операционной системы, например OneDrive; приложение этим не управляет.":
    "JSON exports contain lyrics, chords, and timestamps, but no audio files. Local folders may be synced by operating system services such as OneDrive; the app does not control this.",
  "Автор приложения — @qvertick. Исходный код и лицензия проекта доступны в репозитории GitHub.":
    "The app was created by @qvertick. The source code and project license are available in the GitHub repository.",
  "Разборы и тексты сохраняют своих авторов и источники. Приложение не становится их автором. Проверяйте разрешения перед распространением или публикацией материалов.":
    "Chord sheets and lyrics retain their original authors and sources. The app does not claim authorship. Check permissions before sharing or publishing materials.",
  "LRCLIB — внешний источник текстов и построчной синхронизации. Наличие совпадающего названия не гарантирует совпадение версии записи. Отметки слов используются только тогда, когда они действительно присутствуют в данных.":
    "LRCLIB is an external source of lyrics and line timing. A matching title does not guarantee the same recording version. Word timestamps are used only when they are present in the data.",
  "React — MIT; Vite — MIT; FastAPI — MIT; Lucide — ISC. Необязательные аудиоинструменты и модели описаны в README и документации проекта.":
    "React — MIT; Vite — MIT; FastAPI — MIT; Lucide — ISC. Optional audio tools and models are described in the README and project documentation.",
  "Неполные или некорректные словные отметки; используются только времена строк.":
    "Incomplete or invalid word timestamps; only line timing is used.",
  "Служебная или инструментальная строка; пропущено.":
    "Metadata or instrumental line; skipped.",
  "Некорректное или одинаковое время у нескольких строк; исправьте LRC.":
    "Invalid or duplicate line timestamps; correct the LRC.",
  "Неоднозначный повтор или порядок строк; выберите соответствие вручную.":
    "Ambiguous repetition or line order; select a match manually.",
  "Текст совпал, но для разделения строки нужны полные словные отметки.":
    "The lyrics match, but splitting a line requires complete word timestamps.",
  "ID должен быть положительным целым числом.":
    "ID must be a positive integer.",
  "ID вне допустимого диапазона.": "ID is outside the allowed range.",
  "Нужна ссылка https://lrclib.net/tracks/число.":
    "Enter a link in the form https://lrclib.net/tracks/number.",
  "Поля поиска: до 200 печатных символов.":
    "Search fields: up to 200 printable characters.",
  "Укажите название трека (track).": "Enter a track title (track).",
  "duration: число секунд от 0 до 86400.":
    "duration: a number of seconds from 0 to 86400.",
  "Недопустимый запрос LRCLIB.": "Invalid LRCLIB request.",
  "Запись LRCLIB не найдена.": "LRCLIB record not found.",
  "LRCLIB ограничил запросы.": "LRCLIB has limited requests.",
  "LRCLIB временно недоступен.": "LRCLIB is temporarily unavailable.",
  "Переадресация LRCLIB заблокирована.": "LRCLIB redirect blocked.",
  "LRCLIB вернул ошибку HTTP.": "LRCLIB returned an HTTP error.",
  "LRCLIB вернул неподдерживаемый тип данных.":
    "LRCLIB returned an unsupported data type.",
  "Сжатый ответ LRCLIB не поддерживается.":
    "Compressed LRCLIB responses are not supported.",
  "Ответ LRCLIB превышает допустимый размер.":
    "The LRCLIB response exceeds the allowed size.",
  "Неполный ответ LRCLIB.": "Incomplete LRCLIB response.",
  "LRCLIB вернул некорректный JSON.": "LRCLIB returned invalid JSON.",
  "Не удалось безопасно разрешить адрес LRCLIB.":
    "Could not safely resolve the LRCLIB address.",
  "Превышено время ожидания LRCLIB.": "LRCLIB request timed out.",
  "Не удалось безопасно загрузить LRCLIB.": "Could not safely load LRCLIB.",
  "Некорректные поля записи LRCLIB.": "Invalid LRCLIB record fields.",
  "Запрос LRCLIB уже выполняется.": "An LRCLIB request is already in progress.",
  "Повторите запрос LRCLIB позже.": "Try the LRCLIB request again later.",
  "Некорректный список результатов LRCLIB.": "Invalid LRCLIB result list.",
  "ID ответа LRCLIB не совпадает с запросом.":
    "The LRCLIB response ID does not match the request.",
  "Укажите ровно один параметр: id или url.":
    "Specify exactly one parameter: id or url.",
  "Неизвестные, повторные или слишком длинные параметры.":
    "Unknown, duplicate, or excessively long parameters.",
};
export default extrasMessages;
