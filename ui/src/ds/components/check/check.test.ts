// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { createCheckbox, createRadioGroup } from "./check";

test("a checkbox label is text and the input sits inside the label", () => {
  const c = createCheckbox(document, { label: "<b>On</b>", checked: true });
  expect(c.label.className).toBe("check");
  expect(c.text.textContent).toBe("<b>On</b>");
  expect(c.input.type).toBe("checkbox");
  expect(c.input.checked).toBe(true);
  expect(c.label.contains(c.input)).toBe(true);
});

test("mixed sets indeterminate; disabled disables", () => {
  const c = createCheckbox(document, {
    label: "Some",
    mixed: true,
    disabled: true,
  });
  expect(c.input.indeterminate).toBe(true);
  expect(c.input.disabled).toBe(true);
});

test("onChange gets the new checked value", () => {
  const onChange = vi.fn();
  const c = createCheckbox(document, { label: "x", onChange });
  c.input.checked = true;
  c.input.dispatchEvent(new Event("change"));
  expect(onChange).toHaveBeenCalledWith(true);
});

test("a radio group is a fieldset with a legend and one name", () => {
  const g = createRadioGroup(document, {
    legend: "Save to",
    name: "dest",
    options: [
      { label: "Inbox", value: "inbox", checked: true },
      { label: "Shared (Later)", value: "shared", disabled: true },
    ],
  });
  expect(g.tagName).toBe("FIELDSET");
  expect(g.querySelector("legend")?.textContent).toBe("Save to");
  const radios = g.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  expect([...radios].every((r) => r.name === "dest")).toBe(true);
  expect(radios[0]?.checked).toBe(true);
  expect(radios[1]?.disabled).toBe(true);
});
