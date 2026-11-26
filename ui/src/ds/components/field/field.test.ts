// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createButton } from "../button/button";
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

test("the same message set twice changes nothing in the DOM", async () => {
  const { f } = build("Hint");
  setFieldError(f, "Same");
  const seen: MutationRecord[] = [];
  const observer = new MutationObserver((r) => seen.push(...r));
  observer.observe(f, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  setFieldError(f, "Same");
  setFieldError(f, "Same");
  await new Promise((r) => setTimeout(r, 0));
  seen.push(...observer.takeRecords());
  observer.disconnect();
  expect(seen).toHaveLength(0);
  f.remove();
});

test("the hint stays outside the live region, so it is not announced when it returns", () => {
  const { f } = build("Hint");
  const note = f.querySelector("[aria-live]");
  setFieldError(f, "Bad");
  setFieldError(f, null);
  const hint = f.querySelector(".hint");
  expect(hint).not.toBeNull();
  expect(note?.contains(hint ?? null)).toBe(false);
  expect(note?.children).toHaveLength(0);
  f.remove();
});

test("a detached field: the same message twice changes nothing in the DOM", async () => {
  const input = createTextInput(document, {});
  const f = createField(document, { label: "L", control: input, hint: "Hint" });
  setFieldError(f, "Same");
  const seen: MutationRecord[] = [];
  const observer = new MutationObserver((r) => seen.push(...r));
  observer.observe(f, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  setFieldError(f, "Same");
  setFieldError(f, "Same");
  await new Promise((r) => setTimeout(r, 0));
  seen.push(...observer.takeRecords());
  observer.disconnect();
  expect(seen).toHaveLength(0);
});

test("a message of only spaces clears the error", () => {
  const { input, f } = build("Hint");
  setFieldError(f, "Bad");
  setFieldError(f, "   ");
  expect(f.querySelector(".err-text")).toBeNull();
  expect(f.querySelector(".hint")?.textContent).toBe("Hint");
  expect(input.hasAttribute("aria-invalid")).toBe(false);
  f.remove();
});

// Field with an action beside its control.
function buildAction(options: { hint?: string; error?: string } = {}) {
  const input = createTextInput(document, { type: "url" });
  const save = createButton(document, {
    label: "Save link",
    variant: "primary",
  });
  save.type = "submit";
  const f = createField(document, {
    label: "Link",
    control: input,
    action: save,
    ...options,
  });
  const form = document.createElement("form");
  form.append(f);
  document.body.append(form);
  return { input, save, f, form };
}

test("an action sits beside the control in its own cell, the label above, the note under the control", () => {
  const { input, save, f, form } = buildAction({ hint: "A web link." });
  expect(f.classList.contains("field")).toBe(true);
  expect(f.classList.contains("field--action")).toBe(true);
  const kids = [...f.children].map((c) => c.className || c.tagName);
  expect(kids).toEqual([
    "LABEL",
    "field-control",
    "field-action",
    "field-under",
  ]);
  expect(f.querySelector(".field-control")?.contains(input)).toBe(true);
  expect(f.querySelector(".field-action")?.contains(save)).toBe(true);
  const under = f.querySelector(".field-under");
  expect(under?.querySelector(".hint")?.textContent).toBe("A web link.");
  expect(under?.querySelector("[aria-live=polite]")).not.toBeNull();
  // The hint is not inside the action or the control cell.
  expect(f.querySelector(".field-action .hint")).toBeNull();
  expect(f.querySelector(".field-control .hint")).toBeNull();
  form.remove();
});

test("the action is passed through untouched", () => {
  const { save, form } = buildAction({ hint: "H" });
  expect(save.className).toBe("btn btn-primary");
  expect(save.type).toBe("submit");
  expect(save.getAttribute("style")).toBeNull();
  expect(save.textContent).toBe("Save link");
  form.remove();
});

test("with an action the label still points at the control and the hint describes it", () => {
  const { input, f, form } = buildAction({ hint: "A web link." });
  expect(f.querySelector("label")?.htmlFor).toBe(input.id);
  expect(input.getAttribute("aria-describedby")).toBe(
    f.querySelector(".hint")?.id,
  );
  form.remove();
});

test("with an action an error replaces the hint under the control, and clearing brings it back", () => {
  const { input, f, form } = buildAction({ hint: "A web link." });
  const note = f.querySelector(".field-under > [aria-live]");
  setFieldError(f, "Paste a link first.");
  expect(f.querySelector(".hint")).toBeNull();
  expect(note?.querySelector(".err-text")?.textContent).toBe(
    "Paste a link first.",
  );
  expect(f.querySelector(".field-action .err-text")).toBeNull();
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe(
    note?.querySelector(".err-text")?.id,
  );
  // The live region is the same element, so the message is announced.
  expect(f.querySelector(".field-under > [aria-live]")).toBe(note);
  setFieldError(f, null);
  expect(f.querySelector(".field-under > .hint")?.textContent).toBe(
    "A web link.",
  );
  expect(f.querySelector(".field-under")?.firstElementChild?.className).toBe(
    "hint",
  );
  expect(input.hasAttribute("aria-invalid")).toBe(false);
  form.remove();
});

test("with an action and an error at the start, the hint can come back", () => {
  const { f, form } = buildAction({ hint: "H", error: "E" });
  expect(f.querySelector(".err-text")?.textContent).toBe("E");
  setFieldError(f, null);
  expect(f.querySelector(".field-under > .hint")?.textContent).toBe("H");
  form.remove();
});

test("with an action, Enter in the box submits the form through the button", () => {
  const { input, form, save } = buildAction({ hint: "H" });
  let submitted = 0;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitted += 1;
  });
  input.focus();
  expect(document.activeElement).toBe(input);
  // The box and the action are both reachable with Tab, in that order.
  const tabbable = [...form.querySelectorAll<HTMLElement>("input, button")];
  expect(tabbable).toEqual([input, save]);
  save.click();
  expect(submitted).toBe(1);
  form.remove();
});

test("a busy or disabled action stays the button's own", () => {
  const input = createTextInput(document, {});
  const save = createButton(document, {
    label: "Save link",
    variant: "primary",
    disabled: true,
  });
  const f = createField(document, { label: "L", control: input, action: save });
  expect(save.disabled).toBe(true);
  expect(f.querySelector(".field-action button")).toBe(save);
});

test("long content stays text in the hint and error of a field with an action", () => {
  const long =
    "Dán một liên kết web bắt đầu bằng http:// hoặc https://, ví dụ một bài viết. ".repeat(
      4,
    );
  const { f, form } = buildAction({ hint: long });
  expect(f.querySelector(".hint")?.textContent).toBe(long);
  setFieldError(f, `<b>${long}</b>`);
  expect(f.querySelector(".err-text b")).toBeNull();
  expect(f.querySelector(".err-text")?.textContent).toBe(`<b>${long}</b>`);
  form.remove();
});

test("a field without an action keeps its plain column", () => {
  const input = createTextInput(document, {});
  const f = createField(document, { label: "L", control: input, hint: "H" });
  expect(f.className).toBe("field");
  expect([...f.children].map((c) => c.className || c.tagName)).toEqual([
    "LABEL",
    "input",
    "hint",
    "field-note",
  ]);
});
