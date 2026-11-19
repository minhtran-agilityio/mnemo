// @vitest-environment happy-dom
import { Plus } from "lucide";
import { expect, test, vi } from "vitest";
import { createButton, setButtonBusy } from "./button";

test("the label goes in as text, not markup", () => {
  const b = createButton(document, { label: "<b>Save</b>" });
  expect(b.textContent).toBe("<b>Save</b>");
  expect(b.querySelector("b")).toBeNull();
  expect(b.type).toBe("button");
  expect(b.className).toBe("btn");
});

test("variants, size and forced state become the prototype class names", () => {
  const b = createButton(document, {
    label: "Go",
    variant: "danger",
    size: "sm",
    forced: "hover",
  });
  expect(b.classList.contains("btn-danger")).toBe(true);
  expect(b.classList.contains("btn-sm")).toBe(true);
  expect(b.classList.contains("is-hover")).toBe(true);
});

test("an icon-only button has an accessible name and no visible text", () => {
  const b = createButton(document, {
    label: "More actions",
    icon: Plus,
    iconOnly: true,
  });
  expect(b.getAttribute("aria-label")).toBe("More actions");
  expect(b.textContent).toBe("");
  expect(b.classList.contains("btn-icon")).toBe(true);
  expect(b.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
});

test("disabled sets the disabled attribute", () => {
  const onClick = vi.fn();
  const b = createButton(document, { label: "Go", disabled: true, onClick });
  expect(b.disabled).toBe(true);
});

test("a busy button shows a spinner, sets aria-busy and ignores clicks", () => {
  const onClick = vi.fn();
  const options = { label: "Summarise", onClick };
  const b = createButton(document, { ...options, busy: true });
  expect(b.getAttribute("aria-busy")).toBe("true");
  expect(b.getAttribute("aria-disabled")).toBe("true");
  expect(b.querySelector(".spinner")).not.toBeNull();
  b.click();
  expect(onClick).not.toHaveBeenCalled();
  setButtonBusy(b, false, options);
  expect(b.hasAttribute("aria-busy")).toBe(false);
  expect(b.querySelector(".spinner")).toBeNull();
  b.click();
  expect(onClick).toHaveBeenCalledTimes(1);
});
