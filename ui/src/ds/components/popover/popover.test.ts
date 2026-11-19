// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createButton } from "../button/button";
import { createPopover } from "./popover";

function make() {
  const trigger = createButton(document, { label: "Why this folder?" });
  const panel = document.createElement("div");
  panel.className = "popover";
  panel.textContent = "Because.";
  const pop = createPopover(document, { trigger, panel, haspopup: "dialog" });
  document.body.append(pop.anchor);
  return { trigger, panel, pop };
}

test("starts closed and wires aria-expanded, aria-controls and aria-haspopup", () => {
  const { trigger, panel } = make();
  expect(panel.hidden).toBe(true);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
  expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
});

test("click opens, click again closes", () => {
  const { trigger, panel } = make();
  trigger.click();
  expect(panel.hidden).toBe(false);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  trigger.click();
  expect(panel.hidden).toBe(true);
});

test("Escape closes and returns focus to the trigger", () => {
  const { trigger, panel, pop } = make();
  pop.open();
  panel.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(pop.isOpen()).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

test("a click outside closes it", () => {
  const { pop } = make();
  pop.open();
  document.body.click();
  expect(pop.isOpen()).toBe(false);
});
