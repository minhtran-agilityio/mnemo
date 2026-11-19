// A list: a bordered box of rows. `createListbox` adds the keyboard of a listbox: Arrow keys move,
// Enter or Space selects, and only one row is in the tab order.
import { createListRow, type ListRowOptions } from "../list-row/list-row";
import "./list.css";

export function createList(
  doc: Document,
  label: string,
  rows: readonly HTMLElement[] = [],
): HTMLUListElement {
  const ul = doc.createElement("ul");
  ul.className = "list";
  ul.setAttribute("aria-label", label);
  ul.append(...rows);
  return ul;
}

export function createListbox(
  doc: Document,
  label: string,
  items: readonly Omit<ListRowOptions, "role">[],
): HTMLUListElement {
  const rows = items.map((item) =>
    createListRow(doc, { ...item, role: "option" }),
  );
  const ul = createList(doc, label, rows);
  ul.setAttribute("role", "listbox");
  const rove = (to: number) => {
    for (const r of rows) r.tabIndex = -1;
    rows[to].tabIndex = 0;
    rows[to].focus();
  };
  const select = (row: HTMLElement) => {
    for (const r of rows) r.setAttribute("aria-selected", String(r === row));
  };
  const start = Math.max(
    0,
    rows.findIndex((r) => r.getAttribute("aria-selected") === "true"),
  );
  if (rows.length) rows[start].tabIndex = 0;
  rows.forEach((row, i) => {
    row.addEventListener("click", () => {
      select(row);
      rove(i);
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        rove(Math.min(i + 1, rows.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        rove(Math.max(i - 1, 0));
      } else if (e.key === "Home") {
        e.preventDefault();
        rove(0);
      } else if (e.key === "End") {
        e.preventDefault();
        rove(rows.length - 1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select(row);
      }
    });
  });
  return ul;
}
