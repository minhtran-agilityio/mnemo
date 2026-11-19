// Guard (c) of DS-04: every component exported from ui/src/ds has a registry entry and a test.
// It sits outside ui/src/ds/ on purpose: a change to it is not a change to the design system.
// It reads the real CATALOG object (ui/src/ds/catalog.ts), not the registry text.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { CATALOG } from "./ds/catalog";

const DS = resolve(import.meta.dirname, "ds");
const COMPONENTS = join(DS, "components");

/**
 * Folders whose name is not the name of their registry entry (hyphens read as spaces, case
 * ignored). Each folder lists every built entry it draws. A new component is named like its
 * entry, or the ui-designer agent adds it here. Every alias must point at a built entry.
 */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  "ai-light": ["AI status light"],
  check: ["checkbox", "radio"],
  chip: ["filter chip"],
  column: ["page"],
  field: ["input"],
  "heading-bar": ["page header"],
  kbd: ["shortcut hint"],
  "state-box": ["empty state", "error state", "AI-off state"],
};

/**
 * Built entries that have no states and no notes line yet. DESIGN.md section 5 wants each state
 * shown, or one line saying why none applies. Listed here so the gap is visible; the check fails
 * once an entry gains states or notes and is still listed, so this list only shrinks.
 */
const KNOWN_STATE_GAPS: readonly string[] = ["shortcut hint"];

/** Modules outside components/ that a barrel of ui/src/ds exports, with their entry names. */
const EXTRA_MODULES: Readonly<Record<string, readonly string[]>> = {
  icon: ["icons"],
};

interface GuardEntry {
  readonly name: string;
  readonly source: string;
  readonly states: readonly string[];
  readonly notes?: string;
}

interface GuardInput {
  /** Folder names in ui/src/ds/components/ that hold `<name>.ts`. */
  readonly folders: readonly string[];
  /** Test file names that exist, as `<folder>/<folder>.test.ts`. */
  readonly testFiles: readonly string[];
  readonly entries: readonly GuardEntry[];
  readonly aliases: Readonly<Record<string, readonly string[]>>;
  /** Each barrel file name and the folders its `export * from "./<x>/<x>"` lines point at. */
  readonly barrels: Readonly<Record<string, readonly string[]>>;
  readonly stateGaps?: readonly string[];
}

const norm = (s: string) => s.replace(/-/g, " ").toLowerCase();

/** Every gap between the component folders, their tests, the barrels and the registry. */
// biome-ignore lint/suspicious/noExportsInTest: the DS-04 acceptance test checks that the pure check is exported
export function findGaps(input: GuardInput): string[] {
  const { folders, testFiles, entries, aliases, barrels } = input;
  const stateGaps = input.stateGaps ?? [];
  const gaps: string[] = [];
  const built = entries.filter((e) => e.source === "ds");
  const byName = new Map(built.map((e) => [norm(e.name), e]));
  const matched = new Set<GuardEntry>();

  for (const folder of folders) {
    if (!testFiles.includes(`${folder}/${folder}.test.ts`))
      gaps.push(`${folder}: no ${folder}/${folder}.test.ts`);
    const names = aliases[folder] ?? [folder];
    const found = names.map((n) => byName.get(norm(n)));
    if (found.every((e) => e === undefined))
      gaps.push(
        `${folder}: no registry entry with source "ds" (name it like the folder, or add an alias in ui/src/ds-guard.test.ts)`,
      );
    for (const e of found) if (e) matched.add(e);
  }

  for (const [folder, names] of Object.entries(aliases)) {
    if (!folders.includes(folder))
      gaps.push(`alias ${folder}: no such component folder`);
    for (const n of names)
      if (!byName.has(norm(n)))
        gaps.push(`alias ${folder}: "${n}" is not a built registry entry`);
  }

  const seen = new Map<string, string[]>();
  for (const [barrel, targets] of Object.entries(barrels))
    for (const t of targets) {
      if (!folders.includes(t))
        gaps.push(`${barrel}: exports ./${t}/${t}, which is not a folder`);
      seen.set(t, [...(seen.get(t) ?? []), barrel]);
    }
  for (const folder of folders) {
    const where = seen.get(folder) ?? [];
    if (where.length !== 1)
      gaps.push(
        `${folder}: exported from ${where.length} barrels (${where.join(", ") || "none"}); it needs exactly one`,
      );
  }

  for (const e of matched) {
    const hasStates = e.states.length > 0 || (e.notes ?? "").trim() !== "";
    const listed = stateGaps.includes(e.name);
    if (!hasStates && !listed)
      gaps.push(
        `${e.name}: no states and no notes line saying why none applies (DESIGN.md section 5)`,
      );
    if (hasStates && listed)
      gaps.push(
        `${e.name}: has states or notes now; remove it from KNOWN_STATE_GAPS`,
      );
  }
  for (const n of stateGaps)
    if (![...matched].some((e) => e.name === n))
      gaps.push(`${n}: in KNOWN_STATE_GAPS but not a component entry`);

  return gaps;
}

function realInput(): GuardInput {
  const folders = readdirSync(COMPONENTS)
    .filter((n) => statSync(join(COMPONENTS, n)).isDirectory())
    .filter((n) => existsSync(join(COMPONENTS, n, `${n}.ts`)))
    .sort();
  const testFiles = folders
    .map((f) => `${f}/${f}.test.ts`)
    .filter((t) => existsSync(join(COMPONENTS, t)));
  const barrels: Record<string, string[]> = {};
  for (const name of readdirSync(COMPONENTS).filter((n) => n.endsWith(".ts"))) {
    const text = readFileSync(join(COMPONENTS, name), "utf8");
    const lines = [
      ...text.matchAll(/^export \* from "\.\/([\w-]+)\/([\w-]+)";/gm),
    ];
    if (lines.length === 0) continue;
    barrels[name] = lines.map((m) =>
      m[1] === m[2] ? m[1] : `${m[1]}/${m[2]}`,
    );
  }
  return {
    folders,
    testFiles,
    entries: CATALOG,
    aliases: ALIASES,
    barrels,
    stateGaps: KNOWN_STATE_GAPS,
  };
}

test("every component folder in ui/src/ds has a test, a registry entry and one barrel", () => {
  const input = realInput();
  expect(input.folders.length).toBeGreaterThan(40);
  expect(Object.keys(input.barrels).sort()).toEqual([
    "controls.ts",
    "feedback.ts",
    "lists.ts",
    "records.ts",
    "surfaces.ts",
  ]);
  expect(findGaps(input)).toEqual([]);
});

test("the barrels are the only exports of ui/src/ds/index.ts, besides the icon helper", () => {
  const index = readFileSync(join(DS, "index.ts"), "utf8");
  const exported = [
    ...index.matchAll(/^export .* from "\.\/([\w/-]+)";/gm),
  ].map((m) => m[1]);
  expect(exported.sort()).toEqual([
    "components/controls",
    "components/feedback",
    "components/lists",
    "components/records",
    "components/surfaces",
    ...Object.keys(EXTRA_MODULES),
  ]);
  for (const [module, names] of Object.entries(EXTRA_MODULES)) {
    expect(existsSync(join(DS, `${module}.test.ts`))).toBe(true);
    for (const n of names)
      expect(CATALOG.some((e) => e.name === n && e.source === "ds")).toBe(true);
  }
});

const clean: GuardInput = {
  folders: ["toast", "check"],
  testFiles: ["toast/toast.test.ts", "check/check.test.ts"],
  entries: [
    { name: "toast", source: "ds", states: ["success"] },
    { name: "checkbox", source: "ds", states: ["on"] },
  ],
  aliases: { check: ["checkbox"] },
  barrels: { "feedback.ts": ["toast"], "controls.ts": ["check"] },
};

test("self-test: a clean sample has no gaps", () => {
  expect(findGaps(clean)).toEqual([]);
});

test("self-test: a folder with no registry entry is reported", () => {
  const gaps = findGaps({
    ...clean,
    folders: [...clean.folders, "chart"],
    testFiles: [...clean.testFiles, "chart/chart.test.ts"],
    barrels: { ...clean.barrels, "lists.ts": ["chart"] },
  });
  expect(gaps.join("\n")).toMatch(/chart: no registry entry/);
});

test("self-test: a folder with no test file is reported", () => {
  const gaps = findGaps({ ...clean, testFiles: ["check/check.test.ts"] });
  expect(gaps.join("\n")).toMatch(/toast: no toast\/toast\.test\.ts/);
});

test("self-test: a stale alias is reported", () => {
  const gaps = findGaps({
    ...clean,
    aliases: { check: ["checkbox", "radio"], gone: ["x"] },
  });
  expect(gaps.join("\n")).toMatch(/"radio" is not a built registry entry/);
  expect(gaps.join("\n")).toMatch(/alias gone: no such component folder/);
});

test("self-test: a folder in no barrel, or in two, is reported", () => {
  expect(
    findGaps({ ...clean, barrels: { "controls.ts": ["check"] } }).join("\n"),
  ).toMatch(/toast: exported from 0 barrels/);
  expect(
    findGaps({
      ...clean,
      barrels: { ...clean.barrels, "lists.ts": ["toast"] },
    }).join("\n"),
  ).toMatch(/toast: exported from 2 barrels/);
});

test("self-test: an entry with no states and no notes is reported, and a stale state gap too", () => {
  const bare = {
    ...clean,
    entries: [
      { name: "toast", source: "ds", states: [] },
      { name: "checkbox", source: "ds", states: ["on"] },
    ],
  };
  expect(findGaps(bare).join("\n")).toMatch(/toast: no states and no notes/);
  expect(findGaps({ ...bare, stateGaps: ["toast"] })).toEqual([]);
  expect(findGaps({ ...clean, stateGaps: ["toast"] }).join("\n")).toMatch(
    /remove it from KNOWN_STATE_GAPS/,
  );
});
