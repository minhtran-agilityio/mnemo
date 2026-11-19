// The UI Catalog registry: every part of the design system, the tab it shows in, its variants,
// its states and where it comes from. A part that is not listed here does not exist.
// Data only: no DOM and no CSS. Only the dev-only UI Catalog screen imports this file, and
// ui/src/ds/index.ts never does, so the registry stays out of the release bundle.

/** The UI Catalog tabs, in the order DESIGN.md section 7 sets. */
export const CATALOG_TABS = [
  "Foundations",
  "Controls",
  "Feedback",
  "Surfaces",
  "Records",
  "Lists",
  "Tokens",
  "Limits",
] as const;

export type CatalogTab = (typeof CATALOG_TABS)[number];

/**
 * Where a part comes from: `ds` (built in ui/src/ds), `base.css` (a base style in the design
 * system's base style file) or `planned #N` (asked for in issue N, not built yet).
 */
export type CatalogSource = "ds" | "base.css" | `planned #${number}`;

export interface CatalogEntry {
  /** The part's name, lowercase: "button", "list row". */
  readonly name: string;
  readonly tab: CatalogTab;
  readonly variants: readonly string[];
  /** The states from DESIGN.md section 5 (and the interactive states) the entry shows. */
  readonly states: readonly string[];
  readonly source: CatalogSource;
  /** The base class of a base style entry, for example "btn". */
  readonly className?: string;
  /** One line, for example why a state does not apply. */
  readonly notes?: string;
}

const NONE: readonly string[] = [];

/**
 * The source tag of a part asked for in issue `issue`. Built from the number so the source has
 * no "#" followed by digits, which the raw-colour check would read as a hex colour.
 */
function planned<N extends number>(issue: N): `planned #${N}` {
  return `planned #${issue}`;
}

export const CATALOG = [
  // Foundations: the tokens and the icon helper (tokens.css and index.ts).
  {
    name: "type",
    tab: "Foundations",
    variants: ["body font", "mono font", "sizes", "weights"],
    states: NONE,
    source: "ds",
    notes: "Not interactive, so no states apply.",
  },
  {
    name: "colour",
    tab: "Foundations",
    variants: [
      "surface and text",
      "accent and state",
      "tints",
      "connector brands",
    ],
    states: NONE,
    source: "ds",
    notes: "Not interactive, so no states apply.",
  },
  {
    name: "spacing",
    tab: "Foundations",
    variants: ["space-1 to space-6"],
    states: NONE,
    source: "ds",
    notes: "Not interactive, so no states apply.",
  },
  {
    name: "radius",
    tab: "Foundations",
    variants: ["sm", "md", "lg", "pill"],
    states: NONE,
    source: "ds",
    notes: "Not interactive, so no states apply.",
  },
  {
    name: "shadow",
    tab: "Foundations",
    variants: ["sh1", "sh2"],
    states: NONE,
    source: "ds",
    notes: "Not interactive, so no states apply.",
  },
  {
    name: "motion",
    tab: "Foundations",
    variants: ["dur-fast", "dur-base", "dur-slow", "ease"],
    states: ["on", "off"],
    source: "ds",
    notes: "The Motion switch and prefers-reduced-motion stop the sample.",
  },
  {
    name: "icons",
    tab: "Foundations",
    variants: ["sm", "md"],
    states: NONE,
    source: "ds",
    notes:
      "Lucide icons drawn by createIcon. Decorative, so hidden from screen readers.",
  },

  // Controls
  {
    name: "button",
    tab: "Controls",
    variants: ["default", "primary", "ghost"],
    states: ["default", "hover", "active", "focus-visible", "disabled"],
    source: "base.css",
    className: "btn",
    notes: "Hover and active show live: point at or press a button.",
  },
  {
    name: "input",
    tab: "Controls",
    variants: ["with field label"],
    states: ["default", "hover", "focus-visible", "invalid", "disabled"],
    source: "base.css",
    className: "input",
    notes: "Invalid uses aria-invalid. Hover shows live.",
  },
  {
    name: "select",
    tab: "Controls",
    variants: ["default"],
    states: NONE,
    source: planned(107),
  },
  {
    name: "toggle",
    tab: "Controls",
    variants: ["default"],
    states: NONE,
    source: planned(107),
  },
  {
    name: "link",
    tab: "Controls",
    variants: ["inline", "standalone"],
    states: NONE,
    source: planned(107),
  },
  {
    name: "textarea",
    tab: "Controls",
    variants: ["default"],
    states: NONE,
    source: planned(107),
  },
  {
    name: "search",
    tab: "Controls",
    variants: ["default"],
    states: NONE,
    source: planned(107),
  },

  // Feedback
  {
    name: "pill",
    tab: "Feedback",
    variants: ["default", "info", "good", "warn", "note", "bad"],
    states: ["default"],
    source: "base.css",
    className: "pill",
    notes: "A label, not a control: it has no interactive states.",
  },
  {
    name: "banner",
    tab: "Feedback",
    variants: ["info", "warn", "bad"],
    states: NONE,
    source: planned(108),
  },
  {
    name: "toast",
    tab: "Feedback",
    variants: ["default"],
    states: NONE,
    source: planned(108),
  },
  {
    name: "progress",
    tab: "Feedback",
    variants: ["bar", "spinner"],
    states: NONE,
    source: planned(108),
  },
  {
    name: "empty line",
    tab: "Feedback",
    variants: ["default"],
    states: NONE,
    source: planned(108),
  },
  {
    name: "error line",
    tab: "Feedback",
    variants: ["default"],
    states: NONE,
    source: planned(108),
  },
  {
    name: "AI-off line",
    tab: "Feedback",
    variants: ["off", "at limit"],
    states: NONE,
    source: planned(108),
  },
  {
    name: "trust label",
    tab: "Feedback",
    variants: ["guess", "unverified"],
    states: NONE,
    source: planned(108),
  },

  // Surfaces
  {
    name: "card",
    tab: "Surfaces",
    variants: ["default"],
    states: ["default"],
    source: "base.css",
    className: "card",
    notes: "A container, not a control: it has no interactive states.",
  },
  {
    name: "page",
    tab: "Surfaces",
    variants: ["default"],
    states: ["default"],
    source: "base.css",
    className: "page",
    notes: "The reading column. A container, so no interactive states.",
  },
  {
    name: "nav rail",
    tab: "Surfaces",
    variants: ["open", "collapsed"],
    states: NONE,
    source: planned(109),
  },
  {
    name: "status bar",
    tab: "Surfaces",
    variants: ["default"],
    states: NONE,
    source: planned(109),
  },
  {
    name: "header",
    tab: "Surfaces",
    variants: ["default"],
    states: NONE,
    source: planned(109),
  },
  {
    name: "panel",
    tab: "Surfaces",
    variants: ["default"],
    states: NONE,
    source: planned(109),
  },
  {
    name: "dialog",
    tab: "Surfaces",
    variants: ["default", "confirm"],
    states: NONE,
    source: planned(109),
  },
  {
    name: "overlay",
    tab: "Surfaces",
    variants: ["default"],
    states: NONE,
    source: planned(109),
  },

  // Records: one item in each shape.
  {
    name: "link card",
    tab: "Records",
    variants: ["List", "Cards", "Compact"],
    states: NONE,
    source: planned(110),
  },
  {
    name: "note row",
    tab: "Records",
    variants: ["default"],
    states: NONE,
    source: planned(110),
  },
  {
    name: "task row",
    tab: "Records",
    variants: ["default"],
    states: NONE,
    source: planned(110),
  },
  {
    name: "kanban card",
    tab: "Records",
    variants: ["default"],
    states: NONE,
    source: planned(110),
  },
  {
    name: "citation",
    tab: "Records",
    variants: ["default"],
    states: NONE,
    source: planned(110),
  },
  {
    name: "tag list",
    tab: "Records",
    variants: ["default"],
    states: NONE,
    source: planned(110),
  },
  {
    name: "metadata line",
    tab: "Records",
    variants: ["default"],
    states: NONE,
    source: planned(110),
  },

  // Lists: many items at once.
  {
    name: "list row",
    tab: "Lists",
    variants: ["title and meta"],
    states: ["default", "hover", "overflow"],
    source: "base.css",
    className: "row",
    notes:
      "Overflow: a long title is cut off with an ellipsis. Hover shows live.",
  },
  {
    name: "kanban column",
    tab: "Lists",
    variants: ["default"],
    states: NONE,
    source: planned(110),
  },
  {
    name: "table",
    tab: "Lists",
    variants: ["default"],
    states: NONE,
    source: planned(110),
  },
  {
    name: "tree",
    tab: "Lists",
    variants: ["default"],
    states: NONE,
    source: planned(110),
  },

  // Tokens: the rows come from tokens.css, not from this list.
  {
    name: "tokens",
    tab: "Tokens",
    variants: ["every token in tokens.css"],
    states: ["current theme"],
    source: "ds",
    notes:
      "Values are for the current theme. Use the Light or Dark switch to see the other.",
  },

  // Limits
  {
    name: "long titles",
    tab: "Limits",
    variants: NONE,
    states: ["overflow"],
    source: planned(113),
  },
  {
    name: "long URLs",
    tab: "Limits",
    variants: NONE,
    states: ["overflow"],
    source: planned(113),
  },
  {
    name: "many items",
    tab: "Limits",
    variants: NONE,
    states: ["overflow"],
    source: planned(113),
  },
  {
    name: "smallest window",
    tab: "Limits",
    variants: ["800 by 560"],
    states: NONE,
    source: planned(113),
  },
] as const satisfies readonly CatalogEntry[];

type Entry = (typeof CATALOG)[number];

/**
 * The built entries outside Foundations and Tokens. The screen keeps one renderer for each in a
 * typed map, so a part that turns from `planned #N` into `ds` without a renderer is a type error.
 */
export type BuiltEntryName = Exclude<
  Extract<Entry, { source: "ds" | "base.css" }>,
  { tab: "Foundations" | "Tokens" }
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
    names: ["--ease", "--dur-fast", "--dur-base", "--dur-slow"],
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
    names: ["--icon-sm", "--icon-md", "--border-1", "--border-2"],
  },
  {
    group: "Sidebar",
    kind: "size",
    names: ["--sidebar-width", "--sidebar-width-collapsed"],
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
