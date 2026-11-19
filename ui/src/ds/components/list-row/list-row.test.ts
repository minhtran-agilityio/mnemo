// @vitest-environment happy-dom
import { Link } from "lucide";
import { expect, test } from "vitest";
import { createListRow } from "./list-row";

test("it renders the title and meta as text and keeps the full title in the tooltip", () => {
  const li = createListRow(document, {
    title: "<b>Long</b> title",
    meta: "2 d",
  });
  expect(li.className).toBe("row");
  expect(li.querySelector(".row-title")?.textContent).toBe("<b>Long</b> title");
  expect(li.querySelector("b")).toBeNull();
  expect(li.querySelector<HTMLElement>(".row-title")?.title).toBe(
    "<b>Long</b> title",
  );
  expect(li.querySelector(".row-meta")?.textContent).toBe("2 d");
  expect(li.tabIndex).toBe(0);
});

test("a second line and an icon are optional", () => {
  const li = createListRow(document, { title: "A", sub: "B", icon: Link });
  expect(li.querySelector(".row-sub")?.textContent).toBe("B");
  expect(li.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
});

test("an option row carries aria-selected and is not in the tab order", () => {
  const on = createListRow(document, {
    title: "A",
    role: "option",
    selected: true,
  });
  const off = createListRow(document, { title: "B", role: "option" });
  expect(on.getAttribute("role")).toBe("option");
  expect(on.getAttribute("aria-selected")).toBe("true");
  expect(off.getAttribute("aria-selected")).toBe("false");
  expect(off.tabIndex).toBe(-1);
});

test("a forced state adds its class", () => {
  expect(
    createListRow(document, { title: "A", forceState: "hover" }).classList,
  ).toContain("is-hover");
});
