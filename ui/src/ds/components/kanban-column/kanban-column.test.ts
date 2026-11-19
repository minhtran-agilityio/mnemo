// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { createKanbanCard } from "../kanban-card/kanban-card";
import { createKanbanBoard, createKanbanColumn } from "./kanban-column";

const card = (t: string) => createKanbanCard(document, { title: t });

test("a column shows its name, a count and the empty hint only when empty", () => {
  const full = createKanbanColumn(document, {
    name: "To do",
    cards: [card("A"), card("B")],
  });
  expect(full.querySelector("h4")?.textContent).toBe("To do2");
  expect(full.querySelector<HTMLElement>(".empty")?.hidden).toBe(true);
  const none = createKanbanColumn(document, {
    name: "Done",
    cards: [],
    emptyText: "Nothing done yet.",
  });
  expect(none.querySelector(".empty")?.textContent).toBe("Nothing done yet.");
  expect(none.querySelector<HTMLElement>(".empty")?.hidden).toBe(false);
});

test("the drop-over state adds a class", () => {
  expect(
    createKanbanColumn(document, { name: "Doing", cards: [], over: true })
      .classList,
  ).toContain("is-over");
});

test("Alt+Right moves the focused card to the next column and says so", () => {
  const board = createKanbanBoard(document, "Board", [
    { name: "To do", cards: [card("A")] },
    { name: "Doing", cards: [], over: true },
  ]);
  document.body.append(board);
  const a = board.querySelector(".kcard") as HTMLElement;
  a.focus();
  a.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowRight",
      altKey: true,
      bubbles: true,
    }),
  );
  const cols = board.querySelectorAll(".kcol");
  expect(cols[1].contains(a)).toBe(true);
  expect(cols[0].querySelector<HTMLElement>(".empty")?.hidden).toBe(false);
  expect(cols[1].classList.contains("is-over")).toBe(false);
  expect(board.querySelector(".board-live")?.textContent).toBe(
    'Moved "A" to Doing.',
  );
  expect(document.activeElement).toBe(a);
  a.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowRight",
      altKey: true,
      bubbles: true,
    }),
  );
  expect(cols[1].contains(a)).toBe(true);
  board.remove();
});

test("arrows without Alt do nothing", () => {
  const board = createKanbanBoard(document, "Board", [
    { name: "To do", cards: [card("A")] },
    { name: "Doing", cards: [] },
  ]);
  const a = board.querySelector(".kcard") as HTMLElement;
  a.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  expect(board.querySelectorAll(".kcol")[0].contains(a)).toBe(true);
});
