// A kanban board: columns of cards. Focus a card, then Alt+Left or Alt+Right moves it to the next
// column and says so in a live region. An empty column shows a hint. `over` draws the drop-target
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

export function createKanbanBoard(
  doc: Document,
  label: string,
  columns: readonly KanbanColumnOptions[],
): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "board-wrap";
  const board = doc.createElement("div");
  board.className = "board";
  board.setAttribute("role", "group");
  board.setAttribute("aria-label", label);
  const cols = columns.map((c) => createKanbanColumn(doc, c));
  board.append(...cols);
  const live = doc.createElement("p");
  live.className = "board-live";
  live.setAttribute("aria-live", "polite");
  wrap.append(board, live);
  board.addEventListener("keydown", (e) => {
    const card = (e.target as Element).closest(".kcard");
    if (!card || !e.altKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const from = cols.indexOf(card.closest(".kcol") as HTMLElement);
    const to = e.key === "ArrowRight" ? from + 1 : from - 1;
    if (from < 0 || to < 0 || to >= cols.length) return;
    e.preventDefault();
    for (const c of cols) c.classList.remove("is-over");
    cols[to].querySelector("[data-cards]")?.append(card);
    (card as HTMLElement).focus();
    for (const c of cols) syncColumn(c);
    live.textContent = `Moved "${cardTitle(card)}" to ${cols[to].dataset.col}.`;
  });
  return wrap;
}
