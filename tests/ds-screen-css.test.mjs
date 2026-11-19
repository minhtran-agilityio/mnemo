// Guard (a) of #106 [DS-04]: CSS outside ui/src/ds/ holds layout only, with token values.
// Colour, font, border, radius, shadow and custom property definitions fail; so does a number with
// a unit that is not a token. Motion may only be switched off (transition/animation: none).
// Scope and exceptions: tests/lib/ds-guard.mjs (the only list of exceptions).
// Run: MNEMO_NESTED=1 node --test --test-isolation=none tests/ds-screen-css.test.mjs
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  FIX,
  isExcepted,
  LAYOUT_PROPERTIES,
  MOTION_PROPERTIES,
  ROOT,
  readRepo,
  scopeFiles,
  unusedExceptions,
} from "./lib/ds-guard.mjs";

const walk = (d) =>
  !existsSync(d)
    ? []
    : readdirSync(d).flatMap((n) => {
        const f = join(d, n);
        return statSync(f).isDirectory() ? walk(f) : [f];
      });

/** Every custom property defined in ui/src/ds/**\/*.css: the tokens a layout value may use. */
export function dsTokens() {
  const names = new Set();
  for (const f of walk(join(ROOT, "ui", "src", "ds")).filter((f) => f.endsWith(".css"))) {
    const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) names.add(m[1]);
  }
  return names;
}

const LAYOUT = new Set(LAYOUT_PROPERTIES);
const FUNCTIONS = new Set(["var", "minmax", "repeat", "calc", "fit-content"]);
const UNITS = new Set(["", "%", "fr"]);

/** The look a non-layout property sets, for the message. */
function category(prop) {
  if (prop.startsWith("--")) return "custom property definition";
  if (/radius$/.test(prop)) return "radius";
  if (/shadow$/.test(prop)) return "shadow";
  if (/^(color|background|fill|stroke|opacity|accent-color|caret-color)/.test(prop)) return "colour";
  if (/^(font|line-height|letter-spacing|word-spacing|text-)/.test(prop)) return "font";
  if (/^(border|outline)/.test(prop)) return "border";
  if (MOTION_PROPERTIES.some((m) => prop.startsWith(m))) return "motion";
  return "not a layout property";
}

/** Why a layout value is not allowed, or null. `tokens` is the set of defined token names. */
function badValue(value, tokens) {
  const parts = value.match(/--[\w-]+|[-+]?(?:\d+\.?\d*|\.\d+)(?:[a-z%]+)?|[a-z_-][\w-]*\(?|"[^"]*"|'[^']*'|\S/gi) ?? [];
  for (const p of parts) {
    if (p.startsWith("--")) {
      if (!tokens.has(p)) return `${p} is not a token in ui/src/ds`;
    } else if (/^[-+]?(?:\d|\.\d)/.test(p)) {
      const unit = p.replace(/^[-+]?(?:\d+\.?\d*|\.\d+)/, "").toLowerCase();
      if (!UNITS.has(unit)) return `${p} is a raw size; use a token`;
    } else if (p.endsWith("(")) {
      const fn = p.slice(0, -1).toLowerCase();
      if (!FUNCTIONS.has(fn)) return `${fn}() is not allowed in a layout value`;
    } else if (/^[a-z_-]/i.test(p) || /^["']/.test(p)) {
      // A keyword (auto, none, center) or a grid area name.
    } else if (!/^[(),/*+\-[\]]$/.test(p)) {
      return `"${p}" is not allowed in a layout value`;
    }
  }
  return null;
}

/**
 * The violations in one style sheet: [{ line, prop, value, reason }]. Comments are replaced by
 * the same number of newlines, so line numbers stay right. At-rule preludes are not checked;
 * declarations inside @media, @supports and nested blocks are.
 */
export function checkCss(text, tokens = dsTokens()) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ""));
  const out = [];
  let depth = 0;
  let buf = "";
  let bufLine = 1;
  let line = 1;
  let quote = null;
  const flush = () => {
    const decl = buf.trim();
    buf = "";
    if (depth === 0 || !decl.includes(":")) return;
    const at = decl.indexOf(":");
    const prop = decl.slice(0, at).trim().toLowerCase();
    const value = decl
      .slice(at + 1)
      .replace(/!\s*important\s*$/i, "")
      .trim();
    if (prop.startsWith("@")) return;
    let reason = null;
    if (MOTION_PROPERTIES.includes(prop)) {
      if (value.toLowerCase() !== "none") reason = `motion: ${prop} may only be none outside ui/src/ds`;
    } else if (!LAYOUT.has(prop)) {
      reason = `${category(prop)}: ${prop} is not a layout property`;
    } else {
      const bad = badValue(value, tokens);
      if (bad) reason = `value: ${bad}`;
    }
    if (reason) out.push({ line: bufLine, prop, value, reason });
  };
  for (const ch of clean) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      buf += ch;
      quote = ch;
    } else if (ch === "{") {
      buf = "";
      depth++;
    } else if (ch === "}") {
      flush();
      depth = Math.max(0, depth - 1);
    } else if (ch === ";") {
      flush();
    } else {
      if (buf.trim() === "" && !/\s/.test(ch)) bufLine = line;
      buf += ch;
    }
    if (ch === "\n") line++;
  }
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
  const tokens = dsTokens();
  return new Map(scopeFiles("css").map((f) => [f, checkCss(readRepo(f), tokens)]));
};

t("CSS outside ui/src/ds/ holds layout properties only, with token values", () => {
  const all = scan();
  const checked = [...all].filter(([f]) => !isExcepted(f, "css"));
  assert.ok(checked.length > 0, "the guard scanned no style sheet; check the scope in tests/lib/ds-guard.mjs");
  const lines = checked.flatMap(([f, v]) => v.map((x) => `${f}:${x.line}: ${x.reason} (${x.prop}: ${x.value}). Fix: ${FIX}.`));
  assert.deepEqual(lines, [], `style outside ui/src/ds:\n${lines.join("\n")}`);
});

t("every css exception still hides a violation (else remove this exception)", () => {
  const unused = unusedExceptions("css", scan()).map((e) => e.path);
  assert.deepEqual(unused, [], `remove this exception from tests/lib/ds-guard.mjs (css): ${unused.join(", ")}`);
});

t("self-test: colour, font, border, radius, shadow, raw sizes, custom properties and motion fail", () => {
  const tokens = new Set(["--space-2", "--space-3", "--radius-md", "--text-sm", "--motion"]);
  for (const [css, want] of [
    [".a { color: red; }", /colour/],
    [".a { background: var(--bg); }", /colour/],
    [".a { opacity: 0.5; }", /colour/],
    [".a { font-size: var(--text-sm); }", /font/],
    [".a { line-height: 1.4; }", /font/],
    [".a { border: 1px solid; }", /border/],
    [".a { outline: none; }", /border/],
    [".a { border-radius: var(--radius-md); }", /radius/],
    [".a { box-shadow: none; }", /shadow/],
    [".a { gap: 12px; }", /raw size/],
    [".a { padding: 1rem; }", /raw size/],
    [".a { gap: var(--not-a-token); }", /not a token/],
    [".a { --x: 1; }", /custom property/],
    [".a { transition: opacity var(--motion); }", /motion/],
    [".a { animation: spin 1s; }", /motion/],
    ["@media (max-width: 720px) { .a { color: red; } }", /colour/],
  ]) {
    const v = checkCss(css, tokens);
    assert.ok(v.length > 0, `accepted: ${css}`);
    assert.match(v[0].reason, want, `${css} -> ${v[0].reason}`);
  }
});

t("self-test: layout with tokens, keywords, media queries and motion off pass", () => {
  const tokens = new Set(["--space-2", "--space-3", "--size-page-max"]);
  for (const css of [
    ".a { gap: var(--space-2); }",
    ".a { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }",
    ".a { transition: none !important; animation: none !important; }",
    ".a { width: 100%; max-width: var(--size-page-max); margin: 0 auto; }",
    ".a { flex: 1 1 calc(100% - var(--space-3)); z-index: 1; }",
    ".a { grid-template-areas: \"head head\" \"side main\"; }",
    "@media (max-width: 720px) {\n  .a { display: block; }\n}",
    ".a {\n  grid-template-columns:\n    minmax(0, 1fr)\n    minmax(0, 1fr);\n}",
    "/* color: red; */ .a { position: relative; }",
  ])
    assert.deepEqual(checkCss(css, tokens), [], `rejected: ${css}`);
});

t("self-test: line numbers count lines inside comments and multi-line values", () => {
  const v = checkCss("/* one\n two */\n.a {\n  gap: 0;\n  color: red;\n}", new Set());
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 5);
});
