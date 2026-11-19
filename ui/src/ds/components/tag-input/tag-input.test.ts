// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { createTagInput } from "./tag-input";

function key(input: HTMLInputElement, k: string) {
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
  );
}

test("starting tags render as text with a named remove button", () => {
  const t = createTagInput(document, { tags: ["rust", "<b>x</b>"] });
  expect(t.tags()).toEqual(["rust", "<b>x</b>"]);
  expect(t.wrap.querySelector("b")).toBeNull();
  expect(t.wrap.querySelector("button")?.getAttribute("aria-label")).toBe(
    "Remove tag rust",
  );
});

test("Enter adds a trimmed tag and clears the box; an empty box adds nothing", () => {
  const onChange = vi.fn();
  const t = createTagInput(document, { onChange });
  key(t.input, "Enter");
  expect(t.tags()).toEqual([]);
  t.input.value = "  tauri ";
  key(t.input, "Enter");
  expect(t.tags()).toEqual(["tauri"]);
  expect(t.input.value).toBe("");
  expect(onChange).toHaveBeenCalledWith(["tauri"]);
});

test("Backspace on an empty box removes the last tag; with text it does not", () => {
  const t = createTagInput(document, { tags: ["a", "b"] });
  t.input.value = "x";
  key(t.input, "Backspace");
  expect(t.tags()).toEqual(["a", "b"]);
  t.input.value = "";
  key(t.input, "Backspace");
  expect(t.tags()).toEqual(["a"]);
});

test("the remove button removes its tag and returns focus to the box", () => {
  const t = createTagInput(document, { tags: ["a", "b"] });
  document.body.append(t.wrap);
  t.wrap.querySelector("button")?.click();
  expect(t.tags()).toEqual(["b"]);
  expect(document.activeElement).toBe(t.input);
});
