// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createPage } from "./column";

test("a page is a div with the page class and holds its children", () => {
  const p = document.createElement("p");
  const page = createPage({ children: [p] });
  expect(page.className).toBe("page");
  expect(page.firstChild).toBe(p);
});
