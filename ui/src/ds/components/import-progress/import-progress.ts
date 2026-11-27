// Import progress: counts, the state in words, a reason when it waits, a bar and one text button.
import "./import-progress.css";
import { createButton } from "../button/button";
import { buildProgress, setProgress } from "../progress/progress";

export type ImportProgressState =
  | "running"
  | "waiting"
  | "paused"
  | "finished"
  | "stopped";

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
  /** "Stop here" ends the import. Links that got no summary stay link only. */
  readonly onStop?: () => void;
}

const STATE_WORD: Readonly<Record<ImportProgressState, string>> = {
  running: "Running",
  waiting: "Waiting",
  paused: "Paused",
  finished: "Finished",
  stopped: "Stopped",
};

type ActionKind = "pause" | "continue" | "stop";

const ACTION_LABEL: Readonly<Record<ActionKind, string>> = {
  pause: "Pause",
  continue: "Continue",
  stop: "Stop here",
};

export const STOPPED_REASON =
  "Stopped. The links that got no summary are saved as link only.";

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
  // The state word and the reason are live regions (a change is announced). The counts are not:
  // they change on every tick and would be read out each time.
  const word = span(doc, "ip-state");
  word.setAttribute("role", "status");
  head.append(title, word);
  const counts = doc.createElement("p");
  counts.className = "ip-counts";
  // buildProgress takes no document and uses the global one; this part is built for the window's document.
  const bar = buildProgress({ label: "Import", value: 0 });
  bar.classList.add("ip-bar");
  const reason = doc.createElement("p");
  reason.className = "ip-reason";
  reason.setAttribute("role", "status");
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
    options.state === "finished"
      ? "Imported "
      : options.state === "stopped"
        ? "Import of "
        : "Importing ";
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
  // Rounding must not show 100% before the import is finished.
  const shown =
    options.state === "finished" ? 100 : Math.min(99, Math.floor(share));
  setProgress(part(root, "ip-bar"), shown);
  const reason = part(root, "ip-reason");
  const line =
    options.reason ?? (options.state === "stopped" ? STOPPED_REASON : "");
  reason.textContent = line;
  reason.hidden = !line;

  const actions = part(root, "ip-actions");
  const ended = options.state === "finished" || options.state === "stopped";
  const wanted: ActionKind[] = ended
    ? []
    : [options.state === "paused" ? "continue" : "pause", "stop"];
  for (const old of actions.querySelectorAll<HTMLButtonElement>("button")) {
    if (!wanted.includes(old.dataset.action as ActionKind)) old.remove();
  }
  for (const kind of wanted) {
    const current = actions.querySelector<HTMLButtonElement>(
      `button[data-action="${kind}"]`,
    );
    if (current) {
      current.disabled = Boolean(options.pending);
      continue;
    }
    const button = createButton(doc, {
      label: ACTION_LABEL[kind],
      variant: kind === "stop" ? "ghost" : "default",
      size: "sm",
      disabled: options.pending,
      onClick: () => {
        const latest = handlers.get(root);
        if (kind === "pause") latest?.onPause?.();
        else if (kind === "continue") latest?.onContinue?.();
        else latest?.onStop?.();
      },
    });
    button.dataset.action = kind;
    actions.append(button);
  }
  // Pause and Continue come first, Stop here last, whatever order they were made in.
  const stop = actions.querySelector('button[data-action="stop"]');
  if (stop) actions.append(stop);
  actions.hidden = wanted.length === 0;
}
