// The Limits tab: messy content and small windows. This file is the tab's renderer; the Limits,
// specimen, Inspect and Find agent owns it with ds/catalog/limits.ts and ds/catalog/limits.css.

import "../../../ds/catalog/limits.css";
import { entryRows, type TabRenderer } from "../parts";

export const renderLimits: TabRenderer = (panel, ctx) => {
  panel.append(entryRows(ctx, "Limits", {}));
};
