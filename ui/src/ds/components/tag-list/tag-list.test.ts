// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { cssRule, MARKS_ROOM } from "../../../css-rule";
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

// The Limits tab fix (issue 113): a long tag is cut with an ellipsis, keeps room for stacked marks, and keeps its 22px height.
test("a long tag is whole text in .tag-text, a nowrap ellipsis box with room for stacked marks, and the chip keeps its 22px height", () => {
  const tag = `${"ẪẬẲỖỮỰ".repeat(10)}${"t".repeat(80)}`;
  const ul = createTagList(document, [tag]);
  const li = ul.querySelector(".tag-item") as HTMLElement;
  expect(li.textContent).toBe(tag);
  expect(li.title).toBe(tag);
  expect(li.querySelector(":scope > .tag-text")?.textContent).toBe(tag);
  const text = cssRule(
    import.meta.dirname,
    "tag-list.css",
    ".tag-item .tag-text",
  );
  expect(text).toMatchObject(MARKS_ROOM);
  expect(text["text-overflow"]).toBe("ellipsis");
  expect(text["white-space"]).toBe("nowrap");
  expect(text.overflow).toBe("hidden");
  // The chip has no vertical padding and no clip: its height is the line height it always had.
  const chip = cssRule(import.meta.dirname, "tag-list.css", ".tag-item");
  expect(chip.padding).toBe("0 var(--space-2)");
  expect(chip["line-height"]).toBe("var(--leading-label)");
  expect(chip["max-width"]).toBe("100%");
  expect(chip.overflow).toBeUndefined();
  const list = cssRule(import.meta.dirname, "tag-list.css", ".tags");
  expect(list["max-width"]).toBe("100%");
});
