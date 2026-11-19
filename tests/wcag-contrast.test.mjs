// Contrast check for #104 [DS-02]: the text/surface pairs and control borders that DESIGN.md names
// meet WCAG 2.2 AA (4.5:1 for text, 3:1 for control borders) in light and dark.
// It reads ui/src/ds/tokens.css, so a palette change is checked with no edit here.
// A failing pair is reported by name. Do not change the palette to make it pass: ask the owner.
// Run: node --test tests/wcag-contrast.test.mjs   (runs under npm test and npm run check)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = readFileSync(join(ROOT, "ui", "src", "ds", "tokens.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function block(css, header) {
  const i = css.indexOf(header);
  assert.ok(i >= 0, `${header} is missing in ui/src/ds/tokens.css`);
  const start = css.indexOf("{", i);
  let depth = 0;
  for (let k = start; k < css.length; k++) {
    if (css[k] === "{") depth++;
    else if (css[k] === "}" && --depth === 0) return css.slice(start + 1, k);
  }
  assert.fail(`unclosed block ${header}`);
}
const decls = (body) =>
  Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const light = {};
for (const m of CSS.matchAll(/(^|\n)\s*:root\s*\{/g)) Object.assign(light, decls(block(CSS.slice(m.index), ":root")));
const dark = { ...light, ...decls(block(CSS, ':root[data-theme="dark"]')) };

const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = [
  ["--ink", "--paper"], ["--ink", "--card"], ["--ink", "--head"],
  ["--ink2", "--paper"], ["--ink2", "--card"], ["--ink2", "--head"],
  ["--muted", "--paper"], ["--muted", "--card"], ["--muted", "--head"],
  ["--on-accent", "--accent"], ["--on-bad", "--bad"],
  ["--chip-ink", "--tint-info"], ["--warn-ink", "--tint-warn"], ["--guess-ink", "--tint-bad"],
  ["--ink", "--tint-note"], ["--ink", "--tint-good"], ["--ink", "--tint-neutral"],
];
const EDGES = [
  ["--control-edge", "--card"], ["--control-edge", "--paper"], ["--control-edge", "--head"],
];

const failures = (palette) => {
  const out = [];
  for (const [min, pairs] of [[4.5, TEXT], [3, EDGES]]) {
    for (const [fg, bg] of pairs) {
      const [a, b] = [palette[fg], palette[bg]];
      if (!/^#[0-9a-f]{6}$/i.test(a ?? "") || !/^#[0-9a-f]{6}$/i.test(b ?? "")) {
        out.push(`${fg} on ${bg}: a value is missing or is not a 6-digit hex (${a}, ${b})`);
        continue;
      }
      const r = ratio(a, b);
      if (r < min) out.push(`${fg} on ${bg} = ${r.toFixed(2)}:1, needs ${min}:1`);
    }
  }
  return out;
};

for (const [mode, palette] of [["light", light], ["dark", dark]]) {
  test(`${mode}: text/surface pairs and control borders meet WCAG AA`, () => {
    assert.deepEqual(failures(palette), [], `pairs below AA in ${mode}: report to the owner, do not change the palette`);
  });
}

test("self-test: the ratio maths matches known values", () => {
  assert.equal(ratio("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(ratio("#777777", "#777777").toFixed(1), "1.0");
  assert.ok(ratio("#767676", "#ffffff") >= 4.5);
  assert.ok(ratio("#777777", "#ffffff") < 4.5);
});
