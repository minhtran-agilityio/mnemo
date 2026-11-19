// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createKbd, createShortcut } from "./kbd";

test("a key is a kbd with text content", () => {
  const k = createKbd(document, "<S>");
  expect(k.tagName).toBe("KBD");
  expect(k.textContent).toBe("<S>");
});

test("a shortcut shows the label and one kbd per key", () => {
  const s = createShortcut(document, "Search", ["Ctrl", "K"]);
  expect(s.querySelector("span")?.textContent).toBe("Search");
  expect([...s.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual([
    "Ctrl",
    "K",
  ]);
});
