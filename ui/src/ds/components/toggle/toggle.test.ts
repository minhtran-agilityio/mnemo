// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { createToggle } from "./toggle";

test("a toggle is a switch that starts off and says Off in words", () => {
  const t = createToggle(document, { label: "Daily digest" });
  expect(t.getAttribute("role")).toBe("switch");
  expect(t.getAttribute("aria-checked")).toBe("false");
  expect(t.querySelector(".state")?.textContent).toBe("Off");
  expect(t.textContent).toContain("Daily digest");
});

test("click flips aria-checked and the words, and calls onChange", () => {
  const onChange = vi.fn();
  const t = createToggle(document, { label: "x", onChange });
  t.click();
  expect(t.getAttribute("aria-checked")).toBe("true");
  expect(t.querySelector(".state")?.textContent).toBe("On");
  t.click();
  expect(onChange.mock.calls).toEqual([[true], [false]]);
});

test("disabled toggles do not flip", () => {
  const t = createToggle(document, { label: "x", disabled: true });
  t.click();
  expect(t.getAttribute("aria-checked")).toBe("false");
});
