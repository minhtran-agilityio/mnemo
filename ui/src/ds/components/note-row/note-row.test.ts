// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createNoteRow } from "./note-row";

test("it shows the title and meta as text", () => {
  const row = createNoteRow(document, {
    title: "<i>FTS5</i>",
    meta: "Edited 2 d ago",
  });
  expect(row.querySelector(".row-title")?.textContent).toBe("<i>FTS5</i>");
  expect(row.querySelector("i")).toBeNull();
  expect(row.querySelector(".row-sub")?.textContent).toBe("Edited 2 d ago");
  expect(row.tabIndex).toBe(0);
  expect(row.textContent).not.toContain("Written by AI");
});

test("a note written by AI says so in text", () => {
  const row = createNoteRow(document, { title: "A", meta: "B", byAi: true });
  expect(row.querySelector(".rec-flag-ai")?.textContent).toBe("Written by AI");
});
