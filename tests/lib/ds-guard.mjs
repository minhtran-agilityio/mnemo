// Shared data of the design-system guards (#106 [DS-04]): which UI files the guards scan, the
// known exceptions, and the property and tag lists. This file is the only place that lists the
// exceptions. #111 deletes its entries as it moves code into ui/src/ds/; removing an entry never
// breaks a test, and an entry that no longer matches anything fails with "remove this exception".
//
// Guards that read this file:
//   css      tests/ds-screen-css.test.mjs       CSS outside ui/src/ds/ holds layout only, with token values.
//   elements tests/ds-screen-elements.test.mjs  Code outside ui/src/ds/ creates no button, input, select,
//                                               textarea or dialog; it calls the builders from ui/src/ds.
// Not a test file: the `tests/*.test.mjs` glob of npm test does not match tests/lib/.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const toPosix = (p) => p.split(sep).join("/");

const walk = (d) =>
  !existsSync(d)
    ? []
    : readdirSync(d).flatMap((n) => {
        const f = join(d, n);
        return statSync(f).isDirectory() ? walk(f) : [f];
      });

/**
 * The UI files the guards scan: every UI file in ui/ outside ui/src/ds/ and ui/public/, without
 * tests. That is ui/src/**\/*.{css,ts} and ui/*.html. `kind` is "css", "ts" or "html".
 * Returns repo-relative paths with forward slashes, sorted.
 */
export function scopeFiles(kind) {
  const src = walk(join(ROOT, "ui", "src"))
    .map((f) => toPosix(relative(ROOT, f)))
    .filter((f) => !f.startsWith("ui/src/ds/"))
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".d.ts"));
  const html = readdirSync(join(ROOT, "ui"))
    .filter((n) => n.endsWith(".html"))
    .map((n) => `ui/${n}`);
  return [...src, ...html].filter((f) => f.endsWith(`.${kind}`)).sort();
}

export const readRepo = (path) => readFileSync(join(ROOT, path), "utf8");

/**
 * Code that shipped before the pick-only rule. Each entry names the guards it switches off
 * (`guards`), only those it really needs: every (entry, guard) pair must hide at least one
 * violation, or its guard test fails with "remove this exception". An entry with `guards: []`
 * passes both guards today and stays listed because the owner listed it; #111 removes it too.
 */
export const KNOWN_EXCEPTIONS = [
  {
    path: "ui/src/frame/",
    guards: ["css", "elements"],
    removedBy: 111,
    reason:
      "The app frame (sidebar, empty state, theme) shipped before the design system. sidebar.css holds its own look and sidebar.ts creates raw buttons and the search input.",
  },
  {
    path: "ui/src/screens/settings/",
    guards: ["css", "elements"],
    removedBy: 111,
    reason:
      "The Settings screen shipped before the design system. settings.css holds its own look and settings.ts creates raw buttons and inputs.",
  },
  {
    path: "ui/src/screens/kanban/",
    guards: ["css"],
    removedBy: 111,
    reason:
      "The kanban screen shipped before the design system and kanban.css holds its own look. It creates no form element, so the elements guard already holds it.",
  },
  {
    path: "ui/src/style.css",
    guards: ["css"],
    removedBy: 111,
    reason:
      "The old page style sheet of the frame, the screens and the error page. It holds colour, font and border rules.",
  },
  {
    path: "ui/error.html",
    guards: [],
    removedBy: 111,
    reason:
      "The error page. Listed by the owner; it passes both guards today because its look comes from ui/src/style.css.",
  },
  {
    path: "ui/src/error-page.ts",
    guards: [],
    removedBy: 111,
    reason:
      "The error page script. Listed by the owner; it passes both guards today (it only sets text).",
  },
];

/**
 * Permanent exceptions for dev tools. They are not tied to #111.
 * The UI Catalog is held to the css guard (its CSS is layout and motion only) and to the
 * raw-colour test, but not to the elements guard.
 */
export const DEV_TOOL_EXCEPTIONS = [
  {
    path: "ui/src/screens/catalog/",
    guards: ["elements"],
    removedBy: null,
    reason:
      "The UI Catalog is a dev tool: it is not in the release bundle (ds-03 AC5). Its raw dialog, buttons and inputs are the tool's own chrome (Find a part, Inspect, the specimen hotspots, the Limits range), not product UI; every part it shows comes from ui/src/ds/.",
  },
];

const ALL_EXCEPTIONS = [...KNOWN_EXCEPTIONS, ...DEV_TOOL_EXCEPTIONS];

const covers = (entry, path) =>
  entry.path.endsWith("/") ? path.startsWith(entry.path) : path === entry.path;

/** The exception entry that switches `guard` off for `path`, or undefined. */
export function exceptionFor(path, guard) {
  return ALL_EXCEPTIONS.find((e) => e.guards.includes(guard) && covers(e, path));
}

/** True when `guard` ("css" or "elements") does not apply to `path` (repo-relative). */
export function isExcepted(path, guard) {
  return exceptionFor(path, guard) !== undefined;
}

/** Every exception entry that switches `guard` off. */
export function exceptionsFor(guard) {
  return ALL_EXCEPTIONS.filter((e) => e.guards.includes(guard));
}

/** Exception paths that no longer exist. Each one must be removed from this file. */
export function missingExceptionPaths() {
  return ALL_EXCEPTIONS.map((e) => e.path).filter((p) => !existsSync(join(ROOT, p)));
}

/**
 * The exception entries of `guard` that hide no violation. `violationsByFile` maps a
 * repo-relative path to its violations, for every file in scope, excepted ones included.
 */
export function unusedExceptions(guard, violationsByFile) {
  return exceptionsFor(guard).filter(
    (e) => ![...violationsByFile].some(([file, v]) => covers(e, file) && v.length > 0),
  );
}

/** Properties CSS outside ui/src/ds/ may set: where a part goes, never how it looks. */
export const LAYOUT_PROPERTIES = [
  "display",
  "position",
  "inset",
  "inset-block",
  "inset-block-start",
  "inset-block-end",
  "inset-inline",
  "inset-inline-start",
  "inset-inline-end",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "float",
  "clear",
  "box-sizing",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "inline-size",
  "block-size",
  "min-inline-size",
  "max-inline-size",
  "min-block-size",
  "max-block-size",
  "aspect-ratio",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-block-start",
  "margin-block-end",
  "margin-inline",
  "margin-inline-start",
  "margin-inline-end",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-block",
  "padding-block-start",
  "padding-block-end",
  "padding-inline",
  "padding-inline-start",
  "padding-inline-end",
  "gap",
  "row-gap",
  "column-gap",
  "grid",
  "grid-area",
  "grid-auto-columns",
  "grid-auto-flow",
  "grid-auto-rows",
  "grid-column",
  "grid-column-start",
  "grid-column-end",
  "grid-row",
  "grid-row-start",
  "grid-row-end",
  "grid-template",
  "grid-template-areas",
  "grid-template-columns",
  "grid-template-rows",
  "flex",
  "flex-basis",
  "flex-direction",
  "flex-flow",
  "flex-grow",
  "flex-shrink",
  "flex-wrap",
  "order",
  "align-content",
  "align-items",
  "align-self",
  "justify-content",
  "justify-items",
  "justify-self",
  "place-content",
  "place-items",
  "place-self",
  "overflow",
  "overflow-x",
  "overflow-y",
  "overflow-block",
  "overflow-inline",
  "visibility",
  "contain",
  "isolation",
  "object-fit",
  "object-position",
  "white-space",
  "text-overflow",
  "word-break",
  "overflow-wrap",
];

/** Motion properties: allowed outside ui/src/ds/ only to switch motion off (value `none`). */
export const MOTION_PROPERTIES = ["transition", "animation"];

/** Elements only ui/src/ds/ creates. Code outside it calls the builders from ui/src/ds. */
export const FORM_TAGS = ["button", "input", "select", "textarea", "dialog"];

/** The fix every guard message ends with. */
export const FIX =
  "use a part from ui/src/ds, or file a UI component request (DESIGN.md section 8)";
