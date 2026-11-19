// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createStaticTooltip, createTooltip } from "./tooltip";

test("the tip is a tooltip that describes the anchor, text as text", () => {
  const a = document.createElement("button");
  const t = createTooltip(a, "<b>Copy</b>");
  expect(t.tip.getAttribute("role")).toBe("tooltip");
  expect(t.tip.textContent).toBe("<b>Copy</b>");
  expect(a.getAttribute("aria-describedby")).toBe(t.tip.id);
});

test("Escape hides the tip and leaving shows it again next time", () => {
  const a = document.createElement("button");
  const t = createTooltip(a, "Copy");
  a.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(t.element.classList.contains("tip-hidden")).toBe(true);
  t.element.dispatchEvent(new Event("mouseleave"));
  expect(t.element.classList.contains("tip-hidden")).toBe(false);
});

test("the static tip is visible in the page", () => {
  const s = createStaticTooltip("Copy link");
  expect(s.className).toBe("tip static");
  expect(s.getAttribute("role")).toBe("tooltip");
});
