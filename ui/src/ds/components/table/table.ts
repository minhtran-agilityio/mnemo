// A table with sortable headers. Each sortable header is a button inside a th with aria-sort;
// a click sorts by that column (ascending, then descending). The table scrolls sideways inside its
// own box, which can take focus so the keyboard can scroll it.
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide";
import { createIcon } from "../../icon";
import "./table.css";

export interface TableColumn {
  readonly label: string;
  /** Numbers sort by value and align to the right. */
  readonly numeric?: boolean;
}

export interface TableCell {
  readonly text: string;
  /** What to sort by when it differs from the text (a date as 20261119). */
  readonly sort?: string | number;
}

export interface TableOptions {
  readonly label: string;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly (readonly TableCell[])[];
  readonly sort?: { column: number; direction: "ascending" | "descending" };
}

export function createTable(
  doc: Document,
  options: TableOptions,
): HTMLDivElement {
  const wrap = doc.createElement("div");
  wrap.className = "tblwrap";
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", options.label);
  const table = doc.createElement("table");
  const head = table.createTHead().insertRow();
  const body = table.createTBody();
  const ths: HTMLTableCellElement[] = [];
  const sortValue = (cell: TableCell) => cell.sort ?? cell.text;
  const data = options.rows.map((cells) => ({
    cells,
    el: null as HTMLTableRowElement | null,
  }));

  for (const row of data) {
    const tr = body.insertRow();
    row.el = tr;
    row.cells.forEach((cell, i) => {
      const td = tr.insertCell();
      td.textContent = cell.text;
      if (options.columns[i]?.numeric) td.className = "num";
    });
  }

  const paint = (column: number, dir: "ascending" | "descending" | null) => {
    ths.forEach((th, i) => {
      const on = i === column && dir !== null;
      th.setAttribute("aria-sort", on ? (dir as string) : "none");
      const btn = th.querySelector("button");
      btn?.querySelector("svg")?.remove();
      btn?.append(
        createIcon(
          !on ? ArrowUpDown : dir === "ascending" ? ArrowUp : ArrowDown,
        ),
      );
    });
  };
  const sortBy = (column: number, dir: "ascending" | "descending") => {
    const numeric = options.columns[column]?.numeric === true;
    const sorted = [...data].sort((a, b) => {
      const x = sortValue(a.cells[column]);
      const y = sortValue(b.cells[column]);
      const r = numeric
        ? Number(x) - Number(y)
        : String(x).localeCompare(String(y), "vi");
      return dir === "ascending" ? r : -r;
    });
    for (const row of sorted) if (row.el) body.append(row.el);
    paint(column, dir);
  };

  options.columns.forEach((col, i) => {
    const th = doc.createElement("th");
    th.scope = "col";
    if (col.numeric) th.className = "num";
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.append(doc.createTextNode(col.label));
    btn.addEventListener("click", () => {
      const next =
        th.getAttribute("aria-sort") === "ascending"
          ? "descending"
          : "ascending";
      sortBy(i, next);
    });
    th.append(btn);
    head.append(th);
    ths.push(th);
  });
  paint(-1, null);
  if (options.sort) sortBy(options.sort.column, options.sort.direction);
  wrap.append(table);
  return wrap;
}
