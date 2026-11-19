// The design decisions the owner approved with the UI Catalog prototype, shown in the collapsible
// list at the top of the screen. Text between ‹ and › is shown as code.

import { ref } from "../../ds/catalog/types";

export const DECISIONS: readonly string[] = [
  "Primary buttons are 44 px tall (‹--control-height-primary›). Other controls stay at 40 px; in-row small buttons at 32 px.",
  "Text fields, chips and tag inputs get a 3:1 edge, ‹--control-edge›: one neutral from the existing grey family. Cards and dividers keep ‹--line›.",
  "Danger buttons use ‹--on-bad› for their text. Dialogs dim the page with ‹--scrim›.",
  "Each pill tint sets its own text colour as well as its background.",
  `Three source tags: ‹ds›, ‹base.css› (exists today, moves in ${ref(105)}) and ‹planned #N›.`,
  "Sidebar: the shipped sizes, 260 px open and 72 px collapsed. It collapses only when the owner clicks, and the saved ‹sidebar_collapsed› choice always wins. It never folds by itself.",
  `Smallest window: 800 × 560 px, set as minWidth and minHeight in tauri.conf.json (${ref(113)}). The open sidebar still leaves 540 px for the page. The start size stays 900 × 640.`,
  'Theme selectors stay as shipped (‹:root[data-theme]›). The "Both themes" switch is a tool of this prototype only.',
  "The sidebar has no counts or badges, as the owner chose in APP-02.",
  "Records shows one item in each shape. Lists shows many items at once.",
  `Icons: Lucide (ISC licence) for ${ref(104)}; the strokes here are stand-ins and the licence check is Unverified. Fonts load from Google Fonts here only; the app bundles them (${ref(104)}).`,
];

export const DECISIONS_SUMMARY = `${DECISIONS.length} design decisions, aligned with main 9af7e75`;
