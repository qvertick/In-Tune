"""Source-specific extraction, based on inspected public pages (2026-10-26)."""
from dataclasses import asdict, dataclass
import json
import re
from urllib.parse import urljoin, urlsplit

from .errors import SourceError
from .html import HIDDEN, Node, parse_html, plain_layout
from .network import source_id, validate_url
from .parser import chord_name, chord_row, parse_text


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    host: str
    searchAvailable: bool
    importAvailable: bool
    searchUrl: str
    note: str


SOURCES = {
    s.id: s for s in [
        Source("akkords", "Akkords.pro", "akkords.pro", True, True,
               "https://akkords.pro/?s={query}",
               "Доступны поиск по открытому HTML и импорт песен. Работа зависит от сайта и сети."),
        Source("mychords", "MyChords.net", "mychords.net", False, True,
               "https://mychords.net/ru/search?q={query}",
               "Доступен импорт по прямой ссылке. Поиск возвращает только форму без результатов: найдите песню на сайте и вставьте ссылку."),
        Source("chorder", "Chorder.ru", "chorder.ru", False, True,
               "https://chorder.ru/search?q={query}",
               "Доступен импорт по прямой ссылке. Правила robots.txt сайта запрещают автоматический поиск /search."),
        Source("ultimate", "Ultimate Guitar", "tabs.ultimate-guitar.com", False, True,
               "https://www.ultimate-guitar.com/search.php?search_type=title&value={query}",
               "Доступен импорт открытых версий Chords/Ukulele Chords при наличии встроенных данных. robots.txt запрещает автоматический поиск; платные материалы и проверки доступа не обходятся."),
    ]
}


def source_list():
    return {"sources": [asdict(source) for source in SOURCES.values()]}


def clean(value: str, limit=200) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit]


def node_text(node: Node | None) -> str:
    return clean(node.text()) if node else ""


def _required(node: Node | None) -> Node:
    if node is None:
        raise SourceError("Разметка песни не найдена. Сайт мог измениться или требовать JavaScript. Вставьте текст вручную.")
    return node


def _check_challenge(root: Node):
    title = node_text(root.find(tag="title")).lower()
    if (any(t in title for t in ("just a moment", "access denied", "verify you are human", "captcha", "attention required"))
            or root.find(id="challenge-form") is not None or root.find(id="cf-challenge-running") is not None):
        raise SourceError("Источник требует браузер или проверку доступа. Откройте сайт или вставьте текст вручную.")


def _mychords_inline(node: Node) -> str:
    if node.tag in HIDDEN:
        return ""
    if node.tag == "br":
        return "\n"
    if node.has_class("b-accord__symbol"):
        name = chord_name(node.text())
        return "[" + name + "]" if name else node.text()
    return "".join(_mychords_inline(c) if isinstance(c, Node) else c for c in node.children)


def _mychords_text(container: Node) -> tuple[str, list[str]]:
    rows = []
    warnings = []
    for child in container.children:
        if isinstance(child, str):
            if child.strip():
                rows.append(child)
            continue
        if child.has_class("pline"):
            parts = []
            for group in child.children:
                if not isinstance(group, Node):
                    continue
                if not group.has_class("c-subline"):
                    parts.append(_mychords_inline(group))
                    continue
                layers = [n for n in group.children if isinstance(n, Node) and n.has_class("subline")]
                if len(layers) != 2:
                    raise SourceError("Формат расположения аккордов MyChords изменился. Вставьте текст вручную.")
                above, below = layers
                lyrics = below.text().replace("\xa0", " ")
                events = chord_row(above.text().replace("\xa0", " ")) or []
                if above.text().strip() and not events:
                    # Preserve uncommon notation rather than silently discarding it.
                    parts.append(above.text() + " ")
                    warnings.append("Некоторые обозначения MyChords сохранены как текст. Проверьте расположение аккордов.")
                for offset, name in reversed(events):
                    pos = min(offset, len(lyrics))
                    if offset > len(lyrics):
                        warnings.append("Аккорд MyChords привязан к концу строки. Проверьте его расположение.")
                    lyrics = lyrics[:pos] + "[" + name + "]" + lyrics[pos:]
                parts.append(lyrics)
            rows.append("".join(parts))
        elif child.has_class("single-line"):
            # Keep standalone chord rows as raw notation to preserve columns/bars.
            rows.append(child.text())
        else:
            rows.append(plain_layout(child))
    return "\n".join(rows), list(dict.fromkeys(warnings))


def _ultimate(root: Node):
    store = _required(root.find(cls="js-store"))
    raw = store.attrs.get("data-content", "")
    if not raw or len(raw) > 1600000:
        raise SourceError("Открытые встроенные данные Ultimate Guitar недоступны. Вставьте текст вручную.")
    try:
        obj = json.loads(raw)
        data = obj["store"]["page"]["data"]
        tab, view = data["tab"], data["tab_view"]
        if not isinstance(tab, dict) or not isinstance(view, dict):
            raise ValueError()
        if tab.get("type") not in ("Chords", "Ukulele Chords") or view.get("blocked"):
            raise SourceError("Поддерживаются только доступные открытые версии с аккордами. Этот подбор недоступен или имеет другой формат.")
        wiki = view.get("wiki_tab", {})
        content = wiki.get("content")
        if not isinstance(content, str) or not content.strip():
            raise SourceError("Ultimate Guitar не предоставил доступный текст с аккордами. Вставьте текст вручную.")
        # Parse the site's small chord markup vocabulary, never run site scripts.
        content = re.sub(r"\[ch\]([^\[\]\n]+)\[/ch\]", r"[\1]", content)
        content = content.replace("[tab]", "").replace("[/tab]", "")
        if re.search(r"</?[a-zA-Z][^>]*>", content):
            content = plain_layout(parse_html(content))
        title, artist = tab.get("song_name", ""), tab.get("artist_name", "")
        if not isinstance(title, str) or not isinstance(artist, str):
            raise ValueError()
        author = wiki.get("username") or tab.get("username")
        author = clean(author) if isinstance(author, str) else ""
        version = tab.get("version")
        variant = clean(f"{tab['type']} · вариант {version}") if isinstance(version, (str, int)) else tab["type"]
        return clean(title), clean(artist), content, author, variant
    except SourceError:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, RecursionError) as exc:
        raise SourceError("Встроенные данные Ultimate Guitar изменились или повреждены. Вставьте текст вручную.") from exc


def parse_preview(url: str, html: str) -> dict:
    url = validate_url(url)
    id = source_id(url)
    root = parse_html(html)
    _check_challenge(root)
    title = node_text(root.find(tag="h1"))
    author = variant = ""
    warnings = []
    if id == "akkords":
        text = plain_layout(_required(root.find(cls="chords")))
        title = re.split(r"\s*[:–—]\s*аккорды|\s+аккорды", title, maxsplit=1, flags=re.I)[0]
        artist_path = "/".join(urlsplit(url).path.rstrip("/").split("/")[:-1]) + "/"
        artist = next((node_text(n) for n in root.walk() if n.tag == "a"
                       and urlsplit(urljoin(url, n.attrs.get("href", ""))).path == artist_path), "")
        author = node_text(root.find(cls="apx-author-card__name"))
    elif id == "mychords":
        text, extra = _mychords_text(_required(root.find(cls="w-words__text")))
        warnings.extend(extra)
        parts = re.split(r"\s+[–—-]\s+", title, maxsplit=1)
        artist, title = parts if len(parts) == 2 else ("", title)
        author_node = root.find(cls="b-words__author")
        if author_node:
            for author_link in author_node.walk():
                if author_link.tag == "a" and re.fullmatch(r"/(?:ru/|en/|uk/|de/)?user/\d+/?",
                                                           urlsplit(author_link.attrs.get("href", "")).path):
                    author = node_text(author_link) or clean(author_link.attrs.get("title", ""))
                    break
        for link in root.walk():
            if link.has_class("b-song__verison-title") and urljoin(url, link.attrs.get("href", "")) == url:
                # Adjacent inline elements need not have intervening whitespace.
                # Read the separate version label, excluding title/date/vote text.
                siblings = link.parent.children if link.parent else []
                variant = next((node_text(n) for n in siblings if isinstance(n, Node) and n is not link
                                and re.fullmatch(r"(?:Основной|\d+\s+вариант)", node_text(n), re.I)), "")
                break
    elif id == "chorder":
        text = plain_layout(_required(root.find(tag="pre", id="song-text")))
        artist = node_text(root.find(cls="song-artist"))
        title = re.split(r"\s+аккорды", title, maxsplit=1, flags=re.I)[0]
    else:
        title, artist, text, author, variant = _ultimate(root)
    if not title:
        raise SourceError("Источник не предоставил название песни. Вставьте текст вручную.")
    if not text.strip():
        raise SourceError("Источник не предоставил текст песни. Вставьте текст вручную.")
    origin = {"site": id, "url": url}
    info = {"id": id, "name": SOURCES[id].name, "url": url}
    for key, value in (("author", author), ("variant", variant)):
        if value:
            origin[key] = info[key] = value
    song, extra = parse_text(title, artist, text, origin)
    warnings.extend(extra)
    warnings.append("Проверьте импортированные аккорды и их расположение. Тайминг и темп не определялись.")
    return {"song": song, "warnings": list(dict.fromkeys(warnings)), "source": info}


def parse_search(id: str, url: str, html: str) -> list[dict]:
    """Only implemented public HTML search. Sidebar/recommendation links are excluded."""
    if id != "akkords":
        raise SourceError(SOURCES[id].note, 503)
    root = parse_html(html)
    _check_challenge(root)
    archive = root.find(cls="apx-top-songs--archive")
    if archive is None:
        # A confirmed no-results template is different from unexpected/protected HTML.
        if root.find(cls="no-results") is not None:
            return []
        raise SourceError("Результаты поиска Akkords не найдены. Страница изменилась или поиск недоступен.")
    results = []
    seen = set()
    for link in archive.walk():
        if link.tag != "a" or not link.has_class("apx-top-songs__link"):
            continue
        try:
            target = validate_url(urljoin(url, link.attrs.get("href", "")), source=id)
        except SourceError:
            continue
        title = node_text(link.find(cls="apx-top-songs__title"))
        artist = node_text(link.find(cls="apx-top-songs__artist"))
        if title and target not in seen:
            results.append({"title": title, "artist": artist, "url": target, "source": id})
            seen.add(target)
        if len(results) >= 20:
            break
    if not results:
        raise SourceError("В разметке поиска Akkords нет поддерживаемых ссылок на песни.")
    return results
