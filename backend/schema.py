"""The version-one frontend document contract (no implicit coercion)."""
from datetime import datetime
import re
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator


def uuid_string(value: str) -> str:
    try:
        canonical = str(UUID(value))
    except ValueError as exc:
        raise ValueError("Недопустимый UUID") from exc
    if canonical != value:
        raise ValueError("Ожидается UUID в канонической форме строчными буквами")
    return value


Identifier = Annotated[str, AfterValidator(uuid_string)]
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]
CHORD = re.compile(r"([A-Ga-g])([#b]?)(m(?:aj)?|maj|min|dim|aug|sus[24]?|add(?:2|4|9|11|13))?(6|7|9|11|13)?((?:[#b](?:5|9|11|13))*)(sus[24])?(?:/([A-Ga-g])([#b]?))?")


def normalize_chord(value: str) -> str:
    match = CHORD.fullmatch(value.strip().replace("♯", "#").replace("♭", "b"))
    if not match:
        raise ValueError("Недопустимое обозначение аккорда")
    root, accidental, quality, extension, alterations, suspension, bass, bass_accidental = match.groups()
    return f"{root.upper()}{accidental}{quality or ''}{extension or ''}{alterations}{suspension or ''}" + (f"/{bass.upper()}{bass_accidental}" if bass else "")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    @model_validator(mode="before")
    @classmethod
    def no_explicit_nulls(cls, data):
        if isinstance(data, dict) and any(value is None and key != "audio" for key, value in data.items()):
            raise ValueError("Необязательное поле следует пропустить, а не указывать null")
        return data


class PaletteEntry(StrictModel):
    id: Identifier
    name: Annotated[str, Field(max_length=64), AfterValidator(normalize_chord)]


class Chord(StrictModel):
    id: Identifier
    paletteId: Identifier
    offset: Annotated[int, Field(ge=0)]
    source: Literal["manual", "model"]
    manuallyEdited: bool | None = None
    start: Nonnegative | None = None
    end: Nonnegative | None = None

    @model_validator(mode="after")
    def ordered_times(self):
        if self.end is not None and (self.start is None or self.end < self.start):
            raise ValueError("Конец аккорда требует начала и не может предшествовать ему")
        return self


class Word(StrictModel):
    text: Annotated[str, Field(max_length=10000)]
    start: Nonnegative
    end: Nonnegative

    @model_validator(mode="after")
    def ordered_times(self):
        if self.end < self.start:
            raise ValueError("Конец слова не может предшествовать началу")
        return self


class Line(StrictModel):
    id: Identifier
    text: Annotated[str, Field(max_length=10000)]
    chords: Annotated[list[Chord], Field(max_length=2000)]
    start: Nonnegative | None = None
    end: Nonnegative | None = None
    timingReview: bool | None = None
    words: Annotated[list[Word], Field(max_length=2000)] | None = None
    source: Literal["manual", "model"] | None = None
    manuallyEdited: bool | None = None

    @model_validator(mode="after")
    def ordered_times(self):
        if self.end is not None and (self.start is None or self.end <= self.start):
            raise ValueError("Конец строки должен быть позже её начала")
        return self


class Section(StrictModel):
    id: Identifier
    name: Annotated[str, Field(max_length=200)]
    lines: Annotated[list[Line], Field(max_length=2000)]


class Performance(StrictModel):
    fontSize: Annotated[int, Field(ge=16, le=60)]
    bpm: Annotated[int, Field(ge=30, le=240)]
    beats: Annotated[int, Field(ge=1, le=12)]


class Audio(StrictModel):
    filename: Annotated[str, Field(min_length=1, max_length=255)]
    url: Annotated[str, Field(min_length=1, max_length=2048)]
    duration: Nonnegative | None = None


class Song(StrictModel):
    schemaVersion: Literal[1]
    id: Identifier
    title: Annotated[str, Field(max_length=200)]
    artist: Annotated[str, Field(max_length=200)]
    language: Literal["ru", "uk", "en"]
    palette: Annotated[list[PaletteEntry], Field(max_length=200)]
    sections: Annotated[list[Section], Field(max_length=200)]
    performance: Performance
    audio: Audio | None
    updatedAt: Annotated[str, Field(max_length=64)]
    source: Literal["manual", "model"]

    @model_validator(mode="after")
    def document_integrity(self):
        try:
            timestamp = datetime.fromisoformat(self.updatedAt.replace("Z", "+00:00"))
            if timestamp.utcoffset() is None:
                raise ValueError("Missing timezone")
        except ValueError as exc:
            raise ValueError("updatedAt должен содержать дату ISO 8601 с часовым поясом") from exc
        if sum(len(section.lines) for section in self.sections) > 2000:
            raise ValueError("В песне допускается не более 2000 строк")
        if sum(len(line.chords) for section in self.sections for line in section.lines) > 20000:
            raise ValueError("В песне допускается не более 20000 вхождений аккордов")
        identifiers = {self.id}
        palette_ids = {entry.id for entry in self.palette}

        def unique(identifier: str):
            if identifier in identifiers:
                raise ValueError("UUID всех элементов документа должны быть уникальны")
            identifiers.add(identifier)

        for entry in self.palette:
            unique(entry.id)
        for section in self.sections:
            unique(section.id)
            for line in section.lines:
                unique(line.id)
                # Same positions as frontend Array.from(text), including emoji.
                length = len(line.text)
                for chord in line.chords:
                    unique(chord.id)
                    if chord.paletteId not in palette_ids:
                        raise ValueError("paletteId аккорда отсутствует в палитре")
                    if chord.offset > length:
                        raise ValueError("Смещение аккорда выходит за границы строки")
        return self

    @model_validator(mode="before")
    @classmethod
    def strict_version(cls, data):
        if isinstance(data, dict) and type(data.get("schemaVersion")) is not int:
            raise ValueError("schemaVersion должен быть целым числом 1")
        return data
