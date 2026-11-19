// Guard (b) of #106 [DS-04]: code outside ui/src/ds/ creates no button, input, select, textarea
// or dialog itself. It calls the builders from ui/src/ds (createButton, createTextInput, ...).
// Flags: createElement/createElementNS with such a tag, a call to a tag helper with such a tag,
// and markup text such as "<button". Reading or listening is fine: querySelector("button"),
// addEventListener("input", ...), setAttribute("aria-haspopup", "dialog").
// Scope and exceptions: tests/lib/ds-guard.mjs (the only list of exceptions).
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/ds-screen-elements.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dsSourceFiles,
  FIX,
  FORM_TAGS,
  isExcepted,
  readRepo,
  scanTs,
  scopeFiles,
  stripComments,
  unusedExceptions,
} from "./lib/ds-guard.mjs";

const TAGS = FORM_TAGS.join("|");
const QUOTED_TAG = new RegExp(`^\\s*(["'\`])(${TAGS})\\1\\s*$`);
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const escape = (s) => s.replace(/[$]/g, "\\$");
const MARKUP = new RegExp(`<(${TAGS})(?![\\w-])`, "g");

/**
 * The names of the tag helpers in a source: functions, arrow functions and methods that pass one
 * of their own parameters as the tag of createElement / createElementNS, such as `el(doc, tag)`,
 * `const mk = tag => doc.createElement(tag)`, `createElement(tag, opts)` or a class method
 * `make(doc, tag) { return doc.createElement(tag); }`.
 */
export function findTagHelpers(text) {
  const src = stripComments("x.ts", text);
  const helpers = new Set();
  const NOT_NAMES = new Set(["if", "for", "while", "switch", "catch", "function", "return", "with", "super"]);
  const paramNames = (list) => [...list.matchAll(/(?:^|,)\s*(?:\.\.\.)?([\w$]+)/g)].map((p) => p[1]);
  // The text of the body that starts at `at`: a {block} or one expression.
  const bodyAt = (at) => {
    let i = at;
    while (/\s/.test(src[i] ?? "")) i++;
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      const ch = src[j];
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) {
        depth--;
        if (depth < 0) break;
        if (depth === 0 && src[i] === "{") return src.slice(i, j + 1);
      } else if (depth === 0 && (ch === ";" || ch === "\n") && src[i] !== "{") break;
    }
    return src.slice(i, j);
  };
  const passes = (body, params) => {
    for (const m of body.matchAll(/(?<![\w$])createElement(NS)?\s*(?:<[^>()]*>)?\s*\(/g)) {
      const args = callArgs(body, m.index + m[0].length - 1);
      const tag = (m[1] ? args[1] : args[0])?.trim();
      if (tag && params.includes(tag)) return true;
    }
    return false;
  };
  const NAME = "([\\w$]+)";
  const arrow = new RegExp(
    `(?<![\\w$.])${NAME}\\s*(?::[^=;(]+)?=\\s*(?:async\\s+)?(?:<[^>()]*>\\s*)?(?:\\(([^()]*)\\)|${NAME})\\s*(?::[^=;{]+?)?=>`,
    "g",
  );
  for (const m of src.matchAll(arrow))
    if (passes(bodyAt(m.index + m[0].length), paramNames(m[2] ?? m[3]))) helpers.add(m[1]);
  const named = new RegExp(`(?<![\\w$.])${NAME}\\s*(?:<[^>()]*>)?\\s*\\(([^()]*)\\)\\s*(?::[^{;=]+?)?\\s*\\{`, "g");
  for (const m of src.matchAll(named))
    if (!NOT_NAMES.has(m[1]) && passes(bodyAt(m.index + m[0].length - 1), paramNames(m[2]))) helpers.add(m[1]);
  return [...helpers].sort();
}

/** Split the top-level arguments of a call that starts at `open` (the "(") in `text`. */
function callArgs(text, open) {
  const args = [];
  let depth = 0;
  let cur = "";
  let quote = null;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) {
      if (depth === 0) {
        args.push(cur);
        return args;
      }
      depth--;
    }
    if (ch === "," && depth === 0) {
      args.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  return args;
}

/**
 * The violations in one source file: [{ line, what, reason }]. `name` picks the comment syntax
 * (.html or .ts); `helpers` are tag-helper names found anywhere in the scanned tree.
 */
export function checkSource(name, text, helpers = []) {
  const src = stripComments(name, text);
  const out = [];
  const callers = ["createElement", "createElementNS", ...helpers];
  const call = new RegExp(`(?<![\\w$])(${callers.map(escape).join("|")})\\s*(?:<[^>()]*>)?\\s*\\(`, "g");
  for (const m of src.matchAll(call)) {
    const args = callArgs(src, m.index + m[0].length - 1);
    // The tag: the first argument of createElement, the second of createElementNS, and the first
    // string argument of a helper (el(doc, "div", "button") makes a div with the class "button").
    const tagArg =
      m[1] === "createElement"
        ? args[0]
        : m[1] === "createElementNS"
          ? args[1]
          : args.find((a) => /^\s*["'`]/.test(a));
    const hit = (tagArg ?? "").match(QUOTED_TAG);
    if (hit)
      out.push({
        line: lineOf(src, m.index),
        what: `${m[1]}(... "${hit[2]}" ...)`,
        reason: `creates a raw ${hit[2]}`,
      });
  }
  // Markup: in .html the whole text; in .ts only string and template literals, so a generic such
  // as Promise<Dialog> or a comparison such as i<input.length is not markup. Lowercase tags only.
  const markup =
    name.endsWith(".html") ? [{ start: 0, end: src.length }] : scanTs(src).filter((p) => p.kind === "string");
  for (const part of markup)
    for (const m of src.slice(part.start, part.end).matchAll(MARKUP))
      out.push({
        line: lineOf(src, part.start + m.index),
        what: m[0],
        reason: `markup creates a raw ${m[1]}`,
      });
  return out;
}

let failed = false;
process.on("exit", () => {
  if (failed) process.exitCode = 1;
});
const t = (name, fn) =>
  test(name, () => {
    try {
      fn();
    } catch (e) {
      failed = true;
      throw e;
    }
  });

const scan = () => {
  const files = [...scopeFiles("ts"), ...scopeFiles("html")];
  const texts = new Map(files.map((f) => [f, readRepo(f)]));
  // Helpers are collected from the scanned tree and from ui/src/ds/, where most of them live.
  const helperSources = [...scopeFiles("ts").map((f) => texts.get(f)), ...dsSourceFiles().map(readRepo)];
  const helpers = [...new Set(helperSources.flatMap(findTagHelpers))];
  return { helpers, all: new Map(files.map((f) => [f, checkSource(f, texts.get(f), helpers)])) };
};

t("code outside ui/src/ds/ creates no button, input, select, textarea or dialog", () => {
  const { all } = scan();
  const checked = [...all].filter(([f]) => !isExcepted(f, "elements"));
  assert.ok(checked.length > 0, "the guard scanned no file; check the scope in tests/lib/ds-guard.mjs");
  const lines = checked.flatMap(([f, v]) => v.map((x) => `${f}:${x.line}: ${x.reason} (${x.what}). Fix: ${FIX}.`));
  assert.deepEqual(lines, [], `raw form elements outside ui/src/ds:\n${lines.join("\n")}`);
});

t("the scan finds the tag helpers of the tree", () => {
  const { helpers } = scan();
  assert.ok(helpers.includes("el") && helpers.includes("make"), `helpers found: ${helpers.join(", ")}`);
});

t("every elements exception still hides a violation (else remove this exception)", () => {
  const unused = unusedExceptions("elements", scan().all).map((e) => e.path);
  assert.deepEqual(unused, [], `remove this exception from tests/lib/ds-guard.mjs (elements): ${unused.join(", ")}`);
});

t("self-test: creation calls, helper calls and markup of form elements fail", () => {
  for (const [src, helpers] of [
    ['const b = doc.createElement("button");', []],
    ["const i = document.createElement('input');", []],
    ['const d = doc.createElementNS("http://www.w3.org/1999/xhtml", "dialog");', []],
    ['const d = el(doc, "dialog", "x");', ["el"]],
    ['const b = make<"button">(doc, "button");', ["make"]],
    ["const h = `<input type=\"text\">`;", []],
    ['const h = "<select><option>a</option></select>";', []],
    ["<main><textarea></textarea></main>", []],
  ])
    assert.ok(checkSource(helpers.length ? "x.ts" : "x.html", src, helpers).length > 0, `accepted: ${src}`);
});

t("self-test: reading, listening and other tags pass", () => {
  for (const src of [
    'const x = root.querySelector("button");',
    'node.addEventListener("input", fn);',
    'node.setAttribute("aria-haspopup", "dialog");',
    'const d = doc.createElement("div");',
    'const d = el(doc, "div", "button");',
    '// a comment about doc.createElement("button")',
    'const s = doc.createElementNS(SVG_NS, tag);',
  ])
    assert.deepEqual(checkSource("x.ts", src, ["el"]), [], `rejected: ${src}`);
});

t("self-test: a helper is a function that passes its own parameter to createElement", () => {
  const text = [
    "function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, c?: string) {",
    "  const node = doc.createElement(tag);",
    "  return node;",
    "}",
    "const mk = (doc: Document, t: string) => doc.createElement(t);",
    "function icon(doc: Document, shapes: Shape[]) {",
    "  for (const [tag] of shapes) doc.createElementNS(NS, tag);",
    "}",
  ].join("\n");
  assert.deepEqual(findTagHelpers(text), ["el", "mk"]);
});

t("self-test: TypeScript generics and comparisons are not markup, a real markup string is", () => {
  for (const src of [
    "async function open(): Promise<Dialog> { return d; }",
    "for (let i = 0; i<input.length; i++) {}",
    "const x: Array<Button> = [];",
    "const m = new Map<string, Textarea>();",
    'const h = "<Button>";',
    "const h = `<DIALOG>`;",
    "const n = a<select.length;",
  ])
    assert.deepEqual(checkSource("x.ts", src), [], `rejected: ${src}`);
  for (const src of ['const h = "<dialog open>";', "const h = `<div><textarea></textarea></div>`;", "const h = `${a}<button>`;"])
    assert.ok(checkSource("x.ts", src).length > 0, `accepted: ${src}`);
});

t("self-test: a string with /* does not hide the violations after it", () => {
  const src = 'const glob = "assets/*";\nconst b = doc.createElement("button");\nconst c = `a${"x/*"}`;\nconst i = doc.createElement("input");\n';
  const v = checkSource("x.ts", src);
  assert.deepEqual(
    v.map((x) => x.line),
    [2, 4],
  );
  const kept = stripComments("x.ts", 'const a = "// not a comment"; // a comment\n/* x\n y */ const r = /a\\/*b/;');
  assert.match(kept, /not a comment/);
  assert.doesNotMatch(kept, /a comment\n|\bx\b/);
  assert.equal(kept.split("\n").length, 3);
  assert.deepEqual(checkSource("x.ts", '// doc.createElement("button")\n/* <input> */\nconst r = /<button/;'), []);
});

t("self-test: helpers in arrow, two-argument, method and ds shapes are found", () => {
  assert.deepEqual(findTagHelpers("const mk = tag => doc.createElement(tag);"), ["mk"]);
  assert.deepEqual(findTagHelpers("const mk2 = (tag: string, opts?: object) => document.createElement(tag, opts);"), ["mk2"]);
  assert.deepEqual(findTagHelpers("function make(tag: string, o: object) {\n  return doc.createElement(tag, o);\n}"), ["make"]);
  assert.deepEqual(
    findTagHelpers("class B {\n  private static build(doc: Document, tag: string): HTMLElement {\n    return doc.createElement(tag);\n  }\n  other(x: string) {\n    return x;\n  }\n}"),
    ["build"],
  );
  assert.deepEqual(findTagHelpers("class B {\n  make = (t: string) => this.doc.createElement(t);\n}"), ["make"]);
  assert.deepEqual(findTagHelpers("const ns = (doc: Document, tag: string) => doc.createElementNS(SVG_NS, tag);"), ["ns"]);
  assert.deepEqual(findTagHelpers('const fixed = (doc: Document) => doc.createElement("div");\nconst s = (x: string) => x;'), []);
  // A helper found this way makes a call with a form tag fail.
  assert.ok(checkSource("x.ts", 'const b = mk("button");', ["mk"]).length > 0);
  assert.ok(checkSource("x.ts", 'const b = build(doc, "input");', ["build"]).length > 0);
});

t("the helpers of ui/src/ds/ are collected too", () => {
  const dsHelpers = dsSourceFiles().flatMap((f) => findTagHelpers(readRepo(f)));
  assert.ok(dsHelpers.length > 0, "no tag helper found in ui/src/ds; check dsSourceFiles()");
  assert.ok(scan().helpers.includes(dsHelpers[0]));
});
