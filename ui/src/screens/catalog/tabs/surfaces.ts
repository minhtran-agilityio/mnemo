// The Surfaces tab: page, card, header, panel, dialog and overlay. This file is the tab's
// renderer; the Surfaces agent owns it with ds/catalog/surfaces.ts, ds/catalog/surfaces.css and
// ds/components/surfaces.ts.

import "../../../ds/catalog/surfaces.css";
import { el, entryRows, state, type TabRenderer } from "../parts";

export const renderSurfaces: TabRenderer = (panel, ctx) => {
  const doc = ctx.doc;
  panel.append(
    entryRows(ctx, "Surfaces", {
      card: () => {
        const card = el(doc, "article", "card");
        card.append(
          el(doc, "h4", undefined, "Card title"),
          el(
            doc,
            "p",
            undefined,
            "A card holds one item. Text, border and surface come from tokens.",
          ),
        );
        return [state(doc, "default", card, { grow: true })];
      },
      page: () => {
        const page = el(doc, "div", "page");
        page.append(
          el(
            doc,
            "p",
            undefined,
            "The page is the reading column. It keeps lines to about seventy characters so long text stays easy to read.",
          ),
        );
        return [state(doc, "default", page, { grow: true })];
      },
    }),
  );
};
