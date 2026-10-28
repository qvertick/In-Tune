"""All song text in these tests is synthetic, not downloaded site material."""
import pytest

from backend.schema import Song
from backend.sources.errors import SourceError
from backend.sources.parser import parse_text


def lines(song):
    return [line for section in song["sections"] for line in section["lines"]]


def chords(song, line):
    palette = {entry["id"]: entry["name"] for entry in song["palette"]}
    return [(c["offset"], palette[c["paletteId"]]) for c in line["chords"]]


def test_inline_unicode_offsets_entities_accidentals_and_schema():
    song, warnings = parse_text("Тест", "Тестер", "[Куплет 1]\n[Am]Привет 🌍 [F♯m/C♯]синтетика [B♭]!")
    line = lines(song)[0]
    assert line["text"] == "Привет 🌍 синтетика !"
    assert chords(song, line) == [(0, "Am"), (9, "F#m/C#"), (19, "Bb")]
    assert not warnings
    Song.model_validate(song)


def test_chords_above_pre_columns_tabs_and_clamping():
    song, warnings = parse_text("Test", "", "\tAm    G\n    abcdefghijk\n             D\nshort")
    first, second = lines(song)
    assert chords(song, first) == [(4, "Am"), (10, "G")]
    assert chords(song, second) == [(5, "D")]
    assert any("концу" in w for w in warnings)
    Song.model_validate(song)


def test_instrumental_rows_have_no_chord_names_as_lyrics():
    song, _ = parse_text("Test", "", "[Intro]\n| Am   G | D/F# | }x2\n\nC      D")
    first, second = lines(song)
    assert chords(song, first) == [(2, "Am"), (7, "G"), (11, "D/F#")]
    assert first["text"] == "|        |      | }x2"
    assert "Am" not in first["text"] and "D/F#" not in first["text"]
    assert first["text"].strip().endswith("}x2")
    assert second["text"].strip() == ""
    assert chords(song, second) == [(0, "C"), (7, "D")]
    Song.model_validate(song)


def test_full_repeated_chorus_does_not_double_body():
    song, warnings = parse_text("Test", "", "[Chorus]\n[Am]Synthetic chorus\n[Verse]\n[G]Synthetic verse\n[Chorus]\n[Am]Synthetic chorus")
    assert [len(s["lines"]) for s in song["sections"]] == [1, 1, 1]
    assert len(lines(song)) == 3
    assert not any("развёрнуты" in w for w in warnings)
    Song.model_validate(song)


def test_bare_repeated_labels_expand_only_after_empty_body_is_known():
    song, warnings = parse_text("Test", "", "[[припев]]\n[Am]Тест припева\n[[куплет_2|B:DUD]]\n[G]Тест куплета\n[[припев]]\n\n[[припев]]")
    assert [s["name"] for s in song["sections"]] == ["припев", "куплет 2", "припев", "припев"]
    assert [len(s["lines"]) for s in song["sections"]] == [1, 1, 1, 1]
    assert [s["lines"][0]["text"] for s in song["sections"]] == ["Тест припева", "Тест куплета", "Тест припева", "Тест припева"]
    assert any("развёрнуты" in w for w in warnings)
    Song.model_validate(song)  # repeated sections/lines/chords must have fresh IDs


def test_section_inline_instrumental_repeats_and_lyric_prose():
    song, _ = parse_text("Test", "", "Вступление: Am | G } 4 раза\nКуплет 1:\n[Am]Пробная строка\nchorus appears inside synthetic prose")
    assert [s["name"] for s in song["sections"]] == ["Вступление", "Куплет 1"]
    assert "4 раза" in lines(song)[0]["text"]
    assert "chorus appears" in lines(song)[-1]["text"]
    Song.model_validate(song)


def test_unsupported_chords_are_preserved_not_invented():
    song, warnings = parse_text("Test", "", "E5 F#5\n[not-a-chord]synthetic")
    assert lines(song)[0]["text"] == "E5 F#5"
    assert lines(song)[1]["text"] == "[not-a-chord]synthetic"
    assert not song["palette"]
    assert warnings
    Song.model_validate(song)


@pytest.mark.parametrize("text", [" ", "a" * 120001, "x\x00y", "x" * 10001, "\n".join("a" for _ in range(2001))],
                         ids=["empty", "total-size", "control", "line-size", "line-count"])
def test_parser_limits(text):
    with pytest.raises(SourceError):
        parse_text("Test", "", text)


def test_language_and_origin():
    origin = {"site": "chorder", "url": "https://chorder.ru/songs/test/1-test-akkordy", "author": "Tester"}
    song, _ = parse_text("Тест", "Тестер", "[Am]Їжачок ґречно мріє", origin)
    assert song["language"] == "uk" and song["origin"] == origin
    origin["author"] = "changed"
    assert song["origin"]["author"] == "Tester"
    Song.model_validate(song)
