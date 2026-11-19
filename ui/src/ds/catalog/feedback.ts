// UI Catalog registry entries of the Feedback tab. Pills, banners, toasts, progress and the honest-failure lines.
// The tab's own agent edits this file only. Data only: no DOM and no CSS.
import { type CatalogEntry, NONE, planned, ref } from "./types";

/** The line under the tab's title. */
export const FEEDBACK_INTRO = `Status, amounts, messages and trust. Built in DS-06 (${ref(108)}). No state uses colour alone.`;

export const FEEDBACK = [
  {
    name: "pill",
    tab: "Feedback",
    variants: ["default", "info", "good", "warn", "note", "bad"],
    states: ["default"],
    source: "base.css",
    className: "pill",
    notes: "A label, not a control: it has no interactive states.",
  },
  {
    name: "banner",
    tab: "Feedback",
    variants: ["info", "warn", "bad"],
    states: NONE,
    source: planned(108),
  },
  {
    name: "toast",
    tab: "Feedback",
    variants: ["default"],
    states: NONE,
    source: planned(108),
  },
  {
    name: "progress",
    tab: "Feedback",
    variants: ["bar", "spinner"],
    states: NONE,
    source: planned(108),
  },
  {
    name: "empty line",
    tab: "Feedback",
    variants: ["default"],
    states: NONE,
    source: planned(108),
  },
  {
    name: "error line",
    tab: "Feedback",
    variants: ["default"],
    states: NONE,
    source: planned(108),
  },
  {
    name: "AI-off line",
    tab: "Feedback",
    variants: ["off", "at limit"],
    states: NONE,
    source: planned(108),
  },
  {
    name: "trust label",
    tab: "Feedback",
    variants: ["guess", "unverified"],
    states: NONE,
    source: planned(108),
  },
] as const satisfies readonly CatalogEntry[];
