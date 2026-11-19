// UI Catalog registry entries of the Surfaces tab. Page, card, header, panel, dialog and overlay.
// The tab's own agent edits this file only. Data only: no DOM and no CSS.
import { type CatalogEntry, NONE, planned, ref } from "./types";

/** The line under the tab's title. */
export const SURFACES_INTRO = `Containers and overlays. Nav rail, status bar and page header come first, for the app frame (${ref(11)}). Built in DS-07 (${ref(109)}).`;

export const SURFACES = [
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
] as const satisfies readonly CatalogEntry[];
