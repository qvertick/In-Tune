export type PaletteChord = {
  id: string;
  name: string;
};

export type Occurrence = {
  id: string;
  paletteId: string;
  /** Position between Unicode code points, rather than UTF-16 code units. */
  offset: number;
  source: "manual" | "model";
  manuallyEdited?: boolean;
  start?: number;
  end?: number;
};

export type Line = {
  id: string;
  text: string;
  chords: Occurrence[];
  source?: "manual" | "model";
  manuallyEdited?: boolean;
  start?: number;
  end?: number;
  timingReview?: boolean;
  words?: { text: string; start: number; end: number }[];
};

export type Section = {
  id: string;
  name: string;
  lines: Line[];
};

export type Song = {
  schemaVersion: 1;
  id: string;
  title: string;
  artist: string;
  language: "ru" | "uk" | "en";
  palette: PaletteChord[];
  sections: Section[];
  performance: { fontSize: number; bpm: number; beats: number };
  audio: null | { filename: string; url: string; duration?: number };
  updatedAt: string;
  source: "manual" | "model";
};

/** Unique locally, including environments without crypto.randomUUID. */
export function id(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues)
    globalThis.crypto.getRandomValues(bytes);
  else
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Intentionally limited: note roots, common qualities/extensions, alterations,
// and an optional single bass note. This is not a full chord-symbol parser.
const CHORD =
  /^([A-Ga-g])([#b]?)(m(?:aj)?|maj|min|dim|aug|sus[24]?|add(?:2|4|9|11|13))?(6|7|9|11|13)?((?:[#b](?:5|9|11|13))*)(sus[24])?(?:\/([A-Ga-g])([#b]?))?$/;

export function normalizeChord(input: string): string | null {
  const match = CHORD.exec(input.trim().replace(/♯/g, "#").replace(/♭/g, "b"));
  if (!match) return null;
  const [
    ,
    root,
    accidental,
    quality = "",
    extension = "",
    alterations,
    suspension = "",
    bass,
    bassAccidental,
  ] = match;
  return `${root.toUpperCase()}${accidental}${quality}${extension}${alterations}${suspension}${bass ? `/${bass.toUpperCase()}${bassAccidental}` : ""}`;
}

/** Treat the changed span as one replacement, using its common prefix/suffix. */
export function editLine(line: Line, newText: string): Line {
  if (line.text === newText) return line;

  const before = Array.from(line.text);
  const after = Array.from(newText);
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix++;

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;

  const oldEnd = before.length - suffix;
  const delta = after.length - before.length;
  const { start: _start, end: _end, words: _words, ...untimed } = line;
  return {
    ...untimed,
    text: newText,
    source: "manual",
    manuallyEdited: true,
    ...(_start !== undefined || _words ? { timingReview: true } : {}),
    chords: line.chords.map(({ start: _start, end: _end, ...chord }) => {
      const offset =
        chord.offset < prefix
          ? chord.offset
          : chord.offset >= oldEnd
            ? chord.offset + delta
            : prefix;
      return { ...chord, offset: Math.max(0, Math.min(after.length, offset)) };
    }),
  };
}

export function createSong(demo = false): Song {
  const palette: PaletteChord[] = demo
    ? ["Am", "F", "C", "G"].map((name) => ({ id: id(), name }))
    : [];
  const texts = demo
    ? [
        "Тихий свет ложится на ладони,",
        "Мы идём навстречу новому дню.",
        "Пусть аккорд негромко нас догонит,",
        "Я простой мотив с собой возьму.",
      ]
    : [""];
  return {
    schemaVersion: 1,
    id: id(),
    title: demo ? "Навстречу дню" : "Новая песня",
    artist: "",
    language: "ru",
    palette,
    sections: [
      {
        id: id(),
        name: "Куплет",
        lines: texts.map((text, index) => ({
          id: id(),
          text,
          chords: demo
            ? [
                {
                  id: id(),
                  paletteId: palette[index % palette.length].id,
                  offset: 0,
                  source: "manual",
                },
              ]
            : [],
        })),
      },
    ],
    performance: { fontSize: 24, bpm: 90, beats: 4 },
    audio: null,
    updatedAt: new Date().toISOString(),
    source: "manual",
  };
}
