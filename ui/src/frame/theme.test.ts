// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, vi } from "vitest";
import {
  applyTheme,
  cacheTheme,
  loadSavedTheme,
  parseTheme,
  readCachedTheme,
  readTheme,
  THEME_LABELS,
  THEMES,
  ThemeReadTimeoutError,
} from "./theme";

test("a missing or unknown saved value means System", () => {
  for (const value of [null, undefined, "", "purple", "DARK", " dark", "beige"])
    expect(parseTheme(value)).toBe("system");
});

test("the three known values are read as they are", () => {
  expect(parseTheme("system")).toBe("system");
  expect(parseTheme("light")).toBe("light");
  expect(parseTheme("dark")).toBe("dark");
  expect(THEMES.map((theme) => THEME_LABELS[theme])).toEqual([
    "System",
    "Light",
    "Dark",
  ]);
});

test("Light and Dark set the attribute and the color-scheme", () => {
  const root = document.documentElement;
  applyTheme(root, "dark");
  expect(root.getAttribute("data-theme")).toBe("dark");
  expect(root.style.colorScheme).toBe("dark");
  applyTheme(root, "light");
  expect(root.getAttribute("data-theme")).toBe("light");
  expect(root.style.colorScheme).toBe("light");
});

test("System removes the attribute and the color-scheme so the OS decides", () => {
  const root = document.documentElement;
  applyTheme(root, "dark");
  applyTheme(root, "system");
  expect(root.hasAttribute("data-theme")).toBe(false);
  expect(root.style.colorScheme).toBe("");
});

/** The custom properties set inside the first rule whose header contains `header`. */
function declarations(css: string, header: string): string[] {
  const start = css.indexOf(header);
  expect(start, `${header} is missing in tokens.css`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return [...css.slice(open, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
    (m) => `${m[1]}: ${m[2]?.trim()}`,
  );
}

test("the dark palette is the same for the attribute and for the OS rule", () => {
  const css = readFileSync(
    resolve(process.cwd(), "ui/src/tokens.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const byAttribute = declarations(css, ':root[data-theme="dark"]');
  const bySystem = declarations(css, ':root:not([data-theme="light"])');
  expect(byAttribute.length).toBeGreaterThan(20);
  expect(bySystem).toEqual(byAttribute);
  expect(css).toContain("prefers-color-scheme: dark");
  expect(css).toContain(':root[data-theme="light"]');
});

test("a saved theme is read as it is", async () => {
  const onError = vi.fn();
  expect(await readTheme(async () => "dark", onError)).toBe("dark");
  expect(await readTheme(async () => null, onError)).toBe("system");
  expect(onError).not.toHaveBeenCalled();
});

test("a failed read gives System and reports the error", async () => {
  const onError = vi.fn();
  const failure = { code: "storage", message: "nope" };
  expect(await readTheme(() => Promise.reject(failure), onError)).toBe(
    "system",
  );
  expect(onError).toHaveBeenCalledWith(failure);
});

test("a read that never finishes gives System after the limit", async () => {
  const onError = vi.fn();
  const theme = await readTheme(
    () => new Promise<string | null>(() => {}),
    onError,
    5,
  );
  expect(theme).toBe("system");
  expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(ThemeReadTimeoutError);
});

test("the cached theme is read at once, so the first paint needs no wait for the store", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
  expect(readCachedTheme(storage)).toBe("system");
  cacheTheme(storage, "dark");
  expect(readCachedTheme(storage)).toBe("dark");
});

test("blocked storage gives System and never throws", () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  expect(readCachedTheme(blocked)).toBe("system");
  expect(() => cacheTheme(blocked, "dark")).not.toThrow();
});

test("a failed read shows System but keeps a good cached theme", async () => {
  const root = document.createElement("html");
  const store = new Map<string, string>([["mnemo.theme", "dark"]]);
  const storage = { setItem: (k: string, v: string) => void store.set(k, v) };
  const errors: unknown[] = [];
  const theme = await loadSavedTheme(
    root,
    storage,
    () => Promise.reject(new Error("db busy")),
    (e) => errors.push(e),
  );
  expect(theme).toBe("system");
  expect(errors).toHaveLength(1);
  expect(store.get("mnemo.theme")).toBe("dark");
});

test("a good read is shown and cached", async () => {
  const root = document.createElement("html");
  const store = new Map<string, string>();
  const storage = { setItem: (k: string, v: string) => void store.set(k, v) };
  const theme = await loadSavedTheme(
    root,
    storage,
    () => Promise.resolve("light"),
    () => {},
  );
  expect(theme).toBe("light");
  expect(root.getAttribute("data-theme")).toBe("light");
  expect(store.get("mnemo.theme")).toBe("light");
});
