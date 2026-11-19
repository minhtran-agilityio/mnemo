// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { createSegmented } from "./segmented";

function make(onChange?: (v: string) => void) {
  const g = createSegmented(document, {
    label: "Sort by",
    options: ["Newest", "Oldest", "A to Z"],
    onChange,
  });
  document.body.append(g);
  return { g, radios: [...g.querySelectorAll<HTMLElement>('[role="radio"]')] };
}

test("it is a radiogroup with a name and the first option checked", () => {
  const { g, radios } = make();
  expect(g.getAttribute("role")).toBe("radiogroup");
  expect(g.getAttribute("aria-label")).toBe("Sort by");
  expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual([
    "true",
    "false",
    "false",
  ]);
  expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
});

test("click checks one and unchecks the others", () => {
  const onChange = vi.fn();
  const { radios } = make(onChange);
  radios[2]?.click();
  expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual([
    "false",
    "false",
    "true",
  ]);
  expect(onChange).toHaveBeenCalledWith("A to Z");
});

test("arrow keys move focus and check, and wrap", () => {
  const { radios } = make();
  radios[0]?.focus();
  radios[0]?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
  );
  expect(document.activeElement).toBe(radios[2]);
  expect(radios[2]?.getAttribute("aria-checked")).toBe("true");
  radios[2]?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  expect(document.activeElement).toBe(radios[0]);
});
