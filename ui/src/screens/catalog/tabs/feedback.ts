// The Feedback tab: pills, banners, toasts, progress and the honest-failure lines. This file is
// the tab's renderer; the Feedback agent owns it with ds/catalog/feedback.ts,
// ds/catalog/feedback.css and ds/components/feedback.ts.

import "../../../ds/catalog/feedback.css";
import { el, entryRows, state, type TabRenderer } from "../parts";

export const renderFeedback: TabRenderer = (panel, ctx) => {
  const doc = ctx.doc;
  const pill = (kind: string, text: string) =>
    state(doc, kind || "default", el(doc, "span", `pill ${kind}`.trim(), text));
  panel.append(
    entryRows(ctx, "Feedback", {
      pill: () => [
        pill("", "Draft"),
        pill("pill-info", "Link"),
        pill("pill-good", "Saved"),
        pill("pill-warn", "Guess"),
        pill("pill-note", "Idea"),
        pill("pill-bad", "Failed"),
      ],
    }),
  );
};
