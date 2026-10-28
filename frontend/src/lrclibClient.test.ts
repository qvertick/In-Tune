import { expect, it } from "vitest";
import { lrclibId } from "./lrclibClient";
it("accepts the provided track link and rejects URL tricks without requesting them", () => {
  expect(lrclibId("https://lrclib.net/tracks/20902008")).toBe(20902008);
  for (const input of [
    "http://lrclib.net/tracks/1",
    "https://lrclib.net.evil.test/tracks/1",
    "https://user@lrclib.net/tracks/1",
    "https://lrclib.net:8000/tracks/1",
    "https://lrclib.net/api/get/1",
    "https://lrclib.net/tracks/1?redirect=foo",
    "https://lrclib.net/tracks/0",
    "https://lrclib.net/tracks/9007199254740993",
  ])
    expect(lrclibId(input)).toBeNull();
});
