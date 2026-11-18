import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const root = resolve(__dirname, "..", "..");
const includes: string[] = JSON.parse(
  readFileSync(resolve(root, "biome.json"), "utf8"),
).files.includes;

test("biome files.includes covers the config files it should check", () => {
  expect(includes).toContain("package.json");
  expect(includes).toContain("biome.json");
});

test("biome files.includes lists only paths that exist", () => {
  for (const entry of includes) {
    if (entry.endsWith("/**")) continue;
    expect(existsSync(resolve(root, entry)), entry).toBe(true);
  }
});
