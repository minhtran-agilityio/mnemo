// UI Catalog registry entries of the Tokens tab. The rows come from tokens.css, not from this list.
// The tab's own agent edits this file only. Data only: no DOM and no CSS.
import type { CatalogEntry } from "./types";

/** The line under the tab's title. */
export const TOKENS_INTRO =
  'Every token in tokens.css with its value in the current theme. Switch Light or Dark to see the other set. Contrast ratios are computed here and stay "Unverified" until the test runs.';

export const TOKENS = [
  {
    name: "tokens",
    tab: "Tokens",
    variants: ["every token in tokens.css"],
    states: ["current theme"],
    source: "ds",
    notes:
      "Values are for the current theme. Use the Light or Dark switch to see the other.",
  },
] as const satisfies readonly CatalogEntry[];
