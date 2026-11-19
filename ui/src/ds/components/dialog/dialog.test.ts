// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { createDialog, createDialogButton, createDialogSample } from "./dialog";

afterEach(() => {
  document.body.innerHTML = "";
});

function setup() {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const onClose = vi.fn();
  const h = createDialog({
    title: "<b>Rename</b>",
    onClose,
    children: [Object.assign(document.createElement("input"), { id: "in" })],
    actions: (close) => [
      createDialogButton("Cancel", "default", close),
      createDialogButton("Rename", "primary"),
    ],
  });
  return { opener, h, onClose };
}
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );

test("it is labelled by its title, and the title is text", () => {
  const { h, opener } = setup();
  h.open(opener);
  const title = h.element.querySelector("h3") as HTMLElement;
  expect(title.textContent).toBe("<b>Rename</b>");
  expect(h.element.querySelector("b")).toBeNull();
  expect(h.element.getAttribute("aria-labelledby")).toBe(title.id);
  expect(h.isOpen()).toBe(true);
});

test("focus moves inside on open, and Tab wraps at both ends", () => {
  const { h, opener } = setup();
  h.open(opener);
  const [input, cancel, rename] = [
    h.element.querySelector("input"),
    ...h.element.querySelectorAll("button"),
  ] as HTMLElement[];
  expect(document.activeElement).toBe(input);
  (rename as HTMLElement).focus();
  key(rename as HTMLElement, "Tab");
  expect(document.activeElement).toBe(input);
  key(input as HTMLElement, "Tab", { shiftKey: true });
  expect(document.activeElement).toBe(rename);
  expect(cancel).toBeTruthy();
});

test("Escape closes and focus returns to the opener", async () => {
  const { h, opener, onClose } = setup();
  h.open(opener);
  key(h.element, "Escape");
  await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(h.isOpen()).toBe(false);
  expect(document.activeElement).toBe(opener);
  expect(h.element.isConnected).toBe(false);
});

test("the Cancel button closes it", async () => {
  const { h, opener, onClose } = setup();
  h.open(opener);
  (h.element.querySelector(".dlg-actions button") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(document.activeElement).toBe(opener);
});

test("a form dialog runs onSubmit and closes", async () => {
  const onSubmit = vi.fn();
  const h = createDialog({ title: "T", form: { onSubmit } });
  h.open(null);
  h.element
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  expect(onSubmit).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(h.isOpen()).toBe(false));
});

test("a lead line sits above the title", () => {
  const lead = document.createElement("div");
  const h = createDialog({ title: "T", lead });
  expect(h.element.querySelector(".dlg")?.firstChild).toBe(lead);
});

test("the button kinds map to the button classes", () => {
  expect(createDialogButton("x", "primary").className).toBe("btn btn-primary");
  expect(createDialogButton("x", "danger").className).toBe("btn btn-danger");
  expect(createDialogButton("x", "default").type).toBe("button");
});

test("the sample is a labelled group, not a dialog", () => {
  const s = createDialogSample({ title: "T", label: "Example" });
  expect(s.getAttribute("role")).toBe("group");
  expect(s.getAttribute("aria-label")).toBe("Example");
  expect(s.classList.contains("dlg-static")).toBe(true);
});
