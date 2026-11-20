// Proof screen for the UI approach (#7): a sample board drawn with the kanban parts of the
// design system (ui/src/ds: createKanbanBoard and createKanbanCard). It is not mounted in the app.
// Focus a card, then Alt+Left or Alt+Right moves it to the next column. Hard-coded sample data:
// no storage, no network.
import { createKanbanBoard, createKanbanCard } from "../../ds";
import "./kanban.css";

type SampleCard = { title: string; meta: string };
type SampleColumn = { title: string; cards: SampleCard[] };

const COLUMNS: readonly SampleColumn[] = [
  {
    title: "Backlog",
    cards: [
      { title: "Read the Rust book chapter on ownership", meta: "3 links" },
      { title: "Compare note-taking apps", meta: "5 links" },
    ],
  },
  {
    title: "To do",
    cards: [
      { title: "Plan the offline sync talk", meta: "2 notes" },
      { title: "Collect papers on spaced repetition", meta: "8 links" },
    ],
  },
  {
    title: "Doing",
    cards: [{ title: "Garden redesign", meta: "4 notes, 6 links" }],
  },
  {
    title: "Done",
    cards: [{ title: "Tax paperwork 2025", meta: "1 note" }],
  },
];

let mounted = false;

// Draws the sample board into `boardEl` once; a second call does nothing, so listeners are never
// added twice. `statusEl` repeats what the board's own live region says after a move.
export function mountKanban(boardEl: HTMLElement, statusEl: HTMLElement): void {
  if (mounted) return;
  mounted = true;
  const doc = boardEl.ownerDocument;
  const board = createKanbanBoard(
    doc,
    "Sample board",
    COLUMNS.map((column) => ({
      name: column.title,
      cards: column.cards.map((card) =>
        createKanbanCard(doc, { title: card.title, meta: [card.meta] }),
      ),
    })),
  );
  boardEl.classList.add("kanban-proof");
  boardEl.replaceChildren(board);
  statusEl.textContent = "";
  // The board handles the key first (it is inside boardEl), then this copies its message.
  boardEl.addEventListener("keydown", () => {
    statusEl.textContent =
      board.querySelector(".board-live")?.textContent ?? "";
  });
}
