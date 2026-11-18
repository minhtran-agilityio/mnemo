import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { FALLBACK, REASONS, startupReasonText } from "./error-text";

const repo = new URL("../../", import.meta.url);

test("each startup code has its own plain sentence", () => {
  const codes = ["folder", "open", "migration", "too_new", "database"];
  const texts = codes.map(startupReasonText);
  expect(new Set(texts).size).toBe(codes.length);
  expect(startupReasonText("migration")).toContain("undone");
  for (const text of texts)
    expect(text.toLowerCase()).toContain("nothing was deleted");
});

test("a missing or unknown code falls back to the general sentence", () => {
  expect(startupReasonText(null)).toBe(startupReasonText("not-a-code"));
  expect(startupReasonText(null)).toContain("Nothing was deleted");
});

test("an inherited object key is not treated as a code", () => {
  expect(startupReasonText("toString")).toBe(startupReasonText(null));
});

test("every startup code the core sends has a sentence", () => {
  const lib = readFileSync(new URL("src-tauri/src/lib.rs", repo), "utf8");
  const body = lib.slice(0, lib.indexOf("#[cfg(test)]"));
  const codes = [
    ...body.matchAll(/code: "([a-z_]+)"/g),
    ...body.matchAll(/=> "([a-z_]+)"/g),
  ].map((m) => m[1]);
  expect(codes.length).toBeGreaterThanOrEqual(5);
  for (const code of codes) expect(Object.keys(REASONS)).toContain(code);
});

test("the static text in error.html matches the fallback sentence", () => {
  const html = readFileSync(new URL("ui/error.html", repo), "utf8");
  expect(html).toContain(FALLBACK);
});
