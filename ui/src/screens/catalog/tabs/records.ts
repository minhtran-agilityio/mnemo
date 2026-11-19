// The Records tab: one item in each shape. This file is the tab's renderer; the Records and
// Lists agent owns it with ds/catalog/records.ts, ds/catalog/records.css and
// ds/components/records.ts.

import "../../../ds/catalog/records.css";
import { entryRows, type TabRenderer } from "../parts";

export const renderRecords: TabRenderer = (panel, ctx) => {
  panel.append(entryRows(ctx, "Records", {}));
};
