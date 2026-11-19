// The Lists tab: many items at once. This file is the tab's renderer; the Records and Lists agent
// owns it with ds/catalog/lists.ts, ds/catalog/lists.css and ds/components/lists.ts.

import "../../../ds/catalog/lists.css";
import { el, entryRows, state, type TabRenderer } from "../parts";

export const renderLists: TabRenderer = (panel, ctx) => {
  const doc = ctx.doc;
  panel.append(
    entryRows(ctx, "Lists", {
      "list row": () => {
        const list = el(doc, "ul", "list");
        for (const [name, meta] of [
          ["Read the design notes", "Today"],
          [
            "A very long title that is cut off with an ellipsis when the row is too narrow to show all of it",
            "Yesterday",
          ],
          ["Plan the week", "Mon"],
        ]) {
          const row = el(doc, "li", "row");
          const rowTitle = el(doc, "span", "row-title", name);
          rowTitle.title = name;
          row.append(rowTitle, el(doc, "span", "row-meta", meta));
          list.append(row);
        }
        return [
          state(doc, "default, hover and overflow", list, { grow: true }),
        ];
      },
    }),
  );
};
