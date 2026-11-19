import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import {
  CATALOG,
  CATALOG_TABS,
  type CatalogTab,
  coverage,
  entriesFor,
  TOKEN_GROUPS,
  tokenNames,
  tokensOfKind,
} from "./catalog";

// The test runner hands style sheets to imports as empty text, so read the real files.
const read = (name: string) =>
  readFileSync(resolve(import.meta.dirname, name), "utf8");
const baseCss = read("base.css");
const tokensCss = read("tokens.css");

test("the tabs are the eight names in order", () => {
  expect([...CATALOG_TABS]).toEqual([
    "Foundations",
    "Controls",
    "Feedback",
    "Surfaces",
    "Records",
    "Lists",
    "Tokens",
    "Limits",
  ]);
});

test("every entry has a name, a known tab, variants, states and a valid source tag", () => {
  for (const entry of CATALOG) {
    expect(entry.name.length).toBeGreaterThan(0);
    expect(CATALOG_TABS).toContain(entry.tab);
    expect(Array.isArray(entry.variants)).toBe(true);
    expect(Array.isArray(entry.states)).toBe(true);
    expect(entry.source).toMatch(/^(ds|base\.css|planned #\d+)$/);
  }
});

test("entry names are unique", () => {
  const names = CATALOG.map((e) => e.name.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
});

test("the base styles are entries tagged base.css and their classes exist in the base style file", () => {
  for (const name of ["button", "input", "pill", "card"]) {
    const entry = CATALOG.find((e) => e.name === name);
    expect(entry?.source, name).toBe("base.css");
  }
  for (const entry of CATALOG.filter((e) => e.source === "base.css")) {
    const cls = "className" in entry ? entry.className : undefined;
    expect(cls, `${entry.name} has no className`).toBeTruthy();
    expect(baseCss).toMatch(new RegExp(`\\.${cls}\\b`));
  }
});

test("each tab after Foundations, except Tokens, has a planned entry with an issue number", () => {
  const want: Record<string, string> = {
    Controls: `planned #${107}`,
    Feedback: `planned #${108}`,
    Surfaces: `planned #${109}`,
    Limits: `planned #${113}`,
  };
  for (const [tab, tag] of Object.entries(want)) {
    expect(entriesFor(tab as CatalogTab).map((e) => e.source)).toContain(tag);
  }
});

test("Foundations lists type, colour, spacing, radius, shadow, focus ring, control border, icons and motion, built in ds", () => {
  const found = entriesFor("Foundations");
  expect(found.map((e) => e.name)).toEqual([
    "type",
    "colour",
    "spacing",
    "radius",
    "shadow",
    "focus ring",
    "control border",
    "icons",
    "motion",
  ]);
  for (const e of found) expect(e.source).toBe("ds");
});

test("entriesFor returns only that tab's entries, in registry order", () => {
  for (const tab of CATALOG_TABS) {
    expect(entriesFor(tab)).toEqual(CATALOG.filter((e) => e.tab === tab));
  }
});

test("coverage counts built entries against all entries of a tab", () => {
  expect(coverage("Foundations")).toEqual({ built: 9, total: 9 });
  const controls = entriesFor("Controls");
  expect(coverage("Controls")).toEqual({
    built: controls.filter((e) => !e.source.startsWith("planned")).length,
    total: controls.length,
  });
  expect(coverage("Records").built).toBe(entriesFor("Records").length);
  expect(coverage("Lists").built).toBe(entriesFor("Lists").length);
});

test("tokenNames lists each name once, in first-seen order, and ignores comments", () => {
  const css =
    "/* --ghost: 1; */ :root { --a: 1; --scrim: var(--a); --scrim: var(--b); } :root[x] { --a: 2; }";
  expect(tokenNames(css)).toEqual(["--a", "--scrim"]);
});

test("the token groups hold every token of the token file exactly once", () => {
  const listed = TOKEN_GROUPS.flatMap((g) => [...g.names]);
  const inFile = tokenNames(tokensCss);
  expect(inFile.length).toBeGreaterThan(20);
  expect(new Set(listed).size).toBe(listed.length);
  const missing = inFile.filter((n) => !listed.includes(n));
  const extra = listed.filter((n) => !inFile.includes(n));
  expect(missing, "tokens in the token file but not in TOKEN_GROUPS").toEqual(
    [],
  );
  expect(extra, "tokens in TOKEN_GROUPS but not in the token file").toEqual([]);
});

test("tokensOfKind picks the right tokens for the Foundations samples", () => {
  expect(tokensOfKind("shadow")).toEqual(["--sh1", "--sh2"]);
  expect(tokensOfKind("space")).toEqual(
    tokenNames(tokensCss).filter((n) => n.startsWith("--space-")),
  );
  expect(tokensOfKind("radius")).toEqual(
    tokenNames(tokensCss).filter((n) => n.startsWith("--radius-")),
  );
  const colours = tokensOfKind("colour");
  for (const n of [
    "--paper",
    "--tint-info",
    "--app-ink",
    "--sh2-near",
    "--scrim",
  ])
    expect(colours).toContain(n);
  for (const n of ["--sh1", "--space-1", "--ease"])
    expect(colours).not.toContain(n);
});
