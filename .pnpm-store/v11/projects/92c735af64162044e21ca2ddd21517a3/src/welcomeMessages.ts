const welcomeMessages: Record<string, string> = {
  "Текст, аккорды и запись — в одном пространстве.":
    "Lyrics, chords and your recording in one space.",
  "Посмотри, как слова и аккорды следуют по разметке.":
    "Watch words and chords follow a timing map.",
  "Три шага от разбора к своему звучанию.":
    "Three steps from a chord sheet to your own sound.",
  "Выбери аккорд и открой свою библиотеку.":
    "Try a chord and open your library.",
  "Открыть для «{title}»": "Open for “{title}”",
  "Выбрать песню": "Choose a song",
  Сначала: "Restart",
  "Следующая строка": "Next line",
  "Времена примера заданы вручную. Без звука.": "Hand-timed example. No audio.",
  "Без звука · попробуй": "Silent · try it",
  "Собери свой аккорд": "Find your chord",
  "Четыре знакомые формы. Выбери аккорд — посмотри, куда поставить пальцы.":
    "Four familiar shapes. Choose a chord to see where your fingers go.",
  "Аккорды для примера": "Example chords",
  "От толстой струны E к тонкой e. ○ — открытая, × — не играть.":
    "From low E to high e. ○ — open string, × — do not play.",
  "Аппликатура {chord}: {frets}": "{chord} fingering: {frets}",
  "Ля минор": "A minor",
  "До мажор": "C major",
  "Соль мажор": "G major",
  "Ми минор": "E minor",
  "К содержимому": "Skip to content",
  "Открыть приветствие": "Open welcome page",
  "Начало работы": "Getting started",
  "Показывать приветствие при запуске": "Show welcome page on startup",
  "Прямые ссылки на песни всегда открывают песню.":
    "Direct song links always open the song.",
  "Твоё пространство. Твои привычки.": "Your space. Your routine.",
  "Возможно, она удалена из локальной библиотеки.":
    "It may have been removed from your local library.",
  Начало: "Start",
  Начать: "Begin",
  "Твой звук": "Your sound",
  "Навигация приветствия": "Welcome navigation",
  "Разделы приветствия": "Welcome sections",
  Возможности: "Explore",
  "В библиотеку": "Library",
  "Личное музыкальное пространство": "Your personal music space",
  "Локально. В твоём ритме.": "Local. At your own pace.",
  "Твой голос.": "Your voice.",
  "Твои струны.": "Your strings.",
  "В одном ритме.": "One rhythm.",
  "Текст, аккорды и музыка в одном месте. Чтобы меньше искать — и больше играть.":
    "Lyrics, chords and music in one place. Less searching. More playing.",
  "Открыть библиотеку": "Open library",
  Продолжить: "Continue",
  "Ниже — ближе к музыке": "A little closer to the music",
  "Без облака для твоих записей": "Your recordings stay local",
  "Слова —": "Every word,",
  "на своём месте.": "in its place.",
  "Аккорды над нужными буквами. Следующие строки — заранее. Текст следует за временем записи и оставляет тебе место для музыки.":
    "Chords above the right letters. Upcoming lines in view. Lyrics follow your recording, leaving you room for the music.",
  "С настоящей разметкой — по словам. Без неё — по строкам или приблизительно.":
    "With word timestamps, follow each word. Otherwise, use line timing or an optional estimate.",
  "Авторский пример": "Original example",
  "Демонстрация · без звука": "Visual demo · no audio",
  "Пример текста с аккордами": "Lyrics and chords example",
  "Показать подсветку": "Preview highlighting",
  "Остановить пример": "Stop preview",
  "Только визуальный пример. Микрофон не используется.":
    "Visual example only. No microphone is used.",
  "Тихий свет ложится на ладони.": "Quiet light falls into our hands.",
  "Этот ритм останется со мной.": "I will keep this rhythm close to me.",
  "Пусть звучит ещё одна история.": "Let another story find its sound.",
  "Пой со мной. Играй со мной.": "Sing with me. Play with me.",
  "Интерактивные ноты": "Interactive notes",
  "Пульсировать ноту {number}": "Pulse note {number}",
  "Подсветить нотную линейку": "Highlight staff lines",
  "Подсвечена нотная линейка": "Staff lines highlighted",
  "Пульсирует нота": "Note pulsing",
  "От первой строки": "From the first line",
  "до твоего звучания.": "to your own sound.",
  "Собери песню так, как удобно тебе. Все правки, аккорды и записи остаются в твоей локальной библиотеке.":
    "Make the song your own. Your edits, chords and recordings stay in your local library.",
  "Найди свою песню": "Find your song",
  "Импортируй разбор из поддерживаемого источника или добавь собственный текст с аккордами.":
    "Import an arrangement from a supported source, or add your own lyrics and chords.",
  "Добавь время словам": "Give words their time",
  "Найди синхронизацию в LRCLIB, импортируй LRC или отметь строки под свою запись.":
    "Find synced lyrics on LRCLIB, import LRC, or mark lines to your own recording.",
  "Настрой звучание": "Shape your sound",
  "Играй под оригинал, готовый вокал или сопровождение. В микшере можно собрать свой баланс.":
    "Play along with the original, prepared vocals or accompaniment. Find your balance in the mixer.",
  "Разделение дорожек требует отдельной локальной установки. Модели не загружаются из приветствия.":
    "Stem separation requires a separate local installation. The welcome page never downloads models.",
  "Пусть звучит.": "Let it play.",
  "Одна песня. Немного времени. Твой собственный ритм.":
    "One song. A little time. Your own rhythm.",
  "Выбери свой инструмент": "Choose your instrument",
  "У каждой гитары — свой голос.": "Every guitar has its own voice.",
  "Нажми на силуэт, чтобы подсветить его. Это небольшой интерактив без звука.":
    "Select a silhouette to highlight it. This small interaction has no sound.",
  "Виды гитар": "Guitar types",
  Акустическая: "Acoustic",
  Трансакустическая: "TransAcoustic",
  Электрогитара: "Electric guitar",
  Электроакустическая: "Electro-acoustic",
  "В браузере также сохраняются настройка приветствия и последняя открытая рабочая страница. Эти сведения не отправляются внешним сервисам.":
    "Your browser also stores the welcome preference and last workspace page. These details are not sent to external services.",
};
export default welcomeMessages;
