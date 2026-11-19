// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createMultiSelect, createSelect } from "./select";

test("a select lists its options as text and keeps the .select class", () => {
  const { wrap, select } = createSelect(document, {
    options: ["Inbox", "<b>Work</b>"],
    value: "Inbox",
  });
  expect(select.className).toBe("select");
  expect([...select.options].map((o) => o.textContent)).toEqual([
    "Inbox",
    "<b>Work</b>",
  ]);
  expect(select.value).toBe("Inbox");
  expect(wrap.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
});

test("a select can be disabled", () => {
  expect(
    createSelect(document, { options: ["a"], disabled: true }).select.disabled,
  ).toBe(true);
});

test("a many select says how many are chosen and updates on change", () => {
  const m = createMultiSelect(document, {
    label: "Labels",
    options: [{ label: "research", checked: true }, { label: "to read" }],
    summarise: (n) => `${n} labels`,
  });
  document.body.append(m.anchor);
  const trigger = m.anchor.querySelector("button") as HTMLButtonElement;
  expect(trigger.textContent).toBe("1 labels");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  trigger.click();
  expect(
    m.anchor.querySelector('[role="group"]')?.getAttribute("aria-label"),
  ).toBe("Labels");
  const boxes = m.anchor.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  const second = boxes[1] as HTMLInputElement;
  second.checked = true;
  second.dispatchEvent(new Event("change", { bubbles: true }));
  expect(trigger.textContent).toBe("2 labels");
  expect(m.chosen()).toEqual(["research", "to read"]);
});
