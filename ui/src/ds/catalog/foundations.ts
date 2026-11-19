// UI Catalog registry entries of the Foundations tab. The tokens and the icon helper (ui/src/ds/tokens.css and index.ts).
// The tab's own agent edits this file only. Data only: no DOM and no CSS.
import { type CatalogEntry, NONE } from "./types";

/** The line under the tab's title. */
export const FOUNDATIONS_INTRO =
  "Type, colour, spacing, radius, shadow, focus ring, icons and motion. All values come from tokens.css.";

export const FOUNDATIONS = [
  {
    name: "type",
    label: "Type scale",
    tab: "Foundations",
    variants: ["body font", "mono font", "sizes", "weights"],
    states: NONE,
    source: "ds",
    notes: "Source Sans 3 for text, JetBrains Mono for code and data.",
  },
  {
    name: "colour",
    label: "Colour roles",
    tab: "Foundations",
    variants: [
      "surface and text",
      "accent and state",
      "tints",
      "connector brands",
    ],
    states: NONE,
    source: "ds",
    notes:
      "Surfaces, text and state. The full list with values is on the Tokens tab.",
  },
  {
    name: "spacing",
    tab: "Foundations",
    variants: ["space-1 to space-6"],
    states: NONE,
    source: "ds",
    notes: "Six steps. Gap between siblings, never one-off margins.",
  },
  {
    name: "radius",
    tab: "Foundations",
    variants: ["sm", "md", "lg", "pill"],
    states: NONE,
    source: "ds",
    notes: "Not interactive, so no states apply.",
  },
  {
    name: "shadow",
    tab: "Foundations",
    variants: ["sh1", "sh2"],
    states: NONE,
    source: "ds",
    notes: "sh1 for resting cards, sh2 for overlays only.",
  },
  {
    name: "focus ring",
    tab: "Foundations",
    variants: ["accent outline"],
    states: ["focus-visible"],
    source: "ds",
    notes: "3 px accent outline, 2 px offset. Never removed.",
  },
  {
    name: "control border",
    tab: "Foundations",
    variants: ["line", "control-edge"],
    states: NONE,
    source: "ds",
    notes: "A field needs a 3:1 edge to be found, so fields use control-edge.",
  },
  {
    name: "icons",
    tab: "Foundations",
    variants: ["sm", "md"],
    states: NONE,
    source: "ds",
    notes:
      "Lucide icons drawn by createIcon. Decorative, so hidden from screen readers.",
  },
  {
    name: "motion",
    tab: "Foundations",
    variants: ["dur-fast", "dur-base", "dur-slow", "ease"],
    states: ["on", "off"],
    source: "ds",
    notes: "The Motion switch and prefers-reduced-motion stop the sample.",
  },
] as const satisfies readonly CatalogEntry[];
