import { useCallback, useEffect, useState } from "react";

export type View =
  | "welcome"
  | "library"
  | "editor"
  | "performance"
  | "settings";
export type Route = { view: View; songId?: string };
export const NAV_KEYS = {
  seen: "in-tune.welcome.seen",
  always: "in-tune.welcome.always",
  last: "in-tune.last-route",
  song: "in-tune.last-song",
};
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const readSetting = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Current session remains usable. */
  }
}
export function parseRoute(path: string): Route | null {
  if (path === "/welcome") return { view: "welcome" };
  if (path === "/library") return { view: "library" };
  if (path === "/settings") return { view: "settings" };
  const match = new RegExp(`^/songs/(${uuid})(/player)?/?$`).exec(path);
  return match
    ? { view: match[2] ? "performance" : "editor", songId: match[1] }
    : null;
}
export function routePath(route: Route) {
  if ((route.view === "editor" || route.view === "performance") && route.songId)
    return `/songs/${route.songId}${route.view === "performance" ? "/player" : ""}`;
  return route.view === "welcome"
    ? "/welcome"
    : route.view === "settings"
      ? "/settings"
      : "/library";
}
export function initialRoute(path: string): Route {
  const explicit = parseRoute(path);
  if (explicit) return explicit;
  if (path !== "/") return { view: "library" };
  if (
    readSetting(NAV_KEYS.always) === "true" ||
    readSetting(NAV_KEYS.seen) !== "true"
  )
    return { view: "welcome" };
  const last = parseRoute(readSetting(NAV_KEYS.last) ?? "");
  return last && last.view !== "welcome" ? last : { view: "library" };
}
function remember(route: Route) {
  if (route.view === "welcome") return;
  write(NAV_KEYS.seen, "true");
  write(
    NAV_KEYS.last,
    routePath(
      route.view === "performance" ? { ...route, view: "editor" } : route,
    ),
  );
  if (route.songId) write(NAV_KEYS.song, route.songId);
}
export function useNavigation() {
  const [route, setRoute] = useState(() =>
    initialRoute(window.location.pathname),
  );
  const [welcomeAtStartup, setAlways] = useState(
    () => readSetting(NAV_KEYS.always) === "true",
  );
  useEffect(() => {
    if (window.location.pathname !== routePath(route))
      window.history.replaceState(null, "", routePath(route));
    remember(route);
    const pop = () => {
      const next = initialRoute(window.location.pathname);
      remember(next);
      setRoute(next);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const navigate = useCallback((next: Route) => {
    const path = routePath(next);
    if (window.location.pathname !== path)
      window.history.pushState(null, "", path);
    remember(next);
    setRoute(next);
    document.documentElement.scrollTo?.({ top: 0, behavior: "instant" });
  }, []);
  const setWelcomeAtStartup = useCallback((value: boolean) => {
    write(NAV_KEYS.always, String(value));
    setAlways(value);
  }, []);
  return { route, navigate, welcomeAtStartup, setWelcomeAtStartup };
}
