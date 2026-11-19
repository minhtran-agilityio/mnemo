// Guard (b) of #106 [DS-04]: code outside ui/src/ds/ creates no button, input, select, textarea
// or dialog itself. It calls the builders from ui/src/ds (createButton, createTextInput, ...).
// Flags: createElement/createElementNS with such a tag, a call to a tag helper with such a tag,
// and markup text such as "<button". Reading or listening is fine: querySelector("button"),
// addEventListener("input", ...), setAttribute("aria-haspopup", "dialog").
// Scope and exceptions: tests/lib/ds-guard.mjs (the only list of exceptions).
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/ds-screen-elements.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIX, FORM_TAGS, isExcepted, readRepo, scopeFiles, unusedExceptions } from "./lib/ds-guard.mjs";

const TAGS = FORM_TAGS.join("|");
const QUOTED_TAG = new RegExp(`^\\s*(["'\`])(${TAGS})\\1\\s*$`);
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const escape = (s) => s.replace(/[$]/g, "\\$");

/** Remove comments (keeping newlines) so a comment that names a tag does not count. */
function stripComments(name, text) {
  const keep = (c) => c.replace(/[^\n]/g, "");
  if (name.endsWith(".html")) return text.replace(/<!--[\s\S]*?-->/g, keep);
  return text.replace(/\/\*[\s\S]*?\*\//g, keep).replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The names of the tag helpers in a source: functions that pass one of their own parameters to
 * createElement, such as `el(doc, tag)` or `make(doc, tag)`.
 */
export function findTagHelpers(text) {
  const helpers = [];
  const decl =
    /(?:function\s+([\w$]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)|(?:const|let|var)\s+([\w$]+)\s*=\s*(?:function\s*)?(?:<[^>]*>)?\s*\(([^)]*)\))/g;
  for (const m of text.matchAll(decl)) {
    const name = m[1] ?? m[3];
    const params = [...(m[2] ?? m[4]).matchAll(/(?:^|,)\s*([\w$]+)/g)].map((p) => p[1]);
    const rest = text.slice(m.index + m[0].length);
    const next = rest.search(/\n(?:export\s+)?(?:function|const|let|var)\s/);
    const body = next < 0 ? rest : rest.slice(0, next);
    if (
      params.some((p) =>
        new RegExp(`createElement(?:NS)?\\s*\\((?:[^,()]*,)?\\s*${escape(p)}\\s*\\)`).test(body),
      )
    )
      helpers.push(name);
  }
  return helpers;
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
  for (const m of src.matchAll(new RegExp(`<(${TAGS})(?![\\w-])`, "gi")))
    out.push({ line: lineOf(src, m.index), what: m[0], reason: `markup creates a raw ${m[1].toLowerCase()}` });
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
  const helpers = [...new Set(scopeFiles("ts").flatMap((f) => findTagHelpers(texts.get(f))))];
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
