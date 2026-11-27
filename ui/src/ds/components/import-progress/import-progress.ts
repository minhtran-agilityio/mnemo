// Import progress: counts, the state in words, a reason when it waits, a bar and one text button.
import "./import-progress.css";
import { createButton } from "../button/button";
import { buildProgress, setProgress } from "../progress/progress";

export type ImportProgressState = "running" | "waiting" | "paused" | "finished";

export interface ImportProgressOptions {
  /** The file being imported. A long name is cut with an ellipsis; the full name is its title. */
  readonly fileName: string;
  readonly done: number;
  readonly waiting: number;
  readonly failed: number;
  readonly total: number;
  readonly state: ImportProgressState;
  /** One line shown under the counts. Use it when the import waits or is paused. */
  readonly reason?: string;
  /** The button is disabled while the request is sent. */
  readonly pending?: boolean;
  readonly onPause?: () => void;
  readonly onContinue?: () => void;
}

const STATE_WORD: Readonly<Record<ImportProgressState, string>> = {
  running: "Running",
  waiting: "Waiting",
  paused: "Paused",
  finished: "Finished",
};

const handlers = new WeakMap<HTMLElement, ImportProgressOptions>();

const num = (n: number) => n.toLocaleString("en-US");

function part(root: HTMLElement, cls: string): HTMLElement {
  return root.querySelector<HTMLElement>(`.${cls}`) as HTMLElement;
}

function span(doc: Document, cls: string): HTMLElement {
  const node = doc.createElement("span");
  node.className = cls;
  return node;
}

/** Builds the block. Update it in place with `setImportProgress`. */
export function createImportProgress(
  doc: Document,
  options: ImportProgressOptions,
): HTMLElement {
  const root = doc.createElement("div");
  root.className = "import-progress";
  const head = doc.createElement("div");
  head.className = "ip-head";
  const title = span(doc, "ip-title");
  title.append(span(doc, "ip-lead"), span(doc, "ip-file"));
  head.append(title, span(doc, "ip-state"));
  const counts = doc.createElement("p");
  counts.className = "ip-counts";
  counts.setAttribute("role", "status");
  const bar = buildProgress({ label: "Import", value: 0 });
  bar.classList.add("ip-bar");
  const reason = doc.createElement("p");
  reason.className = "ip-reason";
  const actions = doc.createElement("div");
  actions.className = "ip-actions";
  root.append(head, counts, bar, reason, actions);
  setImportProgress(root, options);
  return root;
}

/** Updates the block in place: counts, state word, reason, bar and button. */
export function setImportProgress(
  root: HTMLElement,
  options: ImportProgressOptions,
): void {
  handlers.set(root, options);
  const doc = root.ownerDocument;
  root.dataset.state = options.state;
  part(root, "ip-lead").textContent =
    options.state === "finished" ? "Imported " : "Importing ";
  const file = part(root, "ip-file");
  file.textContent = options.fileName;
  file.title = options.fileName;
  part(root, "ip-state").textContent = STATE_WORD[options.state];
  part(root, "ip-counts").textContent =
    `${num(options.done)} done, ${num(options.waiting)} waiting, ${num(options.failed)} failed of ${num(options.total)}`;
  const share =
    options.total > 0
      ? ((options.done + options.failed) / options.total) * 100
      : 0;
  setProgress(part(root, "ip-bar"), options.state === "finished" ? 100 : share);
  const reason = part(root, "ip-reason");
  reason.textContent = options.reason ?? "";
  reason.hidden = !options.reason;

  const actions = part(root, "ip-actions");
  const kind =
    options.state === "finished"
      ? null
      : options.state === "paused"
        ? "continue"
        : "pause";
  const current = actions.querySelector<HTMLButtonElement>("button");
  if (kind === null) {
    current?.remove();
  } else if (current && current.dataset.action === kind) {
    current.disabled = Boolean(options.pending);
  } else {
    const hadFocus = current !== null && doc.activeElement === current;
    current?.remove();
    const button = createButton(doc, {
      label: kind === "pause" ? "Pause" : "Continue",
      variant: "ghost",
      size: "sm",
      disabled: options.pending,
      onClick: () => {
        const latest = handlers.get(root);
        if (kind === "pause") latest?.onPause?.();
        else latest?.onContinue?.();
      },
    });
    button.dataset.action = kind;
    actions.append(button);
    if (hadFocus) button.focus();
  }
  actions.hidden = kind === null;
}
