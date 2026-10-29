import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import messages from "./messages";
import extrasMessages from "./extraMessages.ts";
import errorMessages, { errorCodeMessages } from "./errorMessages";

export type Locale = "ru" | "en";
export type Params = Readonly<
  Record<string, string | number | null | undefined>
>;
export type Translator = (key: string, params?: Params) => string;
export const LOCALE_STORAGE_KEY = "in-tune.locale";
// Extra messages are a flat { "Русский ключ": "English translation" } dictionary.
// Extras take precedence so the other UI work can extend the shared vocabulary.
const english: Readonly<Record<string, string>> = {
  ...messages,
  ...errorMessages,
  ...extrasMessages,
};
const intlLocales: Record<Locale, string> = { ru: "ru-RU", en: "en-US" };

export function translate(
  locale: Locale,
  key: string,
  params: Params = {},
): string {
  const template =
    locale === "en" ? (english[key] ?? translateError(locale, key)) : key;
  return template.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name] ?? "")
      : token,
  );
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.keys(english)
  .filter((key) => /\{\w+\}/.test(key))
  .map((key) => {
    const names: string[] = [];
    const parts = key.split(/(\{\w+\})/g).map((part) => {
      if (!/^\{\w+\}$/.test(part)) return escapeRegExp(part);
      names.push(part.slice(1, -1));
      return "([\\s\\S]*?)";
    });
    return { key, names, pattern: new RegExp("^" + parts.join("") + "$") };
  });
const prefixes = Object.keys(english)
  .filter((key) => !key.includes("{"))
  .sort((a, b) => b.length - a.length);

/** Translate known UI/backend messages only. Unknown diagnostics and paths survive verbatim. */
export function translateError(locale: Locale, error: unknown): string {
  const value = error instanceof Error ? error.message : String(error ?? "");
  if (locale === "ru" || !value) return value;
  if (english[value] !== undefined) return translate(locale, value);
  for (const { key, names, pattern } of patterns) {
    const match = pattern.exec(value);
    if (match)
      return translate(
        locale,
        key,
        Object.fromEntries(
          names.map((name, i) => [
            name,
            key === "Строка {line}: {message}" && name === "message"
              ? translateError(locale, match[i + 1])
              : match[i + 1],
          ]),
        ),
      );
  }
  for (const prefix of prefixes) {
    if (
      value.startsWith(prefix) &&
      value.length > prefix.length &&
      (/[.:]\s*$/.test(prefix) ||
        /^(?:\. |: |\n)/.test(value.slice(prefix.length)))
    ) {
      const rest = value.slice(prefix.length);
      const separator = /^(?:\. |: |\s+)/.exec(rest)?.[0] ?? "";
      return (
        translate(locale, prefix) +
        separator +
        translateError(locale, rest.slice(separator.length))
      );
    }
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const heading = errorCodeMessages[error.code];
    if (heading) return translate(locale, heading) + (value ? " " + value : "");
  }
  return value;
}

export function readLocale(): Locale {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY) === "en" ? "en" : "ru";
  } catch {
    return "ru";
  }
}

function date(
  locale: Locale,
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(intlLocales[locale], options).format(parsed);
}
type I18n = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translator;
  error: (value: unknown) => string;
  formatDate: (
    value: string | number | Date,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
};
// Components also remain usable in isolated tests/previews without a provider.
const I18nContext = createContext<I18n>({
  locale: "ru",
  setLocale: () => {},
  t: (key, params) => translate("ru", key, params),
  error: (value) => translateError("ru", value),
  formatDate: (value, options) => date("ru", value, options),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(readLocale);
  const setLocale = useCallback((next: Locale) => {
    if (next === "ru" || next === "en") updateLocale(next);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* Storage may be disabled. */
    }
  }, [locale]);
  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      error: (input) => translateError(locale, input),
      formatDate: (input, options) => date(locale, input, options),
    }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
