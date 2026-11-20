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

const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }),
  );

test("with the drag option the plain arrows move the card, and Alt+Arrow still does", () => {
  const board = createKanbanBoard(
    document,
    "Board",
    [
      { name: "To do", cards: [card("A")] },
      { name: "Doing", cards: [] },
      { name: "Done", cards: [] },
    ],
    { drag: true },
  );
  document.body.append(board);
  const a = board.querySelector(".kcard") as HTMLElement;
  const cols = board.querySelectorAll(".kcol");
  key(a, "ArrowRight");
  expect(cols[1].contains(a)).toBe(true);
  key(a, "ArrowRight", { altKey: true });
  expect(cols[2].contains(a)).toBe(true);
  key(a, "ArrowLeft", { shiftKey: true });
  expect(cols[2].contains(a)).toBe(true);
  key(a, "ArrowLeft");
  expect(cols[1].contains(a)).toBe(true);
  board.remove();
});

test("with the drag option a pointer drag drops the card in the column under it", () => {
  const board = createKanbanBoard(
    document,
    "Board",
    [
      { name: "To do", cards: [card("A")] },
      { name: "Doing", cards: [] },
    ],
    { drag: true },
  );
  document.body.append(board);
  const a = board.querySelector(".kcard") as HTMLElement;
  const cols = board.querySelectorAll<HTMLElement>(".kcol");
  document.elementsFromPoint = () => [cols[1]];
  const ptr = (type: string, x: number) =>
    a.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        clientX: x,
        clientY: 5,
        button: 0,
      }),
    );
  ptr("pointerdown", 0);
  expect(a.classList.contains("is-dragging")).toBe(true);
  ptr("pointermove", 50);
  expect(cols[1].classList.contains("is-over")).toBe(true);
  ptr("pointerup", 50);
  expect(cols[1].contains(a)).toBe(true);
  expect(a.classList.contains("is-dragging")).toBe(false);
  expect(a.style.transform).toBe("");
  expect(board.querySelector(".board-live")?.textContent).toBe(
    'Moved "A" to Doing.',
  );
  board.remove();
});

test("a pointer drop on the same column or a cancel moves nothing", () => {
  const board = createKanbanBoard(
    document,
    "Board",
    [
      { name: "To do", cards: [card("A")] },
      { name: "Doing", cards: [] },
    ],
    { drag: true },
  );
  document.body.append(board);
  const a = board.querySelector(".kcard") as HTMLElement;
  const cols = board.querySelectorAll<HTMLElement>(".kcol");
  const ptr = (type: string) =>
    a.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
  document.elementsFromPoint = () => [cols[0]];
  ptr("pointerdown");
  ptr("pointerup");
  expect(cols[0].contains(a)).toBe(true);
  document.elementsFromPoint = () => [cols[1]];
  ptr("pointerdown");
  ptr("pointercancel");
  expect(cols[0].contains(a)).toBe(true);
  expect(a.classList.contains("is-dragging")).toBe(false);
  board.remove();
});

test("a no-move board never moves a card, by key or pointer, and cards open", () => {
  let opened = "";
  const idea = (t: string) =>
    createKanbanCard(document, {
      title: t,
      current: true,
      onOpen: () => {
        opened = t;
      },
    });
  const wrap = createKanbanBoard(
    document,
    "Ideas",
    [
      { name: "Spark", cards: [idea("A")], emptyText: "No idea here yet." },
      { name: "Shape", cards: [], emptyText: "No idea here yet." },
    ],
    { move: false },
  );
  document.body.append(wrap);
  const a = wrap.querySelector(".kcard") as HTMLElement;
  const cols = wrap.querySelectorAll<HTMLElement>(".kcol");
  for (const init of [{ altKey: true }, {}]) {
    a.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  }
  a.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  expect(a.classList.contains("is-dragging")).toBe(false);
  expect(cols[0].contains(a)).toBe(true);
  expect(wrap.querySelector(".board-live")).toBeNull();
  expect(wrap.classList).toContain("board-fixed");
  expect(cols[1].querySelector(".empty")?.textContent).toBe(
    "No idea here yet.",
  );
  expect(a.getAttribute("aria-current")).toBe("true");
  a.click();
  expect(opened).toBe("A");
  wrap.remove();
});
