import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

// Issue #189: a latin-only subset sends Vietnamese letters (ệ ớ ỷ ư ơ đ) to the fallback font.
const source = readFileSync(resolve(import.meta.dirname, "fonts.ts"), "utf8");
const imports = [...source.matchAll(/^import "([^"]+)";$/gm)].map((m) => m[1]);

const WEIGHTS = {
  "@fontsource/source-sans-3": [400, 600, 700],
  "@fontsource/jetbrains-mono": [400, 600],
};

for (const [pkg, weights] of Object.entries(WEIGHTS)) {
  for (const subset of ["latin", "latin-ext", "vietnamese"]) {
    for (const weight of weights) {
      test(`${pkg} ${subset} ${weight} is bundled`, () => {
        expect(imports).toContain(`${pkg}/${subset}-${weight}.css`);
      });
    }
  }
}

test("every font import resolves to a local file and none is a remote URL", () => {
  for (const spec of imports) {
    expect(spec.startsWith("@fontsource/")).toBe(true);
    expect(() => readFileSync(resolve(import.meta.dirname, "../../node_modules", spec))).not.toThrow();
  }
});
