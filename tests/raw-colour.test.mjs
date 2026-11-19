// Raw-colour check for #10 [APP-03]: colours live only in ui/src/ds/tokens.css.
// Fails on hex, rgb/rgba/hsl/hsla/hwb/lab/lch/oklab/oklch/color() or named colours in ui/**/*.{css,ts,html}.
// Run: node --test tests/raw-colour.test.mjs   (runs under npm test and npm run check)
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI = join(ROOT, "ui");
const TOKENS = join(UI, "src", "ds", "tokens.css");

const NAMED = (
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
  "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
  "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid " +
  "darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
  "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro " +
  "ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
  "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow " +
  "lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
  "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine " +
  "mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise " +
  "mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab " +
  "orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru " +
  "pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
  "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan " +
  "teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
).split(" ");
const NAMED_RE = new RegExp(`(?<![\\w-])(${NAMED.join("|")})(?![\\w-])`, "i");
const HEX_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![\w-])/i;
const FUNC_RE = /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
// Properties whose value can hold a colour; named colours are only checked here.
const COLOUR_PROP =
  /^(--[\w-]+|color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|fill|stroke|box-shadow|text-shadow|text-decoration(-color)?|caret-color|accent-color|column-rule(-color)?|scrollbar-color|filter)$/i;

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const stripUrls = (s) => s.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi, "url()");
const stripVars = (s) => s.replace(/var\([^)]*\)/g, "var()");

// Returns the reasons a file's text holds a raw colour. `kind` is "css", "ts" or "html".
export function rawColours(text, kind) {
  const found = [];
  const clean = stripUrls(stripComments(text));
  if (HEX_RE.test(clean)) found.push("hex colour");
  if (FUNC_RE.test(clean)) found.push("colour function");
  const declarations =
    kind === "css"
      ? [...clean.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)].map((m) => [m[1], m[2]])
      : [...clean.matchAll(/style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/gi)].flatMap((m) =>
          (m[1] ?? m[2]).split(";").map((d) => d.split(/:(.*)/s).slice(0, 2)),
        );
  for (const [prop, value] of declarations) {
    if (!prop || value === undefined) continue;
    if (COLOUR_PROP.test(prop.trim()) && NAMED_RE.test(stripVars(value))) found.push("named colour");
  }
  return found;
}

const walk = (d) =>
  !existsSync(d)
    ? []
    : readdirSync(d).flatMap((n) => {
        const f = join(d, n);
        return statSync(f).isDirectory() ? walk(f) : [f];
      });

let failed = false;
process.on("exit", () => {
  if (failed) process.exitCode = 1;
});

test("no raw colour in ui/**/*.{css,ts,html} outside ui/src/ds/tokens.css", () => {
  const offenders = [];
  for (const f of walk(UI)) {
    const kind = (f.match(/\.(css|ts|html)$/) ?? [])[1];
    if (!kind || f === TOKENS) continue;
    const found = rawColours(readFileSync(f, "utf8"), kind);
    if (found.length) offenders.push(`${relative(ROOT, f)}: ${found.join(", ")}`);
  }
  // A nested `node --test` that inherits NODE_TEST_CONTEXT ignores test failures in its exit code,
  // so also set the exit code ourselves. A caller that spawns this file then still sees a failure.
  if (offenders.length) failed = true;
  assert.deepEqual(offenders, [], `raw colours found outside ui/src/ds/tokens.css:\n${offenders.join("\n")}`);
});

test("self-test: the detector flags raw colours and allows tokens", () => {
  for (const css of [
    ".a { color: #fff; }",
    ".a { color: #FF0000AA; }",
    ".a { background: rgb(0 0 0); }",
    ".a { background: rgba(0, 0, 0, 0.5); }",
    ".a { color: hsl(10 20% 30%); }",
    ".a { color: oklch(0.5 0.1 200); }",
    ".a { border: 1px solid red; }",
    ".a { --x: navy; }",
    ".a { box-shadow: 0 1px 2px black; }",
  ])
    assert.ok(rawColours(css, "css").length > 0, `not flagged: ${css}`);
  assert.ok(rawColours("export const c = '#fff';", "ts").length > 0);
  assert.ok(rawColours('<p style="color:#fff">x</p>', "html").length > 0);
  assert.ok(rawColours('<p style="color: red">x</p>', "html").length > 0);
  for (const css of [
    ".a { color: var(--ink); background: var(--red-ish); }",
    ".a { color: transparent; border-color: currentcolor; }",
    '.a { font-family: "Source Sans 3", sans-serif; }',
    "/* color: #fff and red */ .a { margin: 0; }",
    '.a { background: url("data:image/svg+xml,%3Csvg fill=\'%23fff\'/%3E#fff"); }',
    ".tan-row { margin: 0; } .a::after { content: 'red'; }",
  ])
    assert.deepEqual(rawColours(css, "css"), [], `wrongly flagged: ${css}`);
  assert.deepEqual(rawColours('document.querySelector("#board"); el.id = "a#add-btn";', "ts"), []);
});
