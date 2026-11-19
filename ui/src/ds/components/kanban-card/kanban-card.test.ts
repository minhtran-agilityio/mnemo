// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { ref } from "../../catalog/types";
import { createKanbanCard } from "./kanban-card";

test("it renders the title and meta as text and can take focus", () => {
  const card = createKanbanCard(document, {
    title: "<b>Fonts</b>",
    meta: [ref(104), "2 d"],
  });
  expect(card.querySelector(".k-title")?.textContent).toBe("<b>Fonts</b>");
  expect(card.querySelector("b")).toBeNull();
  expect(card.querySelector<HTMLElement>(".k-title")?.title).toBe(
    "<b>Fonts</b>",
  );
  expect(card.querySelector(".meta")?.textContent).toContain(ref(104));
  expect(card.tabIndex).toBe(0);
});

test("forced states add their class", () => {
  for (const s of ["hover", "focus", "dragging"] as const) {
    expect(
      createKanbanCard(document, { title: "A", forceState: s }).classList,
    ).toContain(`is-${s}`);
  }
});

test("a working card says so as a status", () => {
  const card = createKanbanCard(document, { title: "A", working: true });
  expect(card.querySelector('[role="status"]')?.textContent).toBe("AI working");
});
