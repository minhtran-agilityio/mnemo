// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { buildDot, buildDotLabel } from "./dot";

test("a dot is hidden from screen readers and carries its tone", () => {
  const dot = buildDot({ tone: "good" });
  expect(dot.className).toBe("dot dot-good");
  expect(dot.getAttribute("aria-hidden")).toBe("true");
});

test("pulse adds the pulse class", () => {
  expect(
    buildDot({ tone: "accent", pulse: true }).classList.contains("pulse"),
  ).toBe(true);
});

test("a dot label shows the word as text next to the dot", () => {
  const label = buildDotLabel("<b>Synced</b>", "good");
  expect(label.textContent).toBe("<b>Synced</b>");
  expect(label.querySelector("b")).toBeNull();
  expect(label.querySelector(".dot")).not.toBeNull();
});
