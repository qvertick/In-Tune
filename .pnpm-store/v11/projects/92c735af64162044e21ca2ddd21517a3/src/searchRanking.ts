export type SearchResult = {
  title: string;
  artist: string;
  url: string;
  source: string;
  variant?: string;
};
export function normalizedSearch(text: string) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function relevance(result: SearchResult, query: string) {
  const q = normalizedSearch(query),
    title = normalizedSearch(result.title),
    artist = normalizedSearch(result.artist);
  const words = [...new Set(q.split(" ").filter(Boolean))];
  const tokens = new Set((title + " " + artist).split(" "));
  const coverage =
    words.filter((word) => tokens.has(word)).length / Math.max(1, words.length);
  return {
    score: Math.round(coverage * 100) + (title === q ? 20 : 0),
    exact: coverage === 1,
  };
}
export function rankResults(results: SearchResult[], query: string) {
  return [...new Map(results.map((r) => [r.url, r])).values()].sort((a, b) => {
    const x = relevance(a, query),
      y = relevance(b, query);
    return (
      y.score - x.score ||
      (x.exact && y.exact
        ? Number(b.source === "akkords") - Number(a.source === "akkords")
        : 0) ||
      a.title.localeCompare(b.title, "ru")
    );
  });
}
export function groupResults(results: SearchResult[]) {
  const groups = new Map<string, SearchResult[]>();
  for (const result of results) {
    const key = result.artist.trim()
      ? normalizedSearch(result.artist) + "|" + normalizedSearch(result.title)
      : result.url;
    groups.set(key, [...(groups.get(key) || []), result]);
  }
  return [...groups.values()];
}
