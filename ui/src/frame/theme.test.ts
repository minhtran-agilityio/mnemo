// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { applyTheme, parseTheme, THEME_LABELS, THEMES } from "./theme";

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
