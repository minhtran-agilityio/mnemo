// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createSearch, createTextarea, createTextInput } from "./input";

test("a text input keeps the .input class, type, value and placeholder", () => {
  const i = createTextInput(document, {
    type: "url",
    value: "<x>",
    placeholder: "https://",
  });
  expect(i.className).toBe("input");
  expect(i.type).toBe("url");
  expect(i.value).toBe("<x>");
  expect(i.placeholder).toBe("https://");
  expect(i.id).not.toBe("");
});

test("disabled and forced states", () => {
  const i = createTextInput(document, { disabled: true, forced: "focus" });
  expect(i.disabled).toBe(true);
  expect(i.classList.contains("is-focus")).toBe(true);
});

test("two inputs get different ids", () => {
  expect(createTextInput(document).id).not.toBe(createTextInput(document).id);
});

test("a textarea takes its value as text and can be disabled", () => {
  const t = createTextarea(document, { value: "<b>note</b>", disabled: true });
  expect(t.className).toBe("textarea");
  expect(t.value).toBe("<b>note</b>");
  expect(t.disabled).toBe(true);
});

test("a search field has a type=search input and a hidden magnifier", () => {
  const { wrap, input } = createSearch(document, { placeholder: "Search" });
  expect(wrap.className).toBe("search");
  expect(input.type).toBe("search");
  expect(wrap.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
});
