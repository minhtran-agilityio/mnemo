// UI Catalog registry entries of the Records tab. One item in each shape.
// The tab's own agent edits this file only. Data only: no DOM and no CSS.
import { type CatalogEntry, NONE, planned, ref } from "./types";

/** The line under the tab's title. */
export const RECORDS_INTRO = `One saved item, in each shape it takes. Built in DS-08 (${ref(110)}). A page Mnemo could not read keeps the link only.`;

export const RECORDS = [
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
] as const satisfies readonly CatalogEntry[];
