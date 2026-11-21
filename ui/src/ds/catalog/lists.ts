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
    variants: ["default", "drag", "no move (button cards)"],
    states: ["default", "empty", "drop over", "open now", "overflow"],
    source: "ds",
    className: "kcol",
    notes: `Focus a card, then Alt+← / Alt+→ to move it. The drag option adds pointer drag and the plain ← / →. "Doing" shows the drop-target state. The option move: false (${ref(129)}) is the no-move board for the Ideas screen: no drag, no Alt+Arrow, no Arrow move; its button cards open an idea.`,
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
    variants: ["folders", "nested labels", "with label actions"],
    states: [
      "collapsed",
      "expanded",
      "current",
      "hover",
      "focus",
      "active",
      "empty",
      "menu open",
      "renaming",
      "error",
      "disabled with reason",
      "overflow",
    ],
    source: "ds",
    className: "tree",
    notes: `Folders and nested labels. With actions (${ref(126)}) each node has a menu: New label inside, Rename (F2), Move to, Delete (Delete key); Shift+F10 or the context menu key opens it. Rename and create are a field in the row: Enter saves, Escape cancels, an empty or duplicate name is refused at the field. The tree reports the node and the action; the screen does the work. The tree only reports: after a save it changes nothing it shows (name, menu names, ids), and the screen re-renders the tree from its own data on success and on failure. The duplicate check runs against the labels the tree was given. The screen may refuse a rename or create by returning a message from onAction: the field stays open with the message and the typed name. A handler that throws shows "Could not save. Try again." at the field (under the node for Move and Delete, and for a rejected async handler; refuse synchronously, a resolved value is ignored). A typed name is not lost to a stray click or the window losing focus: only an empty or unchanged field closes on leaving. Escape, or any other tree action, cancels it. Loading, success, partial and AI off do not apply: the screen shows a skeleton or a toast.`,
  },
  {
    name: "section list",
    tab: "Lists",
    variants: ["default"],
    states: ["default", "hover", "focus-visible", "current", "long value"],
    source: "ds",
    className: "section-list",
    notes: `Rows of a name and its current value; one row is current. A long value is cut with an ellipsis and its full text is the title. Narrow windows put the rows side by side (${ref(111)}).`,
  },
] as const satisfies readonly CatalogEntry[];
