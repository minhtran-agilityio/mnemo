// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createPageHeader } from "./heading-bar";

test("it shows crumb, title, context and actions as text", () => {
  const action = document.createElement("button");
  const header = createPageHeader({
    crumb: "Library",
    title: "<b>Bookmarks</b>",
    context: "1,284 links",
    actions: [action],
  });
  expect(header.querySelector(".crumb")?.textContent).toBe("Library");
  expect(header.querySelector("h2")?.textContent).toBe("<b>Bookmarks</b>");
  expect(header.querySelector("b")).toBeNull();
  expect(header.querySelector(".context")?.textContent).toBe("1,284 links");
  expect(header.querySelector(".pagehead-actions")?.contains(action)).toBe(
    true,
  );
});

test("crumb, context and actions are optional", () => {
  const header = createPageHeader({ title: "Notes" });
  expect(header.querySelector(".crumb")).toBeNull();
  expect(header.querySelector(".context")).toBeNull();
  expect(header.querySelector(".pagehead-actions")).toBeNull();
});
