import "./style.css";

type Card = { id: string; title: string; meta: string };
type Column = { id: string; title: string; cards: Card[] };

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

const board = document.getElementById("board") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;

function makeCard(card: Card): HTMLElement {
  const el = document.createElement("article");
  el.className = "card";
  el.dataset.cardId = card.id;
  const title = document.createElement("strong");
  title.textContent = card.title;
  const meta = document.createElement("span");
  meta.className = "card-meta";
  meta.textContent = card.meta;
  el.append(title, meta);
  return el;
}

function makeColumn(column: Column): HTMLElement {
  const el = document.createElement("section");
  el.className = "column";
  el.dataset.columnId = column.id;
  const heading = document.createElement("h2");
  heading.className = "column-title";
  const name = document.createElement("span");
  name.textContent = column.title;
  const count = document.createElement("span");
  count.className = "column-count";
  heading.append(name, count);
  const list = document.createElement("div");
  list.className = "cards";
  for (const card of column.cards) list.append(makeCard(card));
  el.append(heading, list);
  return el;
}

function updateCounts(): void {
  for (const col of board.querySelectorAll<HTMLElement>(".column")) {
    const n = col.querySelectorAll(".card").length;
    const count = col.querySelector(".column-count");
    if (count) count.textContent = String(n);
  }
}

// The dragged card sits under the pointer, so skip it when looking for the column below.
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
      if (target && target !== from) {
        target.querySelector(".cards")?.append(card);
        const title = card.querySelector("strong")?.textContent ?? "card";
        status.textContent = `Moved "${title}" to ${target.dataset.columnId}.`;
        updateCounts();
      }
    };
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerup", onUp);
    card.addEventListener("pointercancel", onUp);
  });
}

for (const column of columns) board.append(makeColumn(column));
updateCounts();
enableDrag();
