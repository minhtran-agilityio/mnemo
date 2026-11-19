// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { createPopover } from "./popover";

afterEach(() => {
  document.body.innerHTML = "";
});

function make() {
  const p = createPopover({
    trigger: "Why?",
    label: "Why",
    children: [document.createTextNode("Because")],
  });
  document.body.append(p.element);
  return p;
}

test("closed at first, with the aria links", () => {
  const p = make();
  expect(p.panel.hidden).toBe(true);
  expect(p.trigger.getAttribute("aria-expanded")).toBe("false");
  expect(p.trigger.getAttribute("aria-controls")).toBe(p.panel.id);
  expect(p.trigger.getAttribute("aria-haspopup")).toBe("dialog");
  expect(p.panel.getAttribute("role")).toBe("dialog");
});

test("click opens, Escape closes and returns focus", () => {
  const p = make();
  p.trigger.click();
  expect(p.panel.hidden).toBe(false);
  expect(p.trigger.getAttribute("aria-expanded")).toBe("true");
  p.panel.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(p.panel.hidden).toBe(true);
  expect(document.activeElement).toBe(p.trigger);
});

test("a click outside closes", () => {
  const p = make();
  p.trigger.click();
  document.body.click();
  expect(p.isOpen()).toBe(false);
});
