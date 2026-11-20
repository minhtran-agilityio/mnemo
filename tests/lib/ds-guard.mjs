// Shared data of the design-system guards (#106 [DS-04]): which UI files the guards scan, the
// known exceptions, and the property and tag lists. This file is the only place that lists the
// exceptions. #111 deletes its entries as it moves code into ui/src/ds/; removing an entry never
// breaks a test, and an entry that no longer matches anything fails with "remove this exception".
//
// This file is guard configuration: a pull request that changes it needs the label design-system
// (scripts/ds-write-guard.mjs), and tests/guard-exceptions-pinned.test.mjs fails when an exception
// is added (removing one is fine).
//
// Guards that read this file:
//   css      tests/ds-screen-css.test.mjs       CSS outside ui/src/ds/ holds layout only, with token values.
//                                               It also reads inline styles: style.x = ..., style.setProperty,
//                                               style.cssText, setAttribute("style") in .ts, and <style> blocks
//                                               and style="" attributes in ui/*.html.
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

/** Every non-test .ts file of ui/src/ds/, repo-relative. The elements guard reads its tag helpers. */
export function dsSourceFiles() {
  return walk(join(ROOT, "ui", "src", "ds"))
    .map((f) => toPosix(relative(ROOT, f)))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
    .sort();
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
];

/**
 * Permanent exceptions for dev tools. They are not tied to #111, and each names one file, never a
 * folder: a new file in ui/src/screens/catalog/ is held to both guards. The UI Catalog is a dev
 * tool, not in the release bundle (ds-03 AC5). Its own chrome is not product UI, and every part
 * it shows comes from ui/src/ds/. The css guard covers inline styles too.
 */
const CATALOG = "ui/src/screens/catalog/";
export const DEV_TOOL_EXCEPTIONS = [
  {
    path: `${CATALOG}catalog.ts`,
    guards: ["elements"],
    removedBy: null,
    reason: "The switches of the tab bar are raw role=switch buttons of the tool's own chrome.",
  },
  {
    path: `${CATALOG}find.ts`,
    guards: ["elements"],
    removedBy: null,
    reason: "Find a part: the tool's own raw dialog and search input.",
  },
  {
    path: `${CATALOG}parts.ts`,
    guards: ["elements"],
    removedBy: null,
    reason: "The button() helper of the catalog makes raw buttons for the tool's own chrome and for the specimens.",
  },
  {
    path: `${CATALOG}specimen.ts`,
    guards: ["css", "elements"],
    removedBy: null,
    reason:
      "The specimen window: hotspot buttons laid over the shown part, and a scale transform that fits the part in the window.",
  },
  {
    path: `${CATALOG}inspect.ts`,
    guards: ["css"],
    removedBy: null,
    reason: "Inspect paints the colour of the token it points at (style.background = var(token)).",
  },
  {
    path: `${CATALOG}tabs/foundations.ts`,
    guards: ["css", "elements"],
    removedBy: null,
    reason:
      "The Foundations tab shows tokens: it sets font, background, radius, shadow, outline and border colour inline to draw each token specimen, and a raw input shows the control border.",
  },
  {
    path: `${CATALOG}tabs/tokens.ts`,
    guards: ["css"],
    removedBy: null,
    reason:
      "The Tokens tab shows each token: it sets colour, shadow, radius and font inline to draw the specimen of the token.",
  },
  {
    path: `${CATALOG}tabs/limits.ts`,
    guards: ["elements"],
    removedBy: null,
    reason: "The Limits tab: a raw range input resizes the preview.",
  },
  {
    path: `${CATALOG}tabs/surfaces.ts`,
    guards: ["elements"],
    removedBy: null,
    reason: "The Surfaces tab: a raw input with the input look fills the rename dialog sample.",
  },
];

export const ALL_EXCEPTIONS = [...KNOWN_EXCEPTIONS, ...DEV_TOOL_EXCEPTIONS];

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

/**
 * The parts of TypeScript source that are not code: [{ kind: "comment" | "string" | "regex",
 * start, end }] with `end` exclusive. A small scanner: it skips string, template and regex
 * literals, so "assets/*" does not open a comment and a comment marker inside a string stays
 * text. Template text between `${ }` holes is one "string" part per piece; the holes are code.
 */
export function scanTs(text) {
  const out = [];
  const n = text.length;
  const holes = []; // brace depth at each open `${`
  let depth = 0;
  let prev = "";
  let word = "";
  let i = 0;
  const REGEX_AFTER = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
  const KEYWORDS = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "yield", "await", "else", "do"]);
  // Scan template text from `from`; `start` is where this piece began. Returns the next index.
  const template = (from, start) => {
    let j = from;
    while (j < n) {
      const c = text[j];
      if (c === "\\") j += 2;
      else if (c === "`") {
        out.push({ kind: "string", start, end: j + 1 });
        return j + 1;
      } else if (c === "$" && text[j + 1] === "{") {
        out.push({ kind: "string", start, end: j + 2 });
        holes.push(depth);
        depth++;
        return j + 2;
      } else j++;
    }
    out.push({ kind: "string", start, end: n });
    return n;
  };
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "/" && d === "/") {
      let j = text.indexOf("\n", i);
      if (j < 0) j = n;
      out.push({ kind: "comment", start: i, end: j });
      i = j;
    } else if (c === "/" && d === "*") {
      const j = text.indexOf("*/", i + 2);
      const end = j < 0 ? n : j + 2;
      out.push({ kind: "comment", start: i, end });
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      const end = Math.min(j + 1, n);
      out.push({ kind: "string", start: i, end });
      i = end;
      prev = c;
      word = "";
    } else if (c === "`") {
      i = template(i + 1, i);
      prev = "`";
      word = "";
    } else if (c === "/" && (REGEX_AFTER.has(prev) || KEYWORDS.has(word))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && text[j] !== "\n" && (inClass || text[j] !== "/")) {
        if (text[j] === "\\") j++;
        else if (text[j] === "[") inClass = true;
        else if (text[j] === "]") inClass = false;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(text[j])) j++;
      out.push({ kind: "regex", start: i, end: Math.min(j, n) });
      i = Math.min(j, n);
      prev = "/";
      word = "";
    } else {
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (holes.length > 0 && holes[holes.length - 1] === depth) {
          holes.pop();
          i = template(i + 1, i);
          prev = "`";
          word = "";
          continue;
        }
      }
      if (!/\s/.test(c)) {
        prev = c;
        word = /[\w$]/.test(c) ? word + c : "";
      }
      i++;
    }
  }
  return out;
}

/**
 * Remove comments, keeping newlines so line numbers stay right. `name` picks the syntax: .html
 * has <!-- -->, anything else is TypeScript or CSS-in-JS source read with scanTs.
 */
export function stripComments(name, text) {
  const keep = (c) => c.replace(/[^\n]/g, "");
  if (name.endsWith(".html")) return text.replace(/<!--[\s\S]*?-->/g, keep);
  let out = "";
  let at = 0;
  for (const s of scanTs(text).filter((x) => x.kind === "comment")) {
    out += text.slice(at, s.start) + keep(text.slice(s.start, s.end));
    at = s.end;
  }
  return out + text.slice(at);
}

/** The fix every guard message ends with. */
export const FIX =
  "use a part from ui/src/ds, or file a UI component request (DESIGN.md section 8)";
