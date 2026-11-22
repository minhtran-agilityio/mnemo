// Copy line: a label, a read-only path or command in monospace, and a Copy button. The text goes in
// as text, never markup, and stays selectable. When the clipboard is missing or refuses, a visible
// line says to select and copy the text.
import "./copy-line.css";
import { createButton } from "../button/button";

export type CopyLineState = "idle" | "copied" | "failed";

/** Writes text to the clipboard. Rejects (or throws) when it cannot. */
export type CopyWriter = (text: string) => Promise<void>;

export interface CopyLineOptions {
  /** What the line is for ("Ubuntu", "Data folder"). Also names the Copy button. */
  readonly label: string;
  /** The path or command. Shown and copied as it is. */
  readonly text: string;
  /** The clipboard call. Default: navigator.clipboard.writeText, which fails when missing. */
  readonly copy?: CopyWriter;
  /** How long "Copied" stays before the line is idle again. Default 2000 ms. */
  readonly resetMs?: number;
  /** Starts in this state (the catalog shows the two that need a click). Default idle. */
  readonly state?: CopyLineState;
}

export const COPY_RESET_MS = 2000;
export const COPIED_TEXT = "Copied";
export const FAILED_TEXT =
  "Could not copy. Select the text above and copy it yourself.";

let counter = 0;

function defaultCopy(doc: Document): CopyWriter {
  return async (text) => {
    const clipboard = doc.defaultView?.navigator?.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      throw new Error("clipboard unavailable");
    }
    await clipboard.writeText(text);
  };
}

function selectText(doc: Document, node: HTMLElement): void {
  try {
    const selection = doc.getSelection?.();
    if (!selection) return;
    const range = doc.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  } catch {
    // Selecting is a courtesy; the visible line still tells the owner what to do.
  }
}

export function createCopyLine(
  doc: Document,
  options: CopyLineOptions,
): HTMLElement {
  counter += 1;
  const id = `copy-line-${counter}`;
  const root = doc.createElement("div");
  root.className = "copy-line";
  root.setAttribute("role", "group");
  root.setAttribute("aria-labelledby", `${id}-label`);

  const label = doc.createElement("span");
  label.className = "copy-line-label";
  label.id = `${id}-label`;
  label.textContent = options.label;

  const row = doc.createElement("div");
  row.className = "copy-line-row";

  const code = doc.createElement("code");
  code.className = "copy-line-text";
  code.tabIndex = 0;
  code.textContent = options.text;

  const status = doc.createElement("p");
  status.className = "copy-line-status";
  status.setAttribute("role", "status");

  const button = createButton(doc, { label: "Copy" });
  button.classList.add("copy-line-button");
  button.setAttribute("aria-label", `Copy ${options.label}`);

  row.append(code, button);
  root.append(label, row, status);

  const writer = options.copy ?? defaultCopy(doc);
  const resetMs = options.resetMs ?? COPY_RESET_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let run = 0;

  const show = (next: CopyLineState): void => {
    root.dataset.state = next;
    root.classList.toggle("is-copied", next === "copied");
    root.classList.toggle("is-failed", next === "failed");
    button.textContent = next === "copied" ? COPIED_TEXT : "Copy";
    status.textContent =
      next === "copied" ? COPIED_TEXT : next === "failed" ? FAILED_TEXT : "";
  };

  button.addEventListener("click", () => {
    run += 1;
    const mine = run;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    let attempt: Promise<void>;
    try {
      attempt = Promise.resolve(writer(options.text));
    } catch (error) {
      attempt = Promise.reject(error);
    }
    attempt.then(
      () => {
        if (mine !== run) return;
        show("copied");
        timer = setTimeout(() => {
          timer = undefined;
          show("idle");
        }, resetMs);
      },
      () => {
        if (mine !== run) return;
        show("failed");
        selectText(doc, code);
      },
    );
  });

  show(options.state ?? "idle");
  return root;
}
