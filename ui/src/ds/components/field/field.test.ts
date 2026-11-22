// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createTextInput } from "../input/input";
import { createField, setFieldError } from "./field";

function build(hint?: string) {
  const input = createTextInput(document, { value: "60" });
  const f = createField(document, {
    label: "Warn at (%)",
    control: input,
    hint,
  });
  document.body.append(f);
  return { input, f };
}

test("setFieldError shows an error in place and keeps focus", () => {
  const { input, f } = build("Between 1 and 99.");
  input.focus();
  setFieldError(f, "The warn line must be lower than the pause line.");
  expect(document.activeElement).toBe(input);
  expect(f.contains(input)).toBe(true);
  expect(f.querySelector(".hint")).toBeNull();
  const err = f.querySelector(".err-text");
  expect(err?.textContent).toBe(
    "The warn line must be lower than the pause line.",
  );
  expect(err?.querySelector("svg")).not.toBeNull();
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe(err?.id);
  f.remove();
});

test("setFieldError(null) brings the hint back and clears aria-invalid", () => {
  const { input, f } = build("Between 1 and 99.");
  input.focus();
  setFieldError(f, "Bad");
  setFieldError(f, null);
  expect(document.activeElement).toBe(input);
  expect(f.querySelector(".err-text")).toBeNull();
  const hint = f.querySelector(".hint");
  expect(hint?.textContent).toBe("Between 1 and 99.");
  expect(input.hasAttribute("aria-invalid")).toBe(false);
  expect(input.getAttribute("aria-describedby")).toBe(hint?.id);
  f.remove();
});

test("a field with no hint has no description after the error is cleared", () => {
  const { input, f } = build();
  setFieldError(f, "Bad");
  setFieldError(f, null);
  expect(f.querySelector(".hint")).toBeNull();
  expect(input.hasAttribute("aria-describedby")).toBe(false);
  expect(input.hasAttribute("aria-invalid")).toBe(false);
  f.remove();
});

test("setting the error twice keeps one error with the new long text", () => {
  const { input, f } = build("Hint");
  setFieldError(f, "First");
  setFieldError(
    f,
    "A long error that wraps onto a second line because it keeps going and going.",
  );
  expect(f.querySelectorAll(".err-text")).toHaveLength(1);
  expect(f.querySelector(".err-text")?.textContent).toContain("keeps going");
  expect(input.getAttribute("aria-describedby")).toBe(
    f.querySelector(".err-text")?.id,
  );
  setFieldError(f, "");
  expect(f.querySelector(".hint")?.textContent).toBe("Hint");
  f.remove();
});

test("a field created with an error can be cleared", () => {
  const input = createTextInput(document, {});
  const f = createField(document, {
    label: "L",
    control: input,
    hint: "H",
    error: "E",
  });
  setFieldError(f, null);
  expect(f.querySelector(".hint")?.textContent).toBe("H");
  expect(input.hasAttribute("aria-invalid")).toBe(false);
});

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

test("createField leaves what the caller set when there is no hint or error", () => {
  const input = createTextInput(document, {});
  input.setAttribute("aria-describedby", "own-help");
  input.setAttribute("aria-invalid", "true");
  const f = createField(document, { label: "L", control: input });
  expect(input.getAttribute("aria-describedby")).toBe("own-help");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  setFieldError(f, "Bad");
  setFieldError(f, null);
  expect(input.getAttribute("aria-describedby")).toBe("own-help");
  expect(input.getAttribute("aria-invalid")).toBe("true");
});

test("the error sits in a stable polite live region and updates in place", () => {
  const { f } = build("Hint");
  const note = f.querySelector("[aria-live]");
  expect(note?.getAttribute("aria-live")).toBe("polite");
  setFieldError(f, "First");
  const err = f.querySelector(".err-text");
  expect(note?.contains(err ?? null)).toBe(true);
  setFieldError(f, "Second");
  expect(f.querySelector(".err-text")).toBe(err);
  expect(err?.textContent).toBe("Second");
  expect(err?.querySelector("svg")).not.toBeNull();
  expect(f.querySelector("[aria-live]")).toBe(note);
  f.remove();
});

test("setFieldError throws for an element that is not a field", () => {
  expect(() => setFieldError(document.createElement("div"), "x")).toThrow();
});
