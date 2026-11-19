// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { CATALOG, CATALOG_TABS, isBuilt } from "../../ds/catalog";
import type { Theme } from "../../frame/theme";
import { renderCatalog } from "./catalog";

// The test runner hands style sheets to imports as empty text, so read the token file itself.
const tokensCss = readFileSync(
  resolve(import.meta.dirname, "../../ds/tokens.css"),
  "utf8",
);
// Independent of the registry: every custom property name in the token file.
const TOKENS = [
  ...new Set(
    [
      ...tokensCss
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(/(--[a-z0-9-]+)\s*:/g),
    ].map((m) => m[1]),
  ),
];

let screen: HTMLElement;
let teardown: (() => void) | null = null;
let frameTheme: Theme = "system";
const root = document.documentElement;

function stubMedia(reduce: boolean, dark = false) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({
      matches: /reduced-motion/.test(q)
        ? reduce
        : /color-scheme: dark/.test(q)
          ? dark
          : false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
}

function mount() {
  teardown = renderCatalog(screen, { getTheme: () => frameTheme });
}
const tabs = () => [
  ...screen.querySelectorAll<HTMLElement>('.cat-tabs [role="tab"]'),
];
const panelFor = (name: string) => {
  const tab = tabs().find((t) => t.textContent === name);
  return document.getElementById(tab?.getAttribute("aria-controls") ?? "");
};
const press = (el: HTMLElement, key: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
const buttonNamed = (text: string) =>
  [...screen.querySelectorAll("button")].find((b) => b.textContent === text);

beforeEach(() => {
  document.body.innerHTML = '<main id="screen"></main>';
  screen = document.getElementById("screen") as HTMLElement;
  root.removeAttribute("data-theme");
  root.removeAttribute("data-motion");
  frameTheme = "system";
  stubMedia(false);
});

afterEach(() => {
  teardown?.();
  teardown = null;
});

test("the Tokens panel names every token in the token file", () => {
  mount();
  const text = panelFor("Tokens")?.textContent ?? "";
  expect(TOKENS.length).toBeGreaterThan(20);
  expect(TOKENS.filter((n) => !text.includes(n))).toEqual([]);
});

test("a token with no computed value says so instead of a blank cell", () => {
  mount();
  const cells = [
    ...(panelFor("Tokens")?.querySelectorAll("table[data-tokens] tbody tr") ??
      []),
  ].map((row) => row.children[1]?.textContent ?? "");
  expect(cells.length).toBe(TOKENS.length);
  for (const c of cells) expect(c.length).toBeGreaterThan(0);
});

test("Foundations has a section for each foundation", () => {
  mount();
  const heads = [
    ...(panelFor("Foundations")?.querySelectorAll("h3") ?? []),
  ].map((h) => h.textContent);
  expect(heads).toEqual([
    "Type scale",
    "Colour roles",
    "Spacing",
    "Radius",
    "Shadow",
    "Focus ring",
    "Control border",
    "Icons",
    "Motion",
  ]);
});

test("each built part outside Foundations and Tokens shows a live example", () => {
  mount();
  for (const entry of CATALOG.filter(
    (e) => isBuilt(e) && e.tab !== "Foundations" && e.tab !== "Tokens",
  )) {
    const cls = "className" in entry ? entry.className : "";
    expect(
      panelFor(entry.tab)?.querySelector(`.${cls}`),
      entry.name,
    ).toBeTruthy();
  }
});

test("each panel shows how many of its parts are built", () => {
  mount();
  expect(panelFor("Foundations")?.textContent).toContain("9 of 9 parts in ds");
  expect(panelFor("Records")?.textContent).toMatch(/(\d+) of \1 parts in ds/);
});

test("the eight tabs follow the registry order, and arrows, Home and End move focus", () => {
  mount();
  const t = tabs();
  expect(t.map((x) => x.textContent)).toEqual([...CATALOG_TABS]);
  t[0].focus();
  press(t[0], "ArrowLeft");
  expect(document.activeElement).toBe(t[7]);
  expect(panelFor("Limits")?.hidden).toBe(false);
  expect(panelFor("Foundations")?.hidden).toBe(true);
  press(t[7], "Home");
  expect(document.activeElement).toBe(t[0]);
  press(t[0], "End");
  expect(t[7].getAttribute("aria-selected")).toBe("true");
  press(t[7], "ArrowRight");
  expect(t.filter((x) => x.tabIndex === 0)).toEqual([t[0]]);
  press(t[0], "a");
  expect(document.activeElement).toBe(t[0]);
});

test("Motion starts on, and off when the system asks for reduced motion", () => {
  mount();
  const sw = screen.querySelector<HTMLElement>('[role="switch"]');
  expect(sw?.getAttribute("aria-checked")).toBe("true");
  expect(sw?.textContent).toBe("MotionOn");
  sw?.click();
  expect(root.getAttribute("data-motion")).toBe("off");
  expect(sw?.textContent).toBe("MotionOff");
  teardown?.();
  stubMedia(true);
  mount();
  expect(root.getAttribute("data-motion")).toBe("off");
});

test("the theme buttons start on the theme on screen and switch it without saving", () => {
  stubMedia(false, true);
  mount();
  expect(buttonNamed("Dark")?.getAttribute("aria-pressed")).toBe("true");
  buttonNamed("Light")?.click();
  expect(root.getAttribute("data-theme")).toBe("light");
  expect(root.style.colorScheme).toBe("light");
  expect(localStorage.length).toBe(0);
});

test("teardown puts the frame theme back and clears data-motion", () => {
  frameTheme = "system";
  mount();
  buttonNamed("Dark")?.click();
  screen.querySelector<HTMLElement>('[role="switch"]')?.click();
  teardown?.();
  teardown = null;
  expect(root.hasAttribute("data-theme")).toBe(false);
  expect(root.hasAttribute("data-motion")).toBe(false);
});

test("after teardown the switches no longer act", () => {
  mount();
  const sw = screen.querySelector<HTMLElement>('[role="switch"]');
  teardown?.();
  teardown = null;
  sw?.click();
  expect(root.hasAttribute("data-motion")).toBe(false);
});
