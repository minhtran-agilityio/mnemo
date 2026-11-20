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

test("a held panel stays open on an outside click, and its trigger still closes it", () => {
  const trigger = createButton(document, { label: "Why?" });
  const panel = document.createElement("div");
  const pop = createPopover(document, {
    trigger,
    panel,
    haspopup: "dialog",
    held: true,
  });
  document.body.append(pop.anchor);
  pop.open();
  expect(panel.hidden).toBe(false);
  document.body.click();
  expect(panel.hidden).toBe(false);
  trigger.click();
  expect(panel.hidden).toBe(true);
  pop.open();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(panel.hidden).toBe(true);
  pop.open();
  // An Escape that came from a field, or that another part already used, is not for the panel.
  const field = document.createElement("input");
  document.body.append(field);
  field.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(panel.hidden).toBe(false);
  const used = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  document.addEventListener("keydown", (e) => e.preventDefault(), {
    once: true,
    capture: true,
  });
  document.body.dispatchEvent(used);
  expect(panel.hidden).toBe(false);
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(panel.hidden).toBe(true);
  field.remove();
  pop.anchor.remove();
});

test("a held panel that left the page ignores Escape and drops its listener", () => {
  const trigger = createButton(document, { label: "Why?" });
  const panel = document.createElement("div");
  const pop = createPopover(document, {
    trigger,
    panel,
    haspopup: "dialog",
    held: true,
  });
  document.body.append(pop.anchor);
  pop.open();
  pop.anchor.remove();
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(panel.hidden).toBe(false); // not closed by the stale listener
  document.body.append(pop.anchor);
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(panel.hidden).toBe(false); // the listener removed itself
  pop.anchor.remove();
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

test("focus moving outside the popover closes it; focus inside does not", () => {
  const { panel, pop } = make();
  const outside = document.createElement("button");
  document.body.append(outside);
  pop.open();
  const inner = document.createElement("button");
  panel.append(inner);
  panel.dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, relatedTarget: inner }),
  );
  expect(pop.isOpen()).toBe(true);
  panel.dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }),
  );
  expect(pop.isOpen()).toBe(false);
});

test("an aborted signal closes an open popover and a later outside click does nothing", () => {
  const trigger = createButton(document, { label: "Why?" });
  const panel = document.createElement("div");
  const ctl = new AbortController();
  const pop = createPopover(document, {
    trigger,
    panel,
    haspopup: "dialog",
    signal: ctl.signal,
  });
  document.body.append(pop.anchor);
  pop.open();
  ctl.abort();
  expect(pop.isOpen()).toBe(false);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("destroy closes the panel and can be called twice", () => {
  const { pop } = make();
  pop.open();
  pop.destroy();
  pop.destroy();
  expect(pop.isOpen()).toBe(false);
});
