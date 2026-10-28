import { api } from "./api";
export type LrclibTrack = {
  id: number;
  name?: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  hasWordSync?: boolean;
  lyricsfile?: string | null;
};
export function lrclibId(input: string): number | null {
  try {
    const url = new URL(input.trim());
    if (
      url.protocol !== "https:" ||
      url.hostname !== "lrclib.net" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    const match = /^\/tracks\/([1-9]\d*)\/?$/.exec(url.pathname);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isSafeInteger(id) ? id : null;
  } catch {
    return null;
  }
}
export function getLrclibTrack(input: string, signal?: AbortSignal) {
  const id = lrclibId(input);
  if (!id) throw new Error("Вставьте ссылку https://lrclib.net/tracks/число.");
  return api<LrclibTrack>(`/lrclib/track?id=${id}`, { signal });
}
export function searchLrclib(
  track: string,
  artist: string,
  album: string,
  duration?: number,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    track: track.trim(),
    artist: artist.trim(),
    album: album.trim(),
  });
  if (duration !== undefined && Number.isFinite(duration))
    query.set("duration", String(duration));
  return api<LrclibTrack[]>(`/lrclib/search?${query}`, { signal });
}
