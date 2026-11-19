// UI Catalog registry entries of the Limits tab. Messy content and small windows.
// The tab's own agent edits this file only. Data only: no DOM and no CSS.
import { type CatalogEntry, NONE, planned, ref } from "./types";

/** The line under the tab's title. */
export const LIMITS_INTRO = `Hard content and small windows. Filled in DS-09 (${ref(113)}). Each case shows how a part bends before a real screen depends on it.`;

export const LIMITS = [
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
