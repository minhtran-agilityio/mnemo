// Proof screen for the UI approach (#7): a sample board drawn with the kanban parts of the
// design system (ui/src/ds: createKanbanBoard and createKanbanCard). It is not mounted in the app.
// Drag a card to another column, or focus it and press Left or Right (Alt+Left and Alt+Right work too). Hard-coded sample data:
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
    { drag: true },
  );
  boardEl.classList.add("kanban-proof");
  boardEl.replaceChildren(board);
  statusEl.textContent = "";
  // The board's own live region is the one that is announced. This copy is for sighted users and is
  // hidden from screen readers, and it follows that region only when its text changes.
  statusEl.setAttribute("aria-hidden", "true");
  const live = board.querySelector(".board-live");
  if (live)
    new MutationObserver(() => {
      statusEl.textContent = live.textContent ?? "";
    }).observe(live, { childList: true, characterData: true, subtree: true });
}
