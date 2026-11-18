import { expect, test } from "vitest";
import { startupReasonText } from "./error-text";

test("each startup code has its own plain sentence", () => {
  const codes = ["folder", "open", "migration", "too_new", "database"];
  const texts = codes.map(startupReasonText);
  expect(new Set(texts).size).toBe(codes.length);
  expect(startupReasonText("migration")).toContain("undone");
});

test("a missing or unknown code falls back to the general sentence", () => {
  expect(startupReasonText(null)).toBe(startupReasonText("not-a-code"));
  expect(startupReasonText(null)).toContain("Nothing was deleted");
});

test("an inherited object key is not treated as a code", () => {
  expect(startupReasonText("toString")).toBe(startupReasonText(null));
});
