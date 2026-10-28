"""Text/chord parser shared by manual input and the real source adapters."""
from copy import deepcopy
from datetime import datetime, timezone
import re
from uuid import uuid4

from backend.schema import normalize_chord
from .errors import SourceError

MAX_TEXT = 120000
SECTION = re.compile(
    r"^(?P<name>(?:verse|chorus|pre[ -]?chorus|bridge|intro|outro|solo|instrumental|interlude|coda|"
    r"куплет|припев|предприпев|приспів|вступление|вступ|проигрыш|програш|бридж|кода|соло|концовка)"
    r"(?:[ _-]*\d+)?)(?:\s*(?:[xх×]\s*\d+))?\s*:?(?P<rest>.*)$", re.I)
REPEAT = re.compile(r"(?:[}\]]\s*)?(?:[xх×]\s*\d+|\d+\s*(?:раз[аы]?|times))\s*$", re.I)
BRACKETS = re.compile(r"\[([^\[\]\n]{1,64})\]")


def uid():
    return str(uuid4())


def chord_name(value: str) -> str | None:
    """Use the application's palette grammar. Unsupported notation stays visible."""
    value = value.strip().replace("♯", "#").replace("♭", "b")
    if len(value) > 64:
        return None
    try:
        return normalize_chord(value)
    except ValueError:
        return None


def chord_row(value: str):
    """Return [(Unicode column, canonical chord)] only for an entire chord row."""
    value = re.sub(r"\[([^\[\]]+)\]", r"\1", value)
    trimmed = REPEAT.sub("", value)
    tokens = list(re.finditer(r"[^\s|:;,{}()\[\]—–-]+", trimmed))
    if not tokens:
        return None
    result = []
    for token in tokens:
        name = chord_name(token[0])
        if name is None:
            return None
        result.append((token.start(), name))
    return result


def _inline(value: str):
    pieces = []
    chords = []
    cursor = 0
    length = 0
    for match in BRACKETS.finditer(value):
        name = chord_name(match[1])
        if not name:
            continue
        before = value[cursor:match.start()]
        pieces.append(before)
        length += len(before)
        chords.append((length, name))
        cursor = match.end()
    pieces.append(value[cursor:])
    return "".join(pieces), chords


def _section_header(raw: str):
    value = raw.strip()
    if value.startswith("[[") and value.endswith("]]"):
        # Chorder labels contain optional picking/strumming directives after '|'.
        value = value[2:-2].split("|", 1)[0].replace("_", " ")
    elif value.startswith("[") and value.endswith("]") and not chord_name(value[1:-1]):
        value = value[1:-1]
    match = SECTION.fullmatch(value)
    if match:
        # Avoid interpreting ordinary prose beginning with 'chorus' as a heading.
        rest = match["rest"].strip()
        if rest and ":" not in value and not chord_row(rest):
            return None
        name = match["name"].replace("_", " ")
        repeat = re.search(r"[xх×]\s*\d+", value, re.I)
        return name + ((" " + repeat[0]) if repeat else ""), rest
    return None


def parse_text(title: str, artist: str, text: str, origin: dict | None = None) -> tuple[dict, list[str]]:
    if not isinstance(text, str) or not text.strip():
        raise SourceError("Введите текст песни или аккорды.", 422)
    if len(text) > MAX_TEXT:
        raise SourceError("Текст песни превышает 120000 символов.", 413)
    if any(ord(c) < 32 and c not in "\n\r\t" for c in text):
        raise SourceError("Текст песни содержит недопустимые управляющие символы.", 422)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ").expandtabs(4)
    palette = {}
    sections = []
    current = None
    pending = None
    warnings = []
    total_lines = 0
    total_chords = 0

    def warn(message):
        if message not in warnings:
            warnings.append(message)

    def section(name):
        nonlocal current
        if len(sections) >= 200:
            raise SourceError("В песне больше 200 разделов.", 422)
        current = {"id": uid(), "name": name[:200], "lines": []}
        sections.append(current)

    def line(value, events):
        nonlocal total_lines, total_chords
        if current is None:
            section("Песня")
        if len(value) > 10000 or total_lines >= 2000 or len(events) > 2000 or total_chords + len(events) > 20000:
            raise SourceError("Превышено допустимое число строк или аккордов.", 422)
        chords = []
        for offset, name in events:
            if name not in palette:
                if len(palette) >= 200:
                    raise SourceError("В песне больше 200 разных аккордов.", 422)
                palette[name] = uid()
            if offset > len(value):
                warn("Некоторые аккорды выходили за длину строки и привязаны к её концу. Проверьте расположение.")
            chords.append({"id": uid(), "paletteId": palette[name],
                           "offset": min(offset, len(value)), "source": "manual"})
        current["lines"].append({"id": uid(), "text": value, "chords": chords, "source": "manual"})
        total_lines += 1
        total_chords += len(chords)

    def flush():
        nonlocal pending
        if pending:
            raw, events = pending
            # Instrumentals have no lyric words: spaces preserve anchor columns,
            # while bars/repeat marks remain useful performance annotations.
            notation = re.sub(r"\[([^\[\]]+)\]", r"\1", raw)
            notation = re.sub(r"[^\s|:;,{}()\[\]—–-]+",
                              lambda m: " " * len(m[0]) if chord_name(m[0]) else m[0], notation)
            line(notation, events)
            pending = None

    for raw in text.split("\n"):
        if len(raw) > 10000:
            raise SourceError("Одна из строк песни превышает 10000 символов.", 422)
        if not raw.strip():
            flush()
            continue
        heading = _section_header(raw)
        if heading:
            flush()
            name, rest = heading
            section(name)
            if not rest:
                continue
            raw = rest
        events = chord_row(raw)
        if events:
            flush()
            pending = (raw, events)
            if REPEAT.search(raw):
                flush()
            continue
        value, inline = _inline(raw)
        if pending:
            _, above = pending
            pending = None
            # Preserve indentation; offsets use Unicode code points like Array.from.
            line(value, sorted(above + inline))
        else:
            line(value, inline)
        if re.search(r"(?<!\w)[A-GH][#b♯♭]?(?:5|m7b5|\([^\n)]*\))(?=\s|\]|$)", raw):
            warn("Обозначения, не поддерживаемые текущей палитрой, сохранены как текст. Проверьте эти аккорды.")
    flush()
    # Resolve repeats only after parsing: a recurring heading followed by actual
    # lyrics must never expand a second copy in front of those lyrics.
    originals = {}
    names_by_id = {id: name for name, id in palette.items()}
    for target in sections:
        key = target["name"].casefold()
        if target["lines"]:
            originals.setdefault(key, target)
        elif key in originals:
            current = target
            for old in originals[key]["lines"]:
                line(old["text"], [(c["offset"], names_by_id[c["paletteId"]]) for c in old["chords"]])
            warn("Пустые повторные заголовки разделов развёрнуты из предыдущего одноимённого раздела. Проверьте повторы.")
        else:
            current = target
            line(target["name"], [])
            warn("Заголовок без текста и без предыдущего одноимённого раздела сохранён для проверки.")
    if not sections:
        raise SourceError("Строки песни не найдены.", 422)
    if not palette:
        warn("Поддерживаемые аккорды не распознаны. Их можно расставить вручную.")
    body = "\n".join(l["text"] for s in sections for l in s["lines"])
    language = "uk" if re.search("[іїєґІЇЄҐ]", body) else ("ru" if re.search("[а-яА-ЯёЁ]", body) else "en")
    song = {"schemaVersion": 1, "id": uid(), "title": title.strip()[:200] or "Без названия",
            "artist": artist.strip()[:200], "language": language,
            "palette": [{"id": id, "name": name} for name, id in palette.items()],
            "sections": sections, "performance": {"fontSize": 24, "bpm": 120, "beats": 4},
            "audio": None, "updatedAt": datetime.now(timezone.utc).isoformat(), "source": "manual"}
    if origin:
        song["origin"] = deepcopy(origin)
    return song, warnings
