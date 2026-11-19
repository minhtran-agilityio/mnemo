// @vitest-environment happy-dom
import { Check } from "lucide";
import { expect, test } from "vitest";
import { buildPill } from "./pill";

test("a default pill has only the pill class", () => {
  const pill = buildPill({ text: "Draft" });
  expect(pill.className).toBe("pill");
  expect(pill.textContent).toBe("Draft");
});

test("a tint adds its class", () => {
  for (const tint of ["info", "good", "warn", "note", "bad"] as const) {
    expect(buildPill({ text: "x", tint }).className).toBe(`pill pill-${tint}`);
  }
});

test("text goes in as text, never as markup", () => {
  const pill = buildPill({ text: '<img src=x onerror="1">' });
  expect(pill.querySelector("img")).toBeNull();
  expect(pill.textContent).toBe('<img src=x onerror="1">');
});

test("an icon is hidden from screen readers and the word stays", () => {
  const pill = buildPill({ text: "Done", tint: "good", icon: Check });
  expect(pill.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(pill.textContent).toBe("Done");
});
