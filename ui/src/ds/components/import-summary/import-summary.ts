// Import summary: what a chosen file holds, shown before anything is stored. A file name, a
// labelled list of counts, a slot for a checkbox and the actions. Text goes in as text.
import { type ButtonForcedState, createButton } from "../button/button";
import { buildBusyLine } from "../spinner/spinner";
import "./import-summary.css";

export interface ImportCounts {
  /** Links that will be added. */
  readonly toAdd: number;
  /** Repeats inside the file, skipped. */
  readonly repeats: number;
  /** Links already saved, skipped. */
  readonly saved: number;
  /** Entries that are not links, skipped. */
  readonly notLinks: number;
}

export type ImportSummaryState = "loading" | "ready" | "error";

export interface ImportSummaryOptions {
  readonly fileName: string;
  /** Default "ready". "loading" shows a spinner while the file is read; "error" shows `error`. */
  readonly state?: ImportSummaryState;
  /** Used by "ready". */
  readonly counts?: ImportCounts;
  /** The plain line shown in the "error" state: what happened and that nothing was stored. */
  readonly error?: string;
  /** Where the checkbox goes (build it with createCheckbox). Only in "ready". */
  readonly slot?: Node;
  readonly onImport?: () => void;
  readonly onChooseAnother?: () => void;
  /** Goes back with nothing imported. A quiet button, shown in every state. */
  readonly onCancel?: () => void;
  /** A fixed look for a state the pointer cannot hold still (the catalog shows these). */
  readonly forced?: ButtonForcedState;
}

const NUMBER = new Intl.NumberFormat("en-US");

const ROWS: readonly (readonly [keyof ImportCounts, string])[] = [
  ["toAdd", "Links to add"],
  ["repeats", "Repeats in the file, skipped"],
  ["saved", "Already saved, skipped"],
  ["notLinks", "Not links, skipped"],
];

/** The label of the primary action: "Import 50 links", "Import 1 link". */
export function importLabel(count: number): string {
  return `Import ${NUMBER.format(count)} ${count === 1 ? "link" : "links"}`;
}

export function createImportSummary(
  doc: Document,
  options: ImportSummaryOptions,
): HTMLElement {
  const state = options.state ?? "ready";
  const root = doc.createElement("section");
  root.className = `import-summary is-${state}`;
  root.setAttribute("aria-label", `Import summary: ${options.fileName}`);

  const name = doc.createElement("p");
  name.className = "import-summary-file";
  name.textContent = options.fileName;
  name.title = options.fileName;
  root.append(name);

  const actions = doc.createElement("div");
  actions.className = "import-summary-actions";
  const cancel = createButton(doc, {
    label: "Cancel",
    variant: "ghost",
    onClick: options.onCancel,
  });

  if (state === "loading") {
    root.setAttribute("aria-busy", "true");
    actions.append(cancel);
    root.append(buildBusyLine("Reading the file…"), actions);
    return root;
  }

  const choose = createButton(doc, {
    label: "Choose another file",
    onClick: options.onChooseAnother,
  });

  if (state === "error") {
    const line = doc.createElement("p");
    line.className = "import-summary-message";
    line.setAttribute("role", "alert");
    line.textContent =
      options.error ?? "The file could not be read. Nothing was stored.";
    actions.append(choose, cancel);
    root.append(line, actions);
    return root;
  }

  const given = options.counts;
  const clean = (n: number | undefined): number =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const counts: ImportCounts = {
    toAdd: clean(given?.toAdd),
    repeats: clean(given?.repeats),
    saved: clean(given?.saved),
    notLinks: clean(given?.notLinks),
  };
  const list = doc.createElement("dl");
  list.className = "import-summary-counts";
  for (const [key, label] of ROWS) {
    const row = doc.createElement("div");
    row.className =
      key === "toAdd"
        ? "import-summary-row import-summary-row-add"
        : "import-summary-row";
    const term = doc.createElement("dt");
    term.textContent = label;
    const value = doc.createElement("dd");
    value.textContent = NUMBER.format(counts[key]);
    row.append(term, value);
    list.append(row);
  }
  root.append(list);

  const none = counts.toAdd === 0;
  if (none) {
    const why = doc.createElement("p");
    why.className = "import-summary-why";
    const empty = counts.repeats + counts.saved + counts.notLinks === 0;
    why.textContent = empty
      ? "The file has no entries."
      : "Nothing to add: every entry is a repeat, already saved or not a link.";
    root.append(why);
  }
  if (options.slot) {
    const slot = doc.createElement("div");
    slot.className = "import-summary-slot";
    slot.append(options.slot);
    root.append(slot);
  }
  actions.append(
    createButton(doc, {
      label: importLabel(counts.toAdd),
      variant: "primary",
      disabled: none,
      forced: options.forced,
      onClick: options.onImport,
    }),
    choose,
    cancel,
  );
  root.append(actions);
  return root;
}
