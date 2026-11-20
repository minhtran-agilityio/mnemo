// A kanban board: columns of cards. Focus a card, then Alt+Left or Alt+Right moves it to the next
// column and says so in a live region. With the `drag` option the plain arrows and the pointer move it too. An empty column shows a hint. `over` draws the drop-target
// state.
import "./kanban-column.css";

export interface KanbanColumnOptions {
  readonly name: string;
  readonly cards: readonly HTMLElement[];
  /** Draws the drop-target state. */
  readonly over?: boolean;
  /** Shown when the column has no card. */
  readonly emptyText?: string;
}

function cardTitle(card: Element): string {
  return card.querySelector(".k-title")?.textContent ?? "";
}

export function createKanbanColumn(
  doc: Document,
  options: KanbanColumnOptions,
): HTMLElement {
  const col = doc.createElement("section");
  col.className = options.over ? "kcol is-over" : "kcol";
  col.dataset.col = options.name;
  col.setAttribute("aria-label", options.name);
  const head = doc.createElement("h4");
  const name = doc.createElement("span");
  name.textContent = options.name;
  const count = doc.createElement("span");
  count.className = "kcol-count";
  count.dataset.n = "";
  head.append(name, count);
  const cards = doc.createElement("div");
  cards.className = "kcol-cards";
  cards.dataset.cards = "";
  cards.append(...options.cards);
  const empty = doc.createElement("div");
  empty.className = "empty";
  empty.dataset.empty = "";
  empty.textContent = options.emptyText ?? "Nothing here yet.";
  col.append(head, cards, empty);
  syncColumn(col);
  return col;
}

/** Updates the count and the empty hint of a column after a card moved. */
function syncColumn(col: Element) {
  const n = col.querySelectorAll(".kcard").length;
  const count = col.querySelector<HTMLElement>("[data-n]");
  if (count) count.textContent = String(n);
  const empty = col.querySelector<HTMLElement>("[data-empty]");
  if (empty) empty.hidden = n > 0;
}

/** Alt+Arrow always moves cards, plus the pointer and plain arrows with `drag`. `move: false` is the no-move board and cannot take `drag`. */
export type KanbanBoardOptions =
  | {
      /** Adds pointer drag between columns and the plain Left and Right arrows. Alt+Arrow always works. */
      readonly drag?: boolean;
      readonly move?: true;
    }
  | {
      /** The no-move board: no drag, no Alt+Arrow, no Arrow move. Cards only open. */
      readonly move: false;
      readonly drag?: never;
    };

export function createKanbanBoard(
  doc: Document,
  label: string,
  columns: readonly KanbanColumnOptions[],
  options: KanbanBoardOptions = {},
): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "board-wrap";
  const board = doc.createElement("div");
  board.className = "board";
  board.setAttribute("role", "group");
  board.setAttribute("aria-label", label);
  const movable = options.move !== false;
  if (!movable) wrap.classList.add("board-fixed");
  const cols = columns.map((c) => createKanbanColumn(doc, c));
  board.append(...cols);
  const live = doc.createElement("p");
  live.className = "board-live";
  live.setAttribute("aria-live", "polite");
  if (movable) wrap.append(board, live);
  else wrap.append(board);

  const colOf = (card: Element) =>
    cols.indexOf(card.closest(".kcol") as HTMLElement);
  /** Moves a card to the column at `to`, keeps focus on it and says so. */
  const move = (card: HTMLElement, to: number) => {
    for (const c of cols) c.classList.remove("is-over");
    cols[to].querySelector("[data-cards]")?.append(card);
    card.focus();
    for (const c of cols) syncColumn(c);
    live.textContent = `Moved "${cardTitle(card)}" to ${cols[to].dataset.col}.`;
  };

  board.addEventListener("keydown", (e) => {
    if (!movable) return;
    const card = (e.target as Element).closest<HTMLElement>(".kcard");
    if (!card) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!e.altKey && !options.drag) return;
    const from = colOf(card);
    const to = e.key === "ArrowRight" ? from + 1 : from - 1;
    if (from < 0 || to < 0 || to >= cols.length) return;
    e.preventDefault();
    move(card, to);
  });

  if (options.drag && movable) {
    board.addEventListener("pointerdown", (e) => {
      const card = (e.target as Element).closest<HTMLElement>(".kcard");
      if (!card || e.button !== 0) return;
      const from = colOf(card);
      const startX = e.clientX;
      const startY = e.clientY;
      card.setPointerCapture?.(e.pointerId);
      card.classList.add("is-dragging");
      const colAt = (x: number, y: number) => {
        const hit = doc
          .elementsFromPoint(x, y)
          .find((el) => !card.contains(el));
        return hit ? cols.indexOf(hit.closest(".kcol") as HTMLElement) : -1;
      };
      const clear = () => {
        for (const c of cols) c.classList.remove("is-over");
      };
      const onMove = (m: PointerEvent) => {
        card.style.transform = `translate(${m.clientX - startX}px, ${m.clientY - startY}px)`;
        clear();
        cols[colAt(m.clientX, m.clientY)]?.classList.add("is-over");
      };
      const finish = () => {
        card.removeEventListener("pointermove", onMove);
        card.removeEventListener("pointerup", onUp);
        card.removeEventListener("pointercancel", finish);
        card.removeEventListener("lostpointercapture", finish);
        card.style.transform = "";
        card.classList.remove("is-dragging");
        clear();
      };
      const onUp = (u: PointerEvent) => {
        const to = colAt(u.clientX, u.clientY);
        finish();
        if (to >= 0 && to !== from) move(card, to);
      };
      card.addEventListener("pointermove", onMove);
      card.addEventListener("pointerup", onUp);
      // A cancelled gesture is not a drop: put the card back and move nothing.
      card.addEventListener("pointercancel", finish);
      card.addEventListener("lostpointercapture", finish);
    });
  }
  return wrap;
}
