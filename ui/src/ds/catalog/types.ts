// Shared types and helpers of the UI Catalog registry. Data only: no DOM and no CSS.
// The registry is ui/src/ds/catalog.ts; each tab keeps its entries in its own file in this folder.

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
  /** The part's name, lowercase: "button", "list row". The screen matches code to it. */
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
  /** The heading of the row, when it is not the name with a capital ("Type scale"). */
  readonly label?: string;
}

export const NONE: readonly string[] = [];

/**
 * The source tag of a part asked for in issue `issue`. Built from the number so the source has
 * no "#" followed by digits, which the raw-colour check would read as a hex colour.
 */
export function planned<N extends number>(issue: N): `planned #${N}` {
  return `planned #${issue}`;
}

/** An issue reference as text ("#107"). Built from the number so no source line has a "#" followed
 * by digits, which the raw-colour check would read as a hex colour. */
export function ref(issue: number): string {
  return `#${issue}`;
}
