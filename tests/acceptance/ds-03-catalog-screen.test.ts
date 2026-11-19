// @vitest-environment happy-dom
// Acceptance tests for #105: the registry (ui/src/ds/catalog.ts) and the screen (ui/src/screens/catalog/catalog.ts).
// Run: npx vitest run tests/acceptance/ds-03-catalog-screen.test.ts
// Uses only the public interface: CATALOG, CATALOG_TABS, entriesFor, tokenNames, renderCatalog.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const ROOT = resolve(__dirname, "..", "..");
const TABS = ["Foundations", "Controls", "Feedback", "Surfaces", "Records", "Lists", "Tokens", "Limits"];
const tokensCss = readFileSync(resolve(ROOT, "ui/src/ds/tokens.css"), "utf8");
// Independent of the app's own parser: strip comments, collect every custom property name.
const TOKEN_NAMES = [
  ...new Set(
    [...tokensCss.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  ),
];

// Variable paths keep Vite from failing the whole file when a module does not exist yet.
const REGISTRY_PATH = resolve(ROOT, "ui/src/ds/catalog.ts");
const SCREEN_PATH = resolve(ROOT, "ui/src/screens/catalog/catalog.ts");
const loadRegistry = (): Promise<any> => import(/* @vite-ignore */ REGISTRY_PATH);
const loadScreen = (): Promise<any> => import(/* @vite-ignore */ SCREEN_PATH);

type Teardown = () => void;
let screen: HTMLElement;
let teardown: Teardown | null = null;
let theme: "system" | "light" | "dark" = "light";

function setReduce(matches: boolean) {
  (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
    matches: /reduced-motion/.test(q) ? matches : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  });
}

async function mount() {
  const { renderCatalog } = await loadScreen();
  teardown = renderCatalog(screen, { getTheme: () => theme });
  return screen;
}
const tabs = () => [...screen.querySelectorAll<HTMLElement>('[role="tab"]')];
const tab = (name: string) => {
  const t = tabs().find((x) => x.textContent?.trim().startsWith(name));
  if (!t) throw new Error(`no tab ${name}`);
  return t;
};
const panelOf = (t: HTMLElement) => {
  const id = t.getAttribute("aria-controls") ?? "";
  const el = document.getElementById(id);
  if (!el) throw new Error(`no panel for ${t.textContent}`);
  return el;
};
const open = (name: string) => {
  const t = tab(name);
  t.click();
  return panelOf(t);
};
const key = (el: HTMLElement, k: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const byText = (sel: string, text: string) =>
  [...screen.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.trim() === text);

beforeEach(() => {
  document.body.innerHTML = '<div id="screen"></div>';
  screen = document.getElementById("screen") as HTMLElement;
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-motion");
  localStorage.clear();
  theme = "light";
  setReduce(false);
});
afterEach(() => {
  teardown?.();
  teardown = null;
});

// ------------------------------------------------------------ AC1 registry
test("AC1: the tab list is exactly the eight names in order", async () => {
  const { CATALOG_TABS } = await loadRegistry();
  expect([...CATALOG_TABS]).toEqual(TABS);
});

test("AC1: every entry has name, tab, variants, states and a valid source tag", async () => {
  const { CATALOG, CATALOG_TABS } = await loadRegistry();
  expect(CATALOG.length).toBeGreaterThan(0);
  for (const e of CATALOG) {
    expect(typeof e.name).toBe("string");
    expect(e.name.length).toBeGreaterThan(0);
    expect(CATALOG_TABS).toContain(e.tab);
    expect(Array.isArray(e.variants)).toBe(true);
    expect(Array.isArray(e.states)).toBe(true);
    expect(e.source).toMatch(/^(ds|base\.css|planned #\d+)$/);
  }
});

test("AC1: entriesFor(tab) returns exactly the entries of that tab", async () => {
  const { CATALOG, CATALOG_TABS, entriesFor } = await loadRegistry();
  for (const t of CATALOG_TABS) expect(entriesFor(t)).toEqual(CATALOG.filter((e) => e.tab === t));
});

// ------------------------------------------------------------ AC2 base.css entries and planned entries
test("AC2: button, input, pill, card and list row are registry entries that are built (base.css or ds)", async () => {
  const { CATALOG } = await loadRegistry();
  for (const n of ["button", "input", "pill", "card", "list row"]) {
    const e = CATALOG.find((x) => x.name.toLowerCase() === n);
    expect(e, `no entry named ${n}`).toBeTruthy();
    expect(["base.css", "ds"]).toContain(e?.source);
  }
});

test("AC2: Controls, Feedback, Surfaces, Records, Lists and Limits each have entries, and every planned entry names an issue", async () => {
  const { CATALOG, entriesFor } = await loadRegistry();
  for (const t of ["Controls", "Feedback", "Surfaces", "Records", "Lists", "Limits"]) {
    expect(entriesFor(t as never).length, `${t} has no entry`).toBeGreaterThan(0);
  }
  for (const e of CATALOG.filter((x) => x.source.startsWith("planned"))) {
    expect(e.source, e.name).toMatch(/^planned #\d+$/);
  }
});

test("AC2: the screen draws the base classes and shows each entry's source tag in its tab", async () => {
  const { CATALOG } = await loadRegistry();
  await mount();
  const classOf: Array<[string, string]> = [
    ["Controls", ".btn"],
    ["Controls", ".input"],
    ["Feedback", ".pill"],
    ["Surfaces", ".card"],
    ["Lists", ".row"],
  ];
  for (const [t, sel] of classOf) {
    expect(open(t).querySelector(sel), `${t} panel has no ${sel}`).toBeTruthy();
  }
  for (const e of CATALOG) {
    expect(open(e.tab).textContent, `${e.name} tag`).toContain(e.source);
  }
});

test("AC2: every registry entry name is shown in its tab", async () => {
  const { CATALOG } = await loadRegistry();
  await mount();
  for (const e of CATALOG) {
    const panel = open(e.tab);
    expect(panel.textContent?.toLowerCase(), `${e.name} missing in ${e.tab}`).toContain(e.name.toLowerCase());
  }
});

// ------------------------------------------------------------ AC3 screen
test("AC3: the screen shows the title UI Catalog and eight tabs", async () => {
  await mount();
  expect(screen.textContent).toContain("UI Catalog");
  expect(tabs().map((t) => t.textContent?.trim().replace(/\s.*$/, ""))).toEqual(TABS);
});

// ------------------------------------------------------------ AC4 tokens and foundations
test("AC4: tokens.css declares tokens (the check below is not empty)", () => {
  expect(TOKEN_NAMES.length).toBeGreaterThan(20);
});

test("AC4: every token name in tokens.css is shown in the Tokens tab", async () => {
  await mount();
  const panel = open("Tokens");
  const text = panel.textContent ?? "";
  const missing = TOKEN_NAMES.filter((n) => !text.includes(n));
  expect(missing, `tokens missing from the Tokens tab: ${missing.join(", ")}`).toEqual([]);
});

test("AC4: the Tokens tab is a table with Name, Value and Sample column headers", async () => {
  await mount();
  const panel = open("Tokens");
  const heads = [...panel.querySelectorAll('th[scope="col"]')].map((h) => h.textContent?.trim());
  expect(heads).toEqual(expect.arrayContaining(["Name", "Value", "Sample"]));
});

test("AC4: tokenNames de-duplicates repeated names and ignores comments", async () => {
  // The design exports tokenNames from catalog.ts; accept it from the screen module or the registry.
  const [reg, scr] = await Promise.all([loadRegistry(), loadScreen()]);
  const tokenNames: (css: string) => string[] = scr.tokenNames ?? reg.tokenNames;
  expect(typeof tokenNames).toBe("function");
  const out = tokenNames("/* --ghost: 1; */ :root { --a: 1; --b: 2; } :root[data-theme=dark] { --a: 3; }");
  expect(out).toEqual(["--a", "--b"]);
  expect(tokenNames(tokensCss)).toEqual(TOKEN_NAMES);
});

test("AC4: Foundations shows type, colour, spacing, radius, shadow and icons", async () => {
  await mount();
  const panel = open("Foundations");
  const heads = [...panel.querySelectorAll("h2,h3,h4")].map((h) => h.textContent?.toLowerCase() ?? "").join("|");
  for (const w of ["type", "colour", "spacing", "radius", "shadow", "icons"])
    expect(heads, `no ${w} section in Foundations`).toContain(w);
});

// ------------------------------------------------------------ AC6 switches
test("AC6: Light and Dark set data-theme on the root, show state with aria-pressed, and save nothing", async () => {
  await mount();
  const dark = byText("button", "Dark");
  const light = byText("button", "Light");
  expect(dark && light).toBeTruthy();
  dark?.click();
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(dark?.getAttribute("aria-pressed")).toBe("true");
  expect(light?.getAttribute("aria-pressed")).toBe("false");
  light?.click();
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(light?.getAttribute("aria-pressed")).toBe("true");
  expect(localStorage.length).toBe(0);
});

test("AC6: the Motion switch sets and clears data-motion=off and flips aria-checked", async () => {
  await mount();
  const sw = screen.querySelector<HTMLElement>('[role="switch"]');
  expect(sw?.textContent).toContain("Motion");
  expect(sw?.getAttribute("aria-checked")).toBe("true");
  expect(document.documentElement.getAttribute("data-motion")).not.toBe("off");
  sw?.click();
  expect(sw?.getAttribute("aria-checked")).toBe("false");
  expect(document.documentElement.getAttribute("data-motion")).toBe("off");
  sw?.click();
  expect(sw?.getAttribute("aria-checked")).toBe("true");
  expect(document.documentElement.hasAttribute("data-motion")).toBe(false);
});

test("AC6: prefers-reduced-motion starts the Motion switch off", async () => {
  setReduce(true);
  await mount();
  const sw = screen.querySelector<HTMLElement>('[role="switch"]');
  expect(sw?.getAttribute("aria-checked")).toBe("false");
  expect(document.documentElement.getAttribute("data-motion")).toBe("off");
});

test("AC6: teardown clears data-motion and puts the frame theme back", async () => {
  theme = "light";
  await mount();
  byText("button", "Dark")?.click();
  screen.querySelector<HTMLElement>('[role="switch"]')?.click();
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(document.documentElement.getAttribute("data-motion")).toBe("off");
  teardown?.();
  teardown = null;
  expect(document.documentElement.hasAttribute("data-motion")).toBe(false);
  expect(document.documentElement.getAttribute("data-theme")).not.toBe("dark");
});

// ------------------------------------------------------------ AC7 keyboard and roles
test("AC7: the tabs sit in a labelled tablist, each tab controls a tabpanel that it labels", async () => {
  await mount();
  const list = screen.querySelector('[role="tablist"]');
  expect(list?.getAttribute("aria-label")).toBeTruthy();
  expect(tabs()).toHaveLength(8);
  for (const t of tabs()) {
    const panel = panelOf(t);
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(t.id);
    expect(t.id).toBeTruthy();
  }
});

test("AC7: exactly one tab is selected and tabbable (roving tabindex)", async () => {
  await mount();
  const sel = tabs().filter((t) => t.getAttribute("aria-selected") === "true");
  expect(sel).toHaveLength(1);
  expect(tabs().filter((t) => t.getAttribute("tabindex") === "0")).toEqual(sel);
  for (const t of tabs().filter((x) => !sel.includes(x))) expect(t.getAttribute("tabindex")).toBe("-1");
  expect(tabs()[0]).toBe(sel[0]);
});

test("AC7: arrow keys, Home and End move selection and focus, and the arrows wrap", async () => {
  await mount();
  const t = tabs();
  t[0].focus();
  const at = (i: number) => {
    expect(t[i].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(t[i]);
    expect(t.filter((x) => x.getAttribute("tabindex") === "0")).toEqual([t[i]]);
  };
  key(t[0], "ArrowRight");
  at(1);
  key(t[1], "ArrowLeft");
  at(0);
  key(t[0], "ArrowLeft");
  at(7);
  key(t[7], "ArrowRight");
  at(0);
  key(t[0], "End");
  at(7);
  key(t[7], "Home");
  at(0);
});

test("AC7: only the selected panel is shown and it can take focus", async () => {
  await mount();
  const panel = open("Controls");
  expect(panel.getAttribute("tabindex")).toBe("0");
  const others = tabs().filter((x) => x !== tab("Controls")).map(panelOf);
  for (const o of others) expect(o.hidden || o.getAttribute("hidden") !== null || o.style.display === "none").toBe(true);
});

test("AC7: the screen sets no raw colour inline", async () => {
  await mount();
  for (const t of tabs()) panelOf(t);
  const inline = [...screen.querySelectorAll("[style]")].map((e) => e.getAttribute("style") ?? "").join(";");
  expect(inline).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
});

// ------------------------------------------------------------ AC9
test("AC9: the screen never uses the banned old name of the showcase screen", async () => {
  await mount();
  for (const t of tabs()) open(t.textContent?.trim().replace(/\s.*$/, "") ?? "");
  expect(screen.textContent?.toLowerCase()).not.toMatch(new RegExp(["kitchen", "\\s*", "sink"].join("")));
});
