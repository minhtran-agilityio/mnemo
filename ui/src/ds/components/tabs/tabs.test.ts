// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { createTabs } from "./tabs";

const key = (el: HTMLElement, k: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

function make(onSelect?: (id: string) => void) {
  const tabs = createTabs({
    label: "Note view",
    onSelect,
    tabs: [
      { id: "write", label: "Write" },
      { id: "preview", label: "Preview" },
      { id: "history", label: "History (Later)", disabled: true },
    ],
  });
  document.body.append(tabs.element);
  return tabs;
}
const buttons = (t: { element: HTMLElement }) => [
  ...t.element.querySelectorAll("button"),
];

afterEach(() => {
  document.body.innerHTML = "";
});

test("it is a labelled tablist with the first tab selected", () => {
  const t = make();
  expect(t.element.getAttribute("role")).toBe("tablist");
  expect(t.element.getAttribute("aria-label")).toBe("Note view");
  const [a, b] = buttons(t);
  expect(a?.getAttribute("aria-selected")).toBe("true");
  expect(a?.tabIndex).toBe(0);
  expect(b?.getAttribute("aria-selected")).toBe("false");
  expect(b?.tabIndex).toBe(-1);
});

test("a click selects and reports", () => {
  const seen: string[] = [];
  const t = make((id) => seen.push(id));
  buttons(t)[1]?.click();
  expect(t.selected()).toBe("preview");
  expect(seen).toEqual(["preview"]);
});

test("arrows wrap and skip the disabled tab; Home and End jump", () => {
  const t = make();
  const [a, b] = buttons(t) as HTMLButtonElement[];
  key(a as HTMLElement, "ArrowRight");
  expect(document.activeElement).toBe(b);
  key(b as HTMLElement, "ArrowRight");
  expect(document.activeElement).toBe(a);
  key(a as HTMLElement, "ArrowLeft");
  expect(document.activeElement).toBe(b);
  key(b as HTMLElement, "Home");
  expect(t.selected()).toBe("write");
  key(a as HTMLElement, "End");
  expect(t.selected()).toBe("preview");
});

test("a disabled tab cannot be selected", () => {
  const t = make();
  const hist = buttons(t)[2] as HTMLButtonElement;
  expect(hist.disabled).toBe(true);
  t.select("history");
  expect(t.selected()).toBe("write");
});
