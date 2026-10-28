import html
import json

import pytest

from backend.schema import Song
from backend.sources.adapters import parse_preview, parse_search, source_list
from backend.sources.errors import SourceError

AKKORDS = "https://akkords.pro/songs/test/synthetic/"
MYCHORDS = "https://mychords.net/ru/test/123-synthetic.html"
CHORDER = "https://chorder.ru/songs/test/1-synthetic-akkordy"
ULTIMATE = "https://tabs.ultimate-guitar.com/tab/12345"


def assert_valid(preview, id):
    song = preview["song"]
    assert preview["source"]["id"] == song["origin"]["site"] == id
    Song.model_validate(song)
    assert "rawHTML" not in preview
    return song, [line for s in song["sections"] for line in s["lines"]]


def test_akkords_uses_actual_chords_container_not_page_comments():
    preview = parse_preview(AKKORDS, '''<h1>Пробная: аккорды для гитары</h1>
      <a href="/songs/test/">Тестовый исполнитель</a><p class="chords">
      <b>Куплет 1:</b>
      <span>Am    G</span>
      Пробный &amp; текст 🌍
      </p><div class="apx-author-card__name">Тестовый автор</div>
      <script>raise_error()</script><div class="comment">Do not import this</div>''')
    song, lines = assert_valid(preview, "akkords")
    assert song["title"] == "Пробная" and song["artist"] == "Тестовый исполнитель"
    assert lines[0]["text"] == "      Пробный & текст 🌍"
    assert len(lines[0]["chords"]) == 2
    assert preview["source"]["author"] == "Тестовый автор"
    assert "raise_error" not in json.dumps(song) and "Do not import" not in json.dumps(song)


def test_mychords_separate_overlay_layers_and_single_line_instrumental():
    preview = parse_preview(MYCHORDS, '''<h1>Тестер - Пробная</h1>
      <li><a>Основной</a><a class="b-song__verison-title" href="/ru/test/123-synthetic.html">Тестер - Пробная</a><span>2099 1000 просмотров</span></li>
      <div class="w-words__text"><div class="single-line"><span class="b-lr-section">Вступление:</span> Am | G }x2</div>
      <div class="single-line">Куплет:</div>
      <div class="pline"><div class="c-subline"><span class="subline">  <span class="b-accord__symbol">Am</span></span><span class="subline">Пробный </span></div><div class="c-subline"><span class="subline"><span class="b-accord__symbol">F♯m</span></span><span class="subline">текст 🌍</span></div></div>
      </div>''')
    song, lines = assert_valid(preview, "mychords")
    assert song["title"] == "Пробная" and song["artist"] == "Тестер"
    assert preview["source"]["variant"] == "Основной"
    assert "Am" not in lines[0]["text"] and "x2" in lines[0]["text"]
    assert lines[1]["text"] == "Пробный текст 🌍"
    assert [chord["offset"] for chord in lines[1]["chords"]] == [2, 8]
    assert [entry["name"] for entry in song["palette"]] == ["Am", "G", "F#m"]


def test_chorder_pre_sections_and_empty_repeat():
    preview = parse_preview(CHORDER, '''<h1>Пробная аккорды, бой и перебор</h1><h3 class="song-artist"><a>Тестер</a></h3>
      <pre id="song-text">[[куплет|B:DUD]]
 Am
 Пробная строка
[[припев]]
 G
 Тестовый припев
[[припев]]</pre>''')
    song, lines = assert_valid(preview, "chorder")
    assert song["title"] == "Пробная" and len(lines) == 3
    assert lines[1]["text"] == lines[2]["text"] == " Тестовый припев"


def ultimate_html(*, type="Chords", blocked=False, content="[Verse]\n[ch]Am[/ch]\nSynthetic & text 🌍"):
    data = {"store": {"page": {"data": {
        "tab": {"type": type, "song_name": "Synthetic", "artist_name": "Tester", "version": 2},
        "tab_view": {"blocked": blocked, "wiki_tab": {"content": content, "username": "Author"}},
    }}}}
    return '<div class="js-store" data-content="' + html.escape(json.dumps(data), quote=True) + '"></div>'


def test_ultimate_public_embedded_json_without_javascript():
    preview = parse_preview(ULTIMATE, ultimate_html())
    song, lines = assert_valid(preview, "ultimate")
    assert lines[0]["text"] == "Synthetic & text 🌍"
    assert len(lines[0]["chords"]) == 1
    assert preview["source"]["author"] == "Author"
    assert preview["source"]["variant"] == "Chords · вариант 2"


@pytest.mark.parametrize("markup", [ultimate_html(type="Pro"), ultimate_html(blocked=True),
    ultimate_html(content=""), '<div class="js-store" data-content="{}"></div>',
    '<title>Just a moment...</title><form id="challenge-form"></form>'])
def test_ultimate_rejects_paid_missing_and_challenged(markup):
    with pytest.raises(SourceError):
        parse_preview(ULTIMATE, markup)


@pytest.mark.parametrize("url", [AKKORDS, MYCHORDS, CHORDER, ULTIMATE])
def test_no_whole_page_fallback(url):
    with pytest.raises(SourceError):
        parse_preview(url, "<h1>Login page</h1><p>Unrelated page text</p>")


def test_search_scoped_results_no_sidebar_or_external_links():
    html = '''<a href="/songs/wrong/sidebar/">Wrong sidebar</a>
      <ol class="apx-top-songs apx-top-songs--archive">
      <li><a class="apx-top-songs__link" href="/songs/test/synthetic/"><span class="apx-top-songs__title">Пробная</span><span class="apx-top-songs__artist">Тестер</span></a></li>
      <li><a class="apx-top-songs__link" href="https://127.0.0.1/songs/test/synthetic/"><span class="apx-top-songs__title">Unsafe</span></a></li></ol>'''
    results = parse_search("akkords", "https://akkords.pro/?s=test", html)
    assert results == [{"title": "Пробная", "artist": "Тестер", "url": AKKORDS, "source": "akkords"}]


def test_search_errors_different_from_explicit_empty_results():
    assert parse_search("akkords", "https://akkords.pro/?s=none", '<section class="no-results"></section>') == []
    with pytest.raises(SourceError):
        parse_search("akkords", "https://akkords.pro/?s=test", "<html><p>No result container</p></html>")


def test_source_capabilities_are_honest_and_localized():
    sources = source_list()["sources"]
    assert [s["id"] for s in sources] == ["akkords", "mychords", "chorder", "ultimate"]
    assert [s["searchAvailable"] for s in sources] == [True, False, False, False]
    assert all(s["importAvailable"] for s in sources)
    assert all("{query}" in s["searchUrl"] for s in sources)
    assert all(any("а" <= c <= "я" for c in s["note"]) for s in sources)
