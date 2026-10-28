import { it, expect } from "vitest";
import { rankResults, groupResults, type SearchResult } from "./searchRanking";
const result = (
  source: string,
  title: string,
  artist = "Кино",
): SearchResult => ({
  source,
  title,
  artist,
  url: `https://${source}.example/${artist}/${title}`,
});
it("prefers Akkords only among equally relevant real matches", () => {
  const exact = result("mychords", "Мама-анархия"),
    preferred = result("akkords", "Мама анархия"),
    unrelated = result("akkords", "Стук");
  expect(rankResults([unrelated, exact, preferred], "мама анархия")).toEqual([
    preferred,
    exact,
    unrelated,
  ]);
  expect(
    rankResults(
      [
        result("akkords", "Однажды"),
        result("chorder", "Однажды", "Другой артист"),
      ],
      "Другой артист однажды",
    )[0].source,
  ).toBe("chorder");
});
it("groups variants of one artist, keeps same-named songs from different artists separate", () => {
  expect(
    groupResults([
      result("akkords", "Стук"),
      result("mychords", "Стук"),
      result("chorder", "Стук", "Другой артист"),
    ]),
  ).toHaveLength(2);
  expect(
    rankResults([result("akkords", "Стук"), result("akkords", "Стук")], "стук"),
  ).toHaveLength(1);
});
