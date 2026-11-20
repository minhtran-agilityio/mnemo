// Guard (a) of #106 [DS-04]: CSS outside ui/src/ds/ holds layout only, with token values.
// Colour, font, border, radius, shadow and custom property definitions fail; so does a number with
// a unit that is not a token. Motion may only be switched off (transition/animation: none).
// The same rules cover inline styles: in .ts files `node.style.color = ...`, `style.setProperty(...)`,
// `style.cssText` and `setAttribute("style", ...)`; in ui/*.html a <style> block or a style="..."
// attribute. A layout property with a computed value (`${px}px`) passes; a literal value is
// checked like CSS.
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
  stripComments,
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

const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const kebab = (p) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^css-float$/, "float");
/** The text of a plain string literal without \${} holes, or null. */
const literal = (expr) => {
  const m = expr.trim().match(/^(["'`])((?:\\.|(?!\1)[^\\])*)\1$/);
  return m && !(m[1] === "`" && m[2].includes("${")) ? m[2] : null;
};

/** The reason an inline `prop = value` is not allowed, or null. `value` is source text. */
function inlineReason(prop, value, tokens) {
  const lit = literal(value);
  if (MOTION_PROPERTIES.includes(prop))
    return lit !== null && lit.trim().toLowerCase() === "none" ? null : `motion: ${prop} may only be none outside ui/src/ds`;
  if (!LAYOUT.has(prop)) return `${category(prop)}: ${prop} is not a layout property`;
  const bad = lit === null ? null : badValue(lit, tokens);
  return bad ? `value: ${bad}` : null;
}

/**
 * The violations of inline styles in one source: [{ line, prop, value, reason }]. In .ts it reads
 * `.style.x = v`, `.style.setProperty("x", v)`, `.style.cssText`, `.style[...]`, `.style = ...`,
 * `Object.assign(x.style, ...)` and `setAttribute("style", ...)`. In .html it reads <style>
 * blocks and style="..." attributes with the rules of checkCss.
 */
export function checkInlineStyles(name, text, tokens = dsTokens()) {
  const src = stripComments(name, text);
  const out = [];
  if (name.endsWith(".html")) {
    const add = (index, css) => {
      for (const v of checkCss(css, tokens)) out.push({ ...v, line: lineOf(src, index) + v.line - 1 });
    };
    for (const m of src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) add(m.index, m[1]);
    for (const m of src.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) add(m.index, `a{${m[1] ?? m[2]}}`);
    return out;
  }
  const add = (index, prop, value, reason) => reason && out.push({ line: lineOf(src, index), prop, value, reason });
  for (const m of src.matchAll(/\.style\.([A-Za-z]+)\s*[-+*/|&?]?=(?!=)\s*([^;\n]*)/g)) {
    const prop = kebab(m[1]);
    add(
      m.index,
      prop,
      m[2].trim(),
      prop === "css-text"
        ? "not a layout property: style.cssText sets arbitrary style"
        : inlineReason(prop, m[2], tokens),
    );
  }
  for (const m of src.matchAll(/\.style\.setProperty\s*\(\s*([^,)]*)(?:,\s*([^)]*))?\)/g)) {
    const prop = literal(m[1])?.trim().toLowerCase();
    add(
      m.index,
      prop ?? m[1].trim(),
      (m[2] ?? "").trim(),
      prop === undefined ? "not a layout property: style.setProperty with a computed name" : prop.startsWith("--") ? "custom property definition: style.setProperty defines a custom property" : inlineReason(prop, m[2] ?? '""', tokens),
    );
  }
  for (const m of src.matchAll(/\.style\s*\[/g)) add(m.index, "style[...]", "", "not a layout property: style[...] sets a property by a computed name");
  for (const m of src.matchAll(/\.style\s*=(?!=)/g)) add(m.index, "style", "", "not a layout property: assigning style sets arbitrary style");
  for (const m of src.matchAll(/Object\.assign\s*\(\s*[\w$.]*\.style\b/g)) add(m.index, "style", "", "not a layout property: Object.assign on style sets arbitrary style");
  for (const m of src.matchAll(/setAttribute\s*\(\s*(["'`])style\1/g)) add(m.index, "style", "", 'not a layout property: setAttribute("style", ...) sets arbitrary style');
  return out.sort((a, b) => a.line - b.line);
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
  const sheets = scopeFiles("css").map((f) => [f, checkCss(readRepo(f), tokens)]);
  // Inline styles count as part of the css guard, so the same exceptions cover them.
  const inline = [...scopeFiles("ts"), ...scopeFiles("html")].map((f) => [f, checkInlineStyles(f, readRepo(f), tokens)]);
  return new Map([...sheets, ...inline]);
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

t("self-test: inline styles in .ts that set more than layout fail", () => {
  const tokens = new Set(["--space-2"]);
  for (const [src, want] of [
    ["node.style.color = `var(--fg)`;", /colour/],
    ["node.style.background = 'red';", /colour/],
    ["node.style.fontSize = x;", /font/],
    ["node.style.borderRadius = r;", /radius/],
    ["node.style.boxShadow = s;", /shadow/],
    ["node.style.outline += o;", /border/],
    ["node.style.transform = `scale(${s})`;", /not a layout property/],
    ["node.style.transition = 'opacity 1s';", /motion/],
    ["node.style.animation = a;", /motion/],
    ["node.style.gap = '12px';", /raw size/],
    ["node.style.width = 'var(--not-a-token)';", /not a token/],
    ["node.style.cssText = 'color: red';", /cssText/],
    ["node.style.setProperty('color', v);", /colour/],
    ["node.style.setProperty('--x', v);", /custom property/],
    ["node.style.setProperty(name, v);", /computed name/],
    ["node.style[prop] = v;", /computed name/],
    ["node.style = 'color: red';", /assigning style/],
    ["Object.assign(node.style, { color: 'red' });", /Object\.assign/],
    ['node.setAttribute("style", "color: red");', /setAttribute/],
  ]) {
    const v = checkInlineStyles("x.ts", src, tokens);
    assert.ok(v.length > 0, `accepted: ${src}`);
    assert.match(v[0].reason, want, `${src} -> ${v[0].reason}`);
  }
});

t("self-test: inline layout, motion off, reads and comments pass", () => {
  const tokens = new Set(["--space-2"]);
  for (const src of [
    "node.style.left = `${x}px`;",
    "node.style.width = `${(n / total) * 100}%`;",
    "node.style.height = String(h);",
    "node.style.zIndex = String(1 + i);",
    "node.style.gap = 'var(--space-2)';",
    "node.style.transition = 'none';",
    "node.style.setProperty('display', 'none');",
    "node.style.removeProperty('color-scheme');",
    "const c = node.style.color;",
    "if (node.style.color === 'red') {}",
    "// node.style.color = 'red';",
    "/* node.style.cssText = 'x'; */",
    'node.setAttribute("aria-label", "style");',
  ])
    assert.deepEqual(checkInlineStyles("x.ts", src, tokens), [], `rejected: ${src}`);
});

t("self-test: <style> blocks and style attributes in html fail on more than layout", () => {
  const tokens = new Set();
  for (const html of [
    "<style>.a { color: red; }</style>",
    '<style media="screen">\n.a { border: 1px solid; }\n</style>',
    '<div style="background: red">x</div>',
    "<div style='font-size: 12px'>x</div>",
    '<p class="a" style="opacity: 0.5; gap: 1px">x</p>',
  ])
    assert.ok(checkInlineStyles("x.html", html, tokens).length > 0, `accepted: ${html}`);
  assert.equal(checkInlineStyles("x.html", "<style>\n\n.a { color: red; }</style>", tokens)[0].line, 3);
  for (const html of [
    "<style>.a { display: grid; gap: 0; }</style>",
    '<div style="display: none">x</div>',
    "<!-- <div style=\"color: red\"> -->",
    '<div class="style">x</div>',
  ])
    assert.deepEqual(checkInlineStyles("x.html", html, tokens), [], `rejected: ${html}`);
});
