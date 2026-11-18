import { buildCard, type CardData } from "../../ui/src/shared/card";
import { createStore } from "../../ui/src/shared/store";
import "./style.css";

type Column = { id: string; title: string; cards: CardData[] };

// Hard-coded sample data. No storage, no network.
const columns: Column[] = [
  {
    id: "backlog",
    title: "Backlog",
    cards: [
      { id: "c1", title: "Read the Rust book chapter on ownership", meta: "3 links" },
      { id: "c2", title: "Compare note-taking apps", meta: "5 links" },
    ],
  },
  {
    id: "todo",
    title: "To do",
    cards: [
      { id: "c3", title: "Plan the offline sync talk", meta: "2 notes" },
      { id: "c4", title: "Collect papers on spaced repetition", meta: "8 links" },
    ],
  },
  {
    id: "doing",
    title: "Doing",
    cards: [{ id: "c5", title: "Garden redesign", meta: "4 notes, 6 links" }],
  },
  { id: "done", title: "Done", cards: [{ id: "c6", title: "Tax paperwork 2025", meta: "1 note" }] },
];

type State = { columns: Column[]; message: string };
const store = createStore<State>({ columns, message: "" });

const board = document.getElementById("board") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;

function makeColumn(column: Column): HTMLElement {
  const el = document.createElement("section");
  el.className = "column";
  el.dataset.columnId = column.id;
  const heading = document.createElement("h2");
  heading.className = "column-title";
  const name = document.createElement("span");
  name.className = "column-name";
  name.textContent = column.title;
  const count = document.createElement("span");
  count.className = "column-count";
  count.textContent = String(column.cards.length);
  heading.append(name, count);
  const list = document.createElement("div");
  list.className = "cards";
  for (const card of column.cards) list.append(buildCard(card));
  el.append(heading, list);
  return el;
}

// The one place that changes the DOM: it redraws the board from the state.
function render(state: State, focusId?: string): void {
  board.replaceChildren(...state.columns.map(makeColumn));
  status.textContent = state.message;
  if (focusId) board.querySelector<HTMLElement>(`[data-card-id="${focusId}"]`)?.focus();
}

// The only writer of the columns: a pure move, then the store tells the screen.
function moveCard(cardId: string, toColumnId: string): void {
  store.update((state) => {
    const from = state.columns.find((c) => c.cards.some((card) => card.id === cardId));
    const to = state.columns.find((c) => c.id === toColumnId);
    const card = from?.cards.find((c) => c.id === cardId);
    if (!from || !to || !card || from === to) return state;
    const columns = state.columns.map((c) => {
      if (c === from) return { ...c, cards: c.cards.filter((x) => x.id !== cardId) };
      if (c === to) return { ...c, cards: [...c.cards, card] };
      return c;
    });
    return { columns, message: `Moved "${card.title}" to ${to.title}.` };
  });
  render(store.get(), cardId);
}

function columnAt(x: number, y: number, dragged: HTMLElement): HTMLElement | null {
  const hit = document.elementsFromPoint(x, y).find((el) => !dragged.contains(el));
  return hit ? hit.closest<HTMLElement>(".column") : null;
}

function clearHighlight(): void {
  for (const col of board.querySelectorAll(".column")) col.classList.remove("is-over");
}

// Drag with pointer events: the card follows the pointer, and the column under it takes the card on drop.
function enableDrag(): void {
  board.addEventListener("pointerdown", (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>(".card");
    if (!card || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const from = card.closest<HTMLElement>(".column");
    card.setPointerCapture(event.pointerId);
    card.classList.add("is-dragging");

    const onMove = (move: PointerEvent): void => {
      card.style.transform = `translate(${move.clientX - startX}px, ${move.clientY - startY}px)`;
      clearHighlight();
      columnAt(move.clientX, move.clientY, card)?.classList.add("is-over");
    };
    const onUp = (up: PointerEvent): void => {
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerup", onUp);
      card.removeEventListener("pointercancel", onUp);
      const target = columnAt(up.clientX, up.clientY, card);
      card.style.transform = "";
      card.classList.remove("is-dragging");
      clearHighlight();
      if (target && target !== from) moveCard(card.dataset.cardId ?? "", target.dataset.columnId ?? "");
    };
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerup", onUp);
    card.addEventListener("pointercancel", onUp);
  });
}

// Keyboard alternative to drag: Left and Right move the focused card to the neighbouring column.
function enableKeyboard(): void {
  board.addEventListener("keydown", (event) => {
    // Leave browser and OS shortcuts (Alt+Left, Cmd+Left, Shift+Arrow) alone.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const card = (event.target as HTMLElement).closest<HTMLElement>(".card");
    const from = card?.closest<HTMLElement>(".column");
    if (!card || !from) return;
    const next = event.key === "ArrowLeft" ? from.previousElementSibling : from.nextElementSibling;
    if (next instanceof HTMLElement && next.classList.contains("column")) {
      event.preventDefault();
      moveCard(card.dataset.cardId ?? "", next.dataset.columnId ?? "");
    }
  });
}

render(store.get());
enableDrag();
enableKeyboard();
