// UI Catalog registry entries of the Lists tab. Many items at once.
// The tab's own agent edits this file only. Data only: no DOM and no CSS.
import { type CatalogEntry, NONE, planned, ref } from "./types";

/** The line under the tab's title. */
export const LISTS_INTRO = `Many items at once. Built in DS-08 (${ref(110)}). Every list works by keyboard.`;

export const LISTS = [
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
] as const satisfies readonly CatalogEntry[];
