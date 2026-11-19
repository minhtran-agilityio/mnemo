// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createTagList } from "./tag-list";

test("it lists tags as text", () => {
  const ul = createTagList(document, ["rust", "<b>x</b>"]);
  const items = [...ul.querySelectorAll("li")];
  expect(items.map((i) => i.textContent)).toEqual(["rust", "<b>x</b>"]);
  expect(ul.querySelector("b")).toBeNull();
  expect(ul.getAttribute("aria-label")).toBe("Tags");
});

test("past the max the rest is one +N item that names the hidden tags", () => {
  const ul = createTagList(document, ["a", "b", "c", "d", "e"], { max: 2 });
  const more = ul.querySelector(".tag-more") as HTMLElement;
  expect(ul.querySelectorAll("li")).toHaveLength(3);
  expect(more.textContent).toBe("+3");
  expect(more.getAttribute("aria-label")).toBe("3 more tags");
  expect(more.title).toBe("c, d, e");
});
