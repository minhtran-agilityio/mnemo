// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createTextInput } from "../input/input";
import { createField } from "./field";

test("the label points at the control and its text is text", () => {
  const input = createTextInput(document, { type: "url" });
  const f = createField(document, { label: "<i>Link</i>", control: input });
  const label = f.querySelector("label");
  expect(label?.textContent).toBe("<i>Link</i>");
  expect(label?.htmlFor).toBe(input.id);
  expect(f.className).toBe("field");
});

test("a hint is linked with aria-describedby", () => {
  const input = createTextInput(document, {});
  const f = createField(document, {
    label: "Link",
    control: input,
    hint: "Paste any web address.",
  });
  const hint = f.querySelector(".hint");
  expect(hint?.textContent).toBe("Paste any web address.");
  expect(input.getAttribute("aria-describedby")).toBe(hint?.id);
});

test("an error replaces the hint, marks the input invalid and shows an icon", () => {
  const input = createTextInput(document, {});
  const f = createField(document, {
    label: "Link",
    control: input,
    hint: "Hint",
    error: "This is not a web address.",
  });
  expect(f.querySelector(".hint")).toBeNull();
  const err = f.querySelector(".err-text");
  expect(err?.textContent).toBe("This is not a web address.");
  expect(err?.querySelector("svg")).not.toBeNull();
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe(err?.id);
});
