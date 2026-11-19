// UI Catalog registry entries of the Controls tab. Buttons, fields and ways to choose.
// The tab's own agent edits this file only. Data only: no DOM and no CSS.
import { type CatalogEntry, NONE, planned, ref } from "./types";

/** The line under the tab's title. */
export const CONTROLS_INTRO = `Buttons, text fields and ways to choose. Built in DS-05 (${ref(107)}). Hover, focus and pressed are shown as fixed states; the live ones react too.`;

export const CONTROLS = [
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
] as const satisfies readonly CatalogEntry[];
