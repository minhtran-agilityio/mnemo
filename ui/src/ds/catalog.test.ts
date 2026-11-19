import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import {
  CATALOG,
  CATALOG_TABS,
  coverage,
  entriesFor,
  TOKEN_GROUPS,
  tokenNames,
  tokensOfKind,
} from "./catalog";

// The test runner hands style sheets to imports as empty text, so read the real files.
const read = (name: string) =>
  readFileSync(resolve(import.meta.dirname, name), "utf8");
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

test("a planned entry, when there is one, names its issue; none is required", () => {
  for (const tab of CATALOG_TABS) {
    for (const e of entriesFor(tab)) {
      if (e.source.startsWith("planned"))
        expect(e.source).toMatch(/^planned #\d+$/);
    }
  }
});

test("the Controls tab has a built link part", () => {
  const link = entriesFor("Controls").find((e) => e.name === "link");
  expect(link?.source).toBe("ds");
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
  expect(coverage("Limits").built).toBe(entriesFor("Limits").length);
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
