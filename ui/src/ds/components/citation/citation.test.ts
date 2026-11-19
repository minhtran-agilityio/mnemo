// @vitest-environment happy-dom
import { expect, test } from "vitest";
import {
  createAnswer,
  createCite,
  createMissingCite,
  createSourceList,
} from "./citation";

test("a citation is a link named for its source", () => {
  const a = createCite(document, 2, "#s2");
  expect(a.textContent).toBe("2");
  expect(a.getAttribute("aria-label")).toBe("Source 2");
  expect(a.getAttribute("href")).toBe("#s2");
});

test("a missing source shows a question mark and is named No source", () => {
  const m = createMissingCite(document);
  expect(m.textContent).toBe("?");
  expect(m.className).toBe("cite missing");
  expect(m.getAttribute("aria-label")).toBe("No source");
});

test("the source list shows title, app and age as text, with the full title in a tooltip", () => {
  const ol = createSourceList(document, [
    { title: "<b>Backup</b>", app: "zalo", age: "3 h" },
    { title: "WAL", app: "github", age: "12 d" },
  ]);
  const items = ol.querySelectorAll("li");
  expect(items).toHaveLength(2);
  expect(items[0].querySelector(".src-title")?.textContent).toBe(
    "<b>Backup</b>",
  );
  expect(items[0].querySelector("b")).toBeNull();
  expect(items[0].querySelector<HTMLElement>(".src-title")?.title).toBe(
    "<b>Backup</b>",
  );
  expect(items[1].querySelector(".app")?.textContent).toBe("GitHub");
});

test("an answer keeps its text as text and holds the marks in order", () => {
  const p = createAnswer(document, [
    "Use <b>the API</b> ",
    createCite(document, 1),
    " not a copy ",
    createMissingCite(document),
  ]);
  expect(p.querySelector("b")).toBeNull();
  expect(p.textContent).toBe("Use <b>the API</b> 1 not a copy ?");
});
