// The UI Catalog registry: every part of the design system, the tab it shows in, its variants,
// its states and where it comes from. A part that is not listed here does not exist.
// Data only: no DOM and no CSS. Only the dev-only UI Catalog screen imports this file, and
// ui/src/ds/index.ts never does, so the registry stays out of the release bundle.
//
// The entries live in one file per tab in ui/src/ds/catalog/. This file puts them together in tab
// order and holds the helpers and the token groups. A tab's agent edits its own entry file only.

import { CONTROLS, CONTROLS_INTRO } from "./catalog/controls";
import { FEEDBACK, FEEDBACK_INTRO } from "./catalog/feedback";
import { FOUNDATIONS, FOUNDATIONS_INTRO } from "./catalog/foundations";
import { LIMITS, LIMITS_INTRO } from "./catalog/limits";
import { LISTS, LISTS_INTRO } from "./catalog/lists";
import { RECORDS, RECORDS_INTRO } from "./catalog/records";
import { SURFACES, SURFACES_INTRO } from "./catalog/surfaces";
import { TOKENS, TOKENS_INTRO } from "./catalog/tokens";
import {
  CATALOG_TABS,
  type CatalogEntry,
  type CatalogSource,
  type CatalogTab,
} from "./catalog/types";

export type { CatalogEntry, CatalogSource, CatalogTab };
export { CATALOG_TABS };

/** Every entry, in the order of the tabs. */
export const CATALOG = [
  ...FOUNDATIONS,
  ...CONTROLS,
  ...FEEDBACK,
  ...SURFACES,
  ...RECORDS,
  ...LISTS,
  ...TOKENS,
  ...LIMITS,
] as const satisfies readonly CatalogEntry[];

/** The line under the title of each tab. */
export const TAB_INTRO: Readonly<Record<CatalogTab, string>> = {
  Foundations: FOUNDATIONS_INTRO,
  Controls: CONTROLS_INTRO,
  Feedback: FEEDBACK_INTRO,
  Surfaces: SURFACES_INTRO,
  Records: RECORDS_INTRO,
  Lists: LISTS_INTRO,
  Tokens: TOKENS_INTRO,
  Limits: LIMITS_INTRO,
};

type Entry = (typeof CATALOG)[number];

/**
 * The names of the built entries of one tab (all tabs when none is given). A tab's screen file
 * keeps one renderer for each in a typed map, so a part that turns from `planned #N` into `ds`
 * without a renderer is a type error.
 */
export type BuiltEntryName<T extends CatalogTab = CatalogTab> = Extract<
  Entry,
  { source: "ds" | "base.css"; tab: T }
>["name"];

/** The entries of one tab, in registry order. */
export function entriesFor(tab: CatalogTab): CatalogEntry[] {
  return CATALOG.filter((entry: CatalogEntry) => entry.tab === tab);
}

/** True when the part is built (in the design system now), false when it is only planned. */
export function isBuilt(entry: CatalogEntry): boolean {
  return entry.source === "ds" || entry.source === "base.css";
}

/** How many parts of a tab are built, out of all its parts. */
export function coverage(tab: CatalogTab): { built: number; total: number } {
  const entries = entriesFor(tab);
  return {
    built: entries.filter(isBuilt).length,
    total: entries.length,
  };
}

/** How many entries come from each source, for the coverage bar: ds, base.css and planned. */
export function sourceCounts(tab?: CatalogTab): {
  ds: number;
  base: number;
  plan: number;
} {
  const entries = tab ? entriesFor(tab) : [...CATALOG];
  return {
    ds: entries.filter((e) => e.source === "ds").length,
    base: entries.filter((e) => e.source === "base.css").length,
    plan: entries.filter((e) => !isBuilt(e)).length,
  };
}

/**
 * Every custom property name declared in a style sheet, in first-seen order, each once.
 * Comments are ignored. The dark and fallback blocks of tokens.css repeat names, so they add none.
 */
export function tokenNames(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const names = [...clean.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  return [...new Set(names)];
}

/** What a token holds, so the screen knows how to draw its sample. */
export type TokenKind =
  | "colour"
  | "font"
  | "size"
  | "space"
  | "radius"
  | "shadow"
  | "motion"
  | "other";

export interface TokenGroup {
  readonly group: string;
  readonly kind: TokenKind;
  readonly names: readonly string[];
}

/**
 * Every token in ui/src/ds/tokens.css, in the groups of DESIGN.md section 3.
 * The test runner hands style sheets to code as empty text, so the screen cannot parse the token
 * file there; this list is the screen's source instead. ui/src/ds/catalog.test.ts compares it
 * with tokenNames() of the real file, so a token added to the file and not here fails the tests.
 */
export const TOKEN_GROUPS: readonly TokenGroup[] = [
  {
    group: "Surface and text",
    kind: "colour",
    names: [
      "--paper",
      "--card",
      "--head",
      "--ink",
      "--ink2",
      "--muted",
      "--line",
      "--edge",
      "--dotc",
      "--player",
    ],
  },
  {
    group: "Accent and state",
    kind: "colour",
    names: [
      "--accent",
      "--accent-hover",
      "--on-accent",
      "--accent-soft",
      "--chip-ink",
      "--warn-soft",
      "--warn-ink",
      "--bad",
      "--bad-soft",
      "--guess-ink",
      "--good",
      "--good-soft",
      "--hl",
      "--on-bad",
      "--control-edge",
    ],
  },
  {
    group: "Tints",
    kind: "colour",
    names: [
      "--tint-info",
      "--tint-note",
      "--tint-warn",
      "--tint-good",
      "--tint-bad",
      "--tint-neutral",
    ],
  },
  {
    group: "Connector brands",
    kind: "colour",
    names: [
      "--app-telegram",
      "--app-zalo",
      "--app-slack",
      "--app-gmail",
      "--app-gcal",
      "--app-github",
      "--app-gdrive",
      "--app-bot",
      "--app-tok",
      "--app-ink",
    ],
  },
  {
    group: "Shadow and backdrop colours",
    kind: "colour",
    names: ["--shadow", "--sh2-near", "--sh2-far", "--scrim"],
  },
  { group: "Shadow", kind: "shadow", names: ["--sh1", "--sh2"] },
  {
    group: "Motion",
    kind: "motion",
    names: ["--ease", "--dur-fast", "--dur-base", "--dur-slow", "--dur-nav"],
  },
  {
    group: "Type",
    kind: "font",
    names: [
      "--font-body",
      "--font-mono",
      "--text-xs",
      "--text-sm",
      "--text-md",
      "--text-lg",
      "--text-base",
      "--text-xl",
      "--text-2xl",
      "--weight-regular",
      "--weight-semibold",
      "--weight-bold",
      "--leading-body",
    ],
  },
  {
    group: "Spacing",
    kind: "space",
    names: [
      "--space-1",
      "--space-2",
      "--space-3",
      "--space-4",
      "--space-5",
      "--space-6",
    ],
  },
  {
    group: "Radius",
    kind: "radius",
    names: ["--radius-sm", "--radius-md", "--radius-lg", "--radius-pill"],
  },
  {
    group: "Control",
    kind: "size",
    names: ["--control-height", "--control-height-primary", "--focus-ring"],
  },
  {
    group: "Icons and borders",
    kind: "size",
    names: [
      "--icon-sm",
      "--icon-md",
      "--icon-nav",
      "--icon-stroke-nav",
      "--border-1",
      "--border-2",
    ],
  },
  {
    group: "Sidebar",
    kind: "size",
    names: ["--sidebar-width", "--sidebar-width-collapsed"],
  },
  {
    group: "App frame",
    kind: "size",
    names: ["--size-frame-height", "--size-section-list-max"],
  },
  {
    group: "Catalog sizes",
    kind: "size",
    names: [
      "--size-page-max",
      "--size-label-min",
      "--size-label-max",
      "--size-label-duo-min",
      "--size-label-duo-max",
      "--size-basis-example",
      "--size-basis-banner",
      "--size-basis-column",
      "--size-basis-decisions",
      "--size-basis-tabs",
      "--size-basis-setting",
      "--size-decisions-max",
      "--size-cov-bar",
      "--measure-intro",
      "--measure-sub",
      "--measure-answer",
      "--size-tap-min",
      "--size-tap-sm",
      "--size-row-menu",
      "--size-row-compact",
      "--size-tag-input",
      "--size-field-max",
      "--size-textarea-min",
      "--size-tags-max",
      "--size-label-picker-max",
      "--size-tag-input-min",
      "--size-menu-min",
      "--size-menu-max",
      "--size-toggle-width",
      "--size-toggle-height",
      "--size-toggle-knob",
      "--size-toggle-travel",
      "--size-kbd-min",
      "--size-cite",
      "--size-icon-lg",
      "--size-swatch",
      "--size-dot",
      "--size-dot-sm",
      "--size-meter-max",
      "--size-meter-height",
      "--size-meter-tick-overhang",
      "--size-progress-max",
      "--size-progress-height",
      "--size-skeleton-width",
      "--size-skeleton-line",
      "--size-toast-max",
      "--size-state-max",
      "--size-dialog-width",
      "--size-dialog-static-max",
      "--size-kcard-width",
      "--size-column-max",
      "--size-table-min",
      "--size-tree-max",
      "--leading-chip-sm",
      "--leading-chip",
      "--leading-tag",
      "--leading-label",
      "--size-mini-height",
      "--size-list-height",
      "--size-range",
      "--size-specimen-width",
      "--size-specimen-height",
      "--size-titlebar",
      "--size-specimen-meter",
      "--size-inspect-width",
      "--size-inspect-swatch",
      "--size-palette-width",
      "--size-palette-list-max",
      "--size-typecap",
      "--size-spacebar",
      "--size-space-label",
      "--size-radbox-width",
      "--size-radbox-height",
      "--size-shbox-width",
      "--size-shbox-height",
      "--size-swatch-role-width",
      "--size-icon-cell",
      "--size-token-bar-max",
      "--tracking-caption",
      "--tracking-caps",
    ],
  },
  {
    group: "Layers",
    kind: "other",
    names: ["--z-sticky", "--z-popover", "--z-toast"],
  },
];

/** The tokens of one kind, in group order. */
export function tokensOfKind(kind: TokenKind): string[] {
  return TOKEN_GROUPS.filter((g) => g.kind === kind).flatMap((g) => [
    ...g.names,
  ]);
}
