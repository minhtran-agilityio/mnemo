// UI Catalog registry entries of the Lists tab. Many items at once.
// The tab's own agent edits this file only. Data only: no DOM and no CSS.
import { type CatalogEntry, ref } from "./types";

/** The line under the tab's title. */
export const LISTS_INTRO = `Many items at once. Built in DS-08 (${ref(110)}). Every list works by keyboard.`;

export const LISTS = [
  {
    name: "list row",
    tab: "Lists",
    variants: ["title and meta", "with second line"],
    states: ["default", "hover", "selected", "focus", "overflow"],
    source: "ds",
    className: "row",
    notes:
      "Arrow keys move, Enter selects. A long title is cut off with an ellipsis and the full text is in its tooltip.",
  },
  {
    name: "list",
    tab: "Lists",
    variants: ["list", "listbox"],
    states: ["default"],
    source: "ds",
    className: "list",
    notes: "A bordered box of rows. The listbox adds the arrow keys.",
  },
  {
    name: "kanban column",
    tab: "Lists",
    variants: ["default"],
    states: ["default", "empty", "drop over"],
    source: "ds",
    className: "kcol",
    notes:
      'Focus a card, then Alt+← / Alt+→ to move it. "Doing" shows the drop-target state.',
  },
  {
    name: "table",
    tab: "Lists",
    variants: ["sortable"],
    states: ["unsorted", "ascending", "descending", "hover"],
    source: "ds",
    className: "tblwrap",
    notes: "Sortable headers. Scrolls sideways inside its own box.",
  },
  {
    name: "tree",
    tab: "Lists",
    variants: ["folders", "nested labels"],
    states: ["collapsed", "expanded", "current", "hover"],
    source: "ds",
    className: "tree",
    notes: "Folders and nested labels.",
  },
] as const satisfies readonly CatalogEntry[];
