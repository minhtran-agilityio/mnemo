// UI Catalog registry entries of the Limits tab. Messy content and small windows.
// Data only: no DOM and no CSS.
import { type CatalogEntry, NONE, ref } from "./types";

/** The line under the tab's title. */
export const LIMITS_INTRO = `Hard content and small windows, built from the real parts. Each case shows how a part bends before a real screen depends on it. The app's own smallest window is set in ${ref(113)}.`;

export const LIMITS = [
  {
    name: "narrow width, 200%",
    tab: "Limits",
    variants: ["800 by 560", "sidebar collapsed", "zoom 200%"],
    states: ["overflow"],
    source: "ds",
    className: "lim-preview",
    notes:
      "Smallest window: 800 by 560 px. The sidebar stays as the owner left it at every width. Zoom 200% halves the room.",
  },
  {
    name: "very long title",
    tab: "Limits",
    variants: NONE,
    states: ["overflow"],
    source: "ds",
    className: "list",
    notes:
      "Rows cut the title off with a tooltip; cards wrap; the full value is one press away.",
  },
  {
    name: "messy urls",
    label: "Messy URLs",
    tab: "Limits",
    variants: NONE,
    states: ["overflow"],
    source: "ds",
    className: "lcard",
    notes: "Tracking junk, percent-encoding, IDN, no scheme.",
  },
  {
    name: "vietnamese, stacked marks",
    tab: "Limits",
    variants: NONE,
    states: ["overflow"],
    source: "ds",
    className: "list",
    notes:
      "Capitals with two marks need room above. A tight line height clips them.",
  },
  {
    name: "long values in parts",
    tab: "Limits",
    variants: NONE,
    states: ["overflow"],
    source: "ds",
    className: "tags",
    notes:
      "One very long unbroken value and Vietnamese capitals with stacked marks in each part that cuts a line: tag list, choice list, source list, section list, folder tree, sidebar, list row second line.",
  },
  {
    name: "empty content",
    tab: "Limits",
    variants: NONE,
    states: ["empty"],
    source: "ds",
    className: "lcard",
    notes: "No title, no source, zero counts.",
  },
  {
    name: "1000 rows",
    tab: "Limits",
    variants: NONE,
    states: ["overflow"],
    source: "ds",
    className: "list",
    notes:
      "Plain DOM, no virtual list. The time is for this browser, not the app.",
  },
  {
    name: "reduced motion",
    tab: "Limits",
    variants: NONE,
    states: NONE,
    source: "ds",
    className: "spinner",
    notes:
      "The Motion switch and the system setting both stop every animation on this page.",
  },
] as const satisfies readonly CatalogEntry[];
