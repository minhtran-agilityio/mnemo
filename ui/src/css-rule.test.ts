import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cssRule } from "./css-rule";

const sheet = (css: string) => {
  const dir = mkdtempSync(join(tmpdir(), "css-rule-"));
  writeFileSync(join(dir, "a.css"), css);
  return dir;
};

test("a rule inside @media or @container is not the base rule", () => {
  const dir = sheet(`
    .box { color: red; }
    @media (max-width: 600px) { .box { color: blue; padding: 0; } }
    @container (min-width: 10px) { .box { margin: 0; } }
  `);
  expect(cssRule(dir, "a.css", ".box")).toEqual({ color: "red" });
});

test("a selector found only inside an at-rule throws", () => {
  const dir = sheet("@media (min-width: 1px) { .only { color: red; } }");
  expect(() => cssRule(dir, "a.css", ".only")).toThrow();
});

test("top-level matches merge in order and the last value wins", () => {
  const dir = sheet(`
    .a, .box { color: red; gap: 1px; }
    .box { color: blue; }
  `);
  expect(cssRule(dir, "a.css", ".box")).toEqual({ color: "blue", gap: "1px" });
});
