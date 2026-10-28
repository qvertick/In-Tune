/** Known backend messages; placeholders preserve paths, status codes and diagnostics. */
const errorMessages: Record<string, string> = {
  "FFmpeg не найден. Установите FFmpeg, добавьте его в PATH и повторите анализ.":
    "FFmpeg not found. Install FFmpeg, add it to PATH, and run analysis again.",
  "Превышено время декодирования аудио (120 секунд).":
    "Audio decoding timed out (120 seconds).",
  "FFmpeg не удалось декодировать этот аудиофайл.":
    "FFmpeg could not decode this audio file.",
  "Для анализа поддерживается аудио до 10 минут. Сократите файл и повторите попытку.":
    "Analysis supports audio up to 10 minutes. Shorten the file and try again.",
  "FFmpeg вернул неподдерживаемый формат аудио.":
    "FFmpeg returned an unsupported audio format.",
  "Сеанс следования завершён. Включите следование снова.":
    "The following session has ended. Turn following on again.",
  "Уже открыт сеанс следования. Остановите его в другой вкладке.":
    "A following session is already open. Stop it in the other tab.",
  "Сначала завершите или отмените фоновый анализ аудио.":
    "Finish or cancel background audio analysis first.",
  "Песня не найдена.": "Song not found.",
  "Устаревший выбор позиции.": "Stale position selection.",
  "Ожидается PCM s16le, один канал, 16 кГц.":
    "Expected PCM s16le, mono, 16 kHz.",
  "Звуковое окно превышает четыре секунды.":
    "The audio window exceeds four seconds.",
  "Некорректная длина PCM или временные границы окна.":
    "Invalid PCM length or window time boundaries.",
  "Устаревшее звуковое окно.": "Stale audio window.",
  "Предыдущее окно ещё обрабатывается. Отправляйте только свежий звук.":
    "The previous window is still processing. Send only fresh audio.",
  "Сеанс или позиция изменились. Старый результат отброшен.":
    "The session or position changed. The old result was discarded.",
  "Для следования нужен текст песни, не более 40 000 слов.":
    "Following requires song lyrics with no more than 40,000 words.",
  "Выбранная строка отсутствует в песне.":
    "The selected line is not in the song.",
  "Поддерживаются русский, украинский и английский языки.":
    "Russian, Ukrainian, and English are supported.",
  "Для следования установите Vosk и выбранную модель: ":
    "To enable following, install Vosk and the selected model: ",
  "Не удалось распознать звук локальной моделью Vosk. Проверьте установку и журнал сервера.":
    "The local Vosk model could not recognize audio. Check the installation and server log.",
  "Ошибка потокового Vosk. Проверьте локальную модель и журнал сервера.":
    "Vosk streaming error. Check the local model and server log.",
  "Неполная папка модели: {value1}. Переместите её перед повторной установкой.":
    "Incomplete model directory: {value1}. Move it before reinstalling.",
  "Архив превышает ожидаемый предел 200 МиБ.":
    "The archive exceeds the expected limit of 200 MiB.",
  "Распакованная модель превышает 500 МиБ.":
    "The extracted model exceeds 500 MiB.",
  "Недопустимый путь в архиве модели.": "Invalid path in the model archive.",
  "Архив не содержит ожидаемую модель Vosk.":
    "The archive does not contain the expected Vosk model.",
  "Декодирование аудио": "Decoding audio",
  "Распознавание текста": "Transcribing lyrics",
  "Сохранение черновика": "Saving draft",
  "Разделение вокала и сопровождения": "Separating vocals and accompaniment",
  "Речь не распознана. Черновик не создан.":
    "No speech recognized. No draft was created.",
  "Распознанный текст вместе с исходным содержимым превышает ограничения песни или содержит неверные временные метки.":
    "The recognized lyrics combined with the original content exceed song limits or contain invalid timestamps.",
  "Для анализа аккордов нужен NumPy. Установите зависимости backend/requirements-lock.txt.":
    "Chord analysis requires NumPy. Install dependencies from backend/requirements-lock.txt.",
  "Для анализа аккордов требуется монофонический PCM WAV: 16 кГц, 16 бит.":
    "Chord analysis requires mono PCM WAV: 16 kHz, 16 bit.",
  "Для анализа аккордов требуется непустое аудио длительностью до 10 минут.":
    "Chord analysis requires nonempty audio up to 10 minutes.",
  "Аудиоданные WAV обрезаны. Загрузите полный файл и повторите анализ.":
    "WAV audio data is truncated. Upload the complete file and run analysis again.",
  "Не удалось прочитать WAV для анализа аккордов.":
    "Could not read the WAV for chord analysis.",
  "Получен недопустимый интервал аккорда.":
    "An invalid chord interval was received.",
  "Шкала аккордов превышает ограничение количества строк песни.":
    "The chord timeline exceeds the song line limit.",
  "Шкала аккордов вместе с исходным содержимым превышает ограничения документа песни.":
    "The chord timeline combined with the original content exceeds song document limits.",
  "Результат анализа аккордов не соответствует формату документа песни.":
    "The chord analysis result does not match the song document format.",
  "В этой папке данных уже работает обработчик анализа. Используйте один процесс сервера.":
    "An analysis worker is already running in this data directory. Use a single server process.",
  "Неизвестный вид анализа. Допустимы transcription, chords, timing и separation.":
    "Unknown analysis type. Allowed values: transcription, chords, timing, and separation.",
  "Очередь анализа заполнена или сервер завершает работу. Повторите попытку позже.":
    "The analysis queue is full or the server is shutting down. Try again later.",
  "Перед началом анализа загрузите аудио.":
    "Upload audio before starting analysis.",
  "Неизвестный этап анализа": "Unknown analysis stage",
  "Анализ прерван остановкой сервера. Запустите его снова.":
    "Analysis was interrupted by server shutdown. Start it again.",
  "Результат анализа превышает 2 000 000 байт и не сможет быть сохранён в редакторе. Сократите аудио или исходный текст и повторите анализ.":
    "The analysis result exceeds 2,000,000 bytes and cannot be saved in the editor. Shorten the audio or original lyrics and run analysis again.",
  "Не удалось выполнить анализ. Проверьте локальные файлы аудио и модели, а также журнал сервера, затем повторите попытку.":
    "Analysis failed. Check local audio and model files and the server log, then try again.",
  "Метод не поддерживается": "Method not supported",
  "Не удалось прочитать тело запроса": "Could not read the request body",
  "Недопустимое значение": "Invalid value",
  "Обязательное поле отсутствует": "Required field is missing",
  "Ожидается целое число": "Expected an integer",
  "Ожидается конечное число": "Expected a finite number",
  "Допустимые значения: {value1}": "Allowed values: {value1}",
  "Максимальная длина: {value1}": "Maximum length: {value1}",
  "Минимальная длина: {value1}": "Minimum length: {value1}",
  "Слишком много элементов; максимум: {value1}":
    "Too many items; maximum: {value1}",
  "Минимальное значение: {value1}": "Minimum value: {value1}",
  "Максимальное значение: {value1}": "Maximum value: {value1}",
  "Некорректный JSON": "Invalid JSON",
  "Песня с таким UUID уже существует": "A song with this UUID already exists",
  "UUID в адресе и документе должны совпадать":
    "The URL and document UUIDs must match",
  "Ожидается имя MP3-файла без пути и управляющих символов":
    "Expected an MP3 filename without a path or control characters",
  "Недопустимый Content-Length": "Invalid Content-Length",
  "Размер MP3 превышает допустимый предел":
    "MP3 size exceeds the allowed limit",
  "Тело запроса не содержит допустимый MP3-аудиопоток":
    "The request body does not contain a valid MP3 audio stream",
  "Сначала остановите следование за голосом.": "Stop voice following first.",
  "Задача анализа не найдена": "Analysis job not found",
  "У задачи анализа пока нет готового черновика":
    "The analysis job has no ready draft yet",
  "Недопустимый путь исходного аудио задачи":
    "Invalid source audio path for the job",
  "Импортированная песня была удалена. Повторите импорт.":
    "The imported song was deleted. Import it again.",
  "Не удалось скопировать аудио результата. Проверьте доступ к папке данных и повторите импорт.":
    "Could not copy the result audio. Check access to the data directory and import again.",
  "Маршрут API не найден": "API route not found",
  "Сборка frontend не найдена": "Frontend build not found",
  "Размер JSON превышает 2 МБ": "JSON size exceeds 2 MB",
  "Эта база создана более новой версией приложения. Файлы не изменены; используйте подходящую версию.":
    "This database was created by a newer app version. No files were changed; use a compatible version.",
  "Локальная модель Whisper tiny отсутствует или неполна. Разместите все файлы Systran/faster-whisper-tiny в {value1}. Модель не скачивалась.":
    "The local Whisper tiny model is missing or incomplete. Place all Systran/faster-whisper-tiny files in {value1}. The model was not downloaded.",
  "Не установлен необязательный пакет распознавания. Установите его явно командой python -m pip install -r backend/requirements-audio.txt и повторите попытку.":
    "The optional recognition package is not installed. Install it explicitly with python -m pip install -r backend/requirements-audio.txt and try again.",
  "Не удалось загрузить локальную модель Whisper tiny. Проверьте комплектность файлов модели и поддержку CPU int8. Скачивание не выполнялось.":
    "Could not load the local Whisper tiny model. Check that all model files are present and CPU int8 is supported. No download was performed.",
  "Распознанный текст превышает ограничения документа песни. Сократите аудио.":
    "Recognized lyrics exceed song document limits. Shorten the audio.",
  "Папка модели уже существует: {value1}. Переместите её перед установкой.":
    "Model directory already exists: {value1}. Move it before installation.",
  "Сначала установите необязательные пакеты: python -m pip install -r backend/requirements-audio.txt":
    "Install optional packages first: python -m pip install -r backend/requirements-audio.txt",
  "Скачанный комплект файлов неполон. Модель не установлена.":
    "The downloaded file set is incomplete. The model was not installed.",
  "Недопустимый UUID": "Invalid UUID",
  "Ожидается UUID в канонической форме строчными буквами":
    "Expected a canonical lowercase UUID",
  "Недопустимое обозначение аккорда": "Invalid chord symbol",
  "Необязательное поле следует пропустить, а не указывать null":
    "Omit optional fields instead of setting them to null",
  "Конец аккорда требует начала и не может предшествовать ему":
    "A chord end requires a start and cannot precede it",
  "Конец слова не может предшествовать началу":
    "Word end cannot precede its start",
  "Конец строки должен быть позже её начала":
    "Line end must be after its start",
  "Источник должен быть обычной ссылкой HTTP/HTTPS без пароля":
    "The source must be a regular HTTP/HTTPS link without a password",
  "В ссылке источника недопустимы управляющие символы":
    "Control characters are not allowed in the source link",
  "updatedAt должен содержать дату ISO 8601 с часовым поясом":
    "updatedAt must contain an ISO 8601 date with a time zone",
  "В песне допускается не более 2000 строк":
    "A song can contain no more than 2,000 lines",
  "В песне допускается не более 20000 вхождений аккордов":
    "A song can contain no more than 20,000 chord occurrences",
  "UUID всех элементов документа должны быть уникальны":
    "All document element UUIDs must be unique",
  "paletteId аккорда отсутствует в палитре":
    "The chord paletteId is missing from the palette",
  "Смещение аккорда выходит за границы строки":
    "The chord offset is outside the line",
  "schemaVersion должен быть целым числом 1":
    "schemaVersion must be the integer 1",
  "Проверьте изолированную среду: install-separation.ps1 (маркер среды отсутствует или устарел).":
    "Check the isolated environment: install-separation.ps1 (environment marker missing or outdated).",
  "Локальное разделение: CPU, одна модель htdemucs; обработка может занять значительное время.":
    "Local separation: CPU, one htdemucs model; processing may take significant time.",
  "Необязательное разделение не установлено полностью. Выполните install-separation.ps1 -DownloadModel; нужен FFmpeg в PATH. Автоматической загрузки нет.":
    "Optional separation is not fully installed. Run install-separation.ps1 -DownloadModel; FFmpeg must be in PATH. No automatic download is performed.",
  "84 141 911 байт (80,24 МиБ), одна модель htdemucs":
    "84,141,911 bytes (80.24 MiB), one htdemucs model",
  "Недопустимый идентификатор песни.": "Invalid song identifier.",
  "Загрузите локальное аудио песни перед разделением.":
    "Upload local song audio before separation.",
  "Исходное аудио отсутствует или его путь недопустим.":
    "Source audio is missing or its path is invalid.",
  "Исходное аудио изменилось во время чтения. Повторите разделение.":
    "Source audio changed while reading. Run separation again.",
  "Недопустимая папка результатов разделения.":
    "Invalid separation output directory.",
  "Превышено время локального разделения. Попробуйте более короткое аудио.":
    "Local separation timed out. Try shorter audio.",
  "Локальный процесс разделения завершился с ошибкой. Проверьте FFmpeg, модель и install-separation.ps1; для диагностики запустите scripts/separate_audio.py вручную.":
    "The local separation process failed. Check FFmpeg, the model, and install-separation.ps1; run scripts/separate_audio.py manually for diagnostics.",
  "Аудио песни изменилось после постановки в очередь. Повторите разделение.":
    "Song audio changed after the job was queued. Run separation again.",
  "IN_TUNE_SEPARATION_DEVICE: допустимы cpu или cuda.":
    "IN_TUNE_SEPARATION_DEVICE: allowed values are cpu or cuda.",
  "Для разделения нужно непустое аудио до 10 минут.":
    "Separation requires nonempty audio up to 10 minutes.",
  "Разделение вернуло неверную длительность или смещение.":
    "Separation returned an invalid duration or offset.",
  "Разделение вернуло пустые дорожки.": "Separation returned empty tracks.",
  "Исходное аудио изменилось во время разделения. Результат отброшен.":
    "Source audio changed during separation. The result was discarded.",
  "Готовая дорожка для текущего аудио не найдена.":
    "No ready track found for the current audio.",
  "Достигнут лимит обращений к источникам: 20 в минуту. Повторите попытку позже.":
    "The source request limit of 20 per minute was reached. Try again later.",
  "Неизвестный источник.": "Unknown source.",
  "Запрос должен содержать от 2 до 120 печатных символов.":
    "The query must contain 2 to 120 printable characters.",
  "Запрос ручного импорта превышает допустимый размер.":
    "The manual import request exceeds the allowed size.",
  "Нужны название и исполнитель (до 200 символов) и текст (от 1 до 120000 символов).":
    "A title and artist (up to 200 characters) and lyrics (1 to 120,000 characters) are required.",
  "Доступны поиск по открытому HTML и импорт песен. Работа зависит от сайта и сети.":
    "Public HTML search and song import are available. Availability depends on the website and network.",
  "Доступен импорт по прямой ссылке. Поиск возвращает только форму без результатов: найдите песню на сайте и вставьте ссылку.":
    "Direct-link import is available. Search returns a form without results: find the song on the website and paste its link.",
  "Доступен импорт по прямой ссылке. Правила robots.txt сайта запрещают автоматический поиск /search.":
    "Direct-link import is available. The website robots.txt rules prohibit automated /search requests.",
  "Доступен импорт открытых версий Chords/Ukulele Chords при наличии встроенных данных. robots.txt запрещает автоматический поиск; платные материалы и проверки доступа не обходятся.":
    "Import of public Chords/Ukulele Chords versions is available when embedded data exists. robots.txt prohibits automated search; paid content and access checks are not bypassed.",
  "Разметка песни не найдена. Сайт мог измениться или требовать JavaScript. Вставьте текст вручную.":
    "Song markup not found. The website may have changed or require JavaScript. Paste the lyrics manually.",
  "Источник требует браузер или проверку доступа. Откройте сайт или вставьте текст вручную.":
    "The source requires a browser or access verification. Open the website or paste lyrics manually.",
  "Формат расположения аккордов MyChords изменился. Вставьте текст вручную.":
    "The MyChords chord layout format changed. Paste the lyrics manually.",
  "Некоторые обозначения MyChords сохранены как текст. Проверьте расположение аккордов.":
    "Some MyChords symbols were preserved as text. Check chord positions.",
  "Аккорд MyChords привязан к концу строки. Проверьте его расположение.":
    "A MyChords chord is attached to the end of a line. Check its position.",
  "Открытые встроенные данные Ultimate Guitar недоступны. Вставьте текст вручную.":
    "Public embedded Ultimate Guitar data is unavailable. Paste the lyrics manually.",
  "Поддерживаются только доступные открытые версии с аккордами. Этот подбор недоступен или имеет другой формат.":
    "Only available public chord versions are supported. This chord sheet is unavailable or uses a different format.",
  "Ultimate Guitar не предоставил доступный текст с аккордами. Вставьте текст вручную.":
    "Ultimate Guitar did not provide accessible lyrics with chords. Paste the lyrics manually.",
  "{value0} · вариант {value2}": "{value0} · version {value2}",
  "Встроенные данные Ultimate Guitar изменились или повреждены. Вставьте текст вручную.":
    "The embedded Ultimate Guitar data changed or is corrupted. Paste the lyrics manually.",
  "Источник не предоставил название песни. Вставьте текст вручную.":
    "The source did not provide a song title. Paste the lyrics manually.",
  "Источник не предоставил текст песни. Вставьте текст вручную.":
    "The source did not provide song lyrics. Paste the lyrics manually.",
  "Проверьте импортированные аккорды и их расположение. Тайминг и темп не определялись.":
    "Check imported chords and their positions. Timing and tempo were not detected.",
  "Результаты поиска Akkords не найдены. Страница изменилась или поиск недоступен.":
    "Akkords search results not found. The page changed or search is unavailable.",
  "В разметке поиска Akkords нет поддерживаемых ссылок на песни.":
    "Akkords search markup contains no supported song links.",
  "HTML источника слишком сложен для безопасного разбора.":
    "The source HTML is too complex to parse safely.",
  "HTML источника превышает допустимый размер.":
    "Source HTML exceeds the allowed size.",
  "Источник вернул некорректный HTML.": "The source returned invalid HTML.",
  "Некорректная ссылка на источник.": "Invalid source link.",
  "Разрешены только HTTPS-ссылки на четыре поддерживаемых сайта.":
    "Only HTTPS links to the four supported websites are allowed.",
  "Переадресация или результат ведёт на другой источник.":
    "A redirect or result points to a different source.",
  "Некорректный путь в ссылке на источник.": "Invalid path in the source link.",
  "Некорректные параметры поиска.": "Invalid search parameters.",
  "Ссылка не ведёт на поддерживаемую открытую страницу песни или поиска.":
    "The link does not point to a supported public song or search page.",
  "DNS источника недоступен или возвращает непубличный IP-адрес.":
    "Source DNS is unavailable or returns a nonpublic IP address.",
  "Служба DNS занята. Повторите попытку позже.":
    "The DNS service is busy. Try again later.",
  "Превышено время ожидания DNS источника.": "Source DNS lookup timed out.",
  "Источник вернул слишком много переадресаций или не указал адрес.":
    "The source returned too many redirects or omitted the address.",
  "Источник запретил доступ или ограничил частоту запросов. Откройте сайт или вставьте текст вручную.":
    "The source denied access or limited requests. Open the website or paste lyrics manually.",
  "Источник вернул HTTP {value1}.": "The source returned HTTP {value1}.",
  "Источник вернул неподдерживаемый тип данных.":
    "The source returned an unsupported data type.",
  "Источник вернул неподдерживаемые сжатые данные.":
    "The source returned unsupported compressed data.",
  "Ответ источника превышает допустимый размер.":
    "The source response exceeds the allowed size.",
  "Источник использует неподдерживаемую кодировку.":
    "The source uses an unsupported encoding.",
  "Превышено время ожидания ответа источника.":
    "The source response timed out.",
  "Не удалось безопасно загрузить источник. Откройте сайт или вставьте текст вручную.":
    "Could not load the source safely. Open the website or paste lyrics manually.",
  "Превышено допустимое число переадресаций источника.":
    "The source redirect limit was exceeded.",
  "Правила robots.txt источника запрещают этот запрос. Откройте сайт или вставьте текст вручную.":
    "The source robots.txt rules prohibit this request. Open the website or paste lyrics manually.",
  "Все соединения с источниками заняты. Повторите попытку позже.":
    "All source connections are busy. Try again later.",
  "Введите текст песни или аккорды.": "Enter song lyrics or chords.",
  "Текст песни превышает 120000 символов.":
    "Song lyrics exceed 120,000 characters.",
  "Текст песни содержит недопустимые управляющие символы.":
    "Song lyrics contain invalid control characters.",
  "В песне больше 200 разделов.": "The song has more than 200 sections.",
  "Превышено допустимое число строк или аккордов.":
    "The allowed number of lines or chords was exceeded.",
  "В песне больше 200 разных аккордов.":
    "The song has more than 200 different chords.",
  "Некоторые аккорды выходили за длину строки и привязаны к её концу. Проверьте расположение.":
    "Some chords were beyond the line length and were attached to its end. Check their positions.",
  "Одна из строк песни превышает 10000 символов.":
    "A song line exceeds 10,000 characters.",
  "Обозначения, не поддерживаемые текущей палитрой, сохранены как текст. Проверьте эти аккорды.":
    "Symbols not supported by the current palette were preserved as text. Check these chords.",
  "Пустые повторные заголовки разделов развёрнуты из предыдущего одноимённого раздела. Проверьте повторы.":
    "Empty repeated section headings were expanded from the previous section with the same name. Check repetitions.",
  "Заголовок без текста и без предыдущего одноимённого раздела сохранён для проверки.":
    "A heading without lyrics or an earlier section with the same name was retained for review.",
  "Строки песни не найдены.": "No song lines found.",
  "Поддерживаемые аккорды не распознаны. Их можно расставить вручную.":
    "No supported chords were recognized. You can place them manually.",
  "Не удалось надёжно совместить текст с записью. Расставьте начало и конец строк вручную в «Проверке разметки».":
    "Could not reliably align the lyrics with the recording. Mark line start and end times manually in Timing review.",
  "Песня не найдена": "Song not found",
  "Аудио не найдено": "Audio not found",
  "Ресурс не найден": "Resource not found",
  "Ожидается строка": "Expected a string",
  "Ожидается список": "Expected a list",
  "Ожидается объект": "Expected an object",
  "Ожидается число": "Expected a number",
  "Ожидается логическое значение": "Expected a boolean",
  "Анализ прерван перезапуском сервера. Запустите его снова.":
    "Analysis was interrupted by a server restart. Start it again.",
  "Ручной ввод": "Manual input",
  "Failed to fetch": "Could not reach the server.",
  "NetworkError when attempting to fetch resource.":
    "Could not reach the server.",
};
export default errorMessages;

/** Stable LRCLIB codes supply a localized heading for future/unknown diagnostics. */
export const errorCodeMessages: Record<string, string> = {
  invalid_id: "ID вне допустимого диапазона.",
  invalid_url: "Нужна ссылка https://lrclib.net/tracks/число.",
  invalid_query: "Недопустимый запрос LRCLIB.",
  invalid_duration: "duration: число секунд от 0 до 86400.",
  invalid_selector: "Укажите ровно один параметр: id или url.",
  not_found: "Запись LRCLIB не найдена.",
  upstream_rate_limited: "LRCLIB ограничил запросы.",
  upstream_unavailable: "LRCLIB временно недоступен.",
  upstream_overloaded: "LRCLIB перегружен. Повторите запрос позже.",
  upstream_redirect: "Переадресация LRCLIB заблокирована.",
  upstream_http_error: "LRCLIB вернул ошибку HTTP.",
  invalid_response: "Некорректные поля записи LRCLIB.",
  response_too_large: "Ответ LRCLIB превышает допустимый размер.",
  unsafe_dns: "Не удалось безопасно разрешить адрес LRCLIB.",
  upstream_timeout: "Превышено время ожидания LRCLIB.",
  upstream_network_error: "Не удалось безопасно загрузить LRCLIB.",
  busy: "Запрос LRCLIB уже выполняется.",
  rate_limited: "Повторите запрос LRCLIB позже.",
};
