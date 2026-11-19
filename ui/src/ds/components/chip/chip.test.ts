// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { createChip } from "./chip";

test("a chip is a button with aria-pressed and text label", () => {
  const c = createChip(document, { label: "<i>Zalo</i>" });
  expect(c.type).toBe("button");
  expect(c.getAttribute("aria-pressed")).toBe("false");
  expect(c.textContent).toBe("<i>Zalo</i>");
  expect(c.querySelector("svg")).toBeNull();
});

test("pressed shows a check mark besides the colour", () => {
  const c = createChip(document, { label: "Telegram", pressed: true });
  expect(c.getAttribute("aria-pressed")).toBe("true");
  expect(c.querySelector("svg")).not.toBeNull();
});

test("click toggles and calls onChange; the forced hover look is dropped", () => {
  const onChange = vi.fn();
  const c = createChip(document, { label: "Slack", forced: "hover", onChange });
  c.click();
  expect(c.getAttribute("aria-pressed")).toBe("true");
  expect(c.classList.contains("is-hover")).toBe(false);
  expect(onChange).toHaveBeenCalledWith(true);
});

test("a disabled chip stays off", () => {
  const c = createChip(document, { label: "Gmail", disabled: true });
  c.click();
  expect(c.getAttribute("aria-pressed")).toBe("false");
});
