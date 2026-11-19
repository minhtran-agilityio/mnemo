import { Bookmark, CircleX, type IconNode, Pause, Power } from "lucide";
import { createIcon } from "../../icon";
import "./state-box.css";

export interface StateAction {
  readonly label: string;
  readonly onClick: () => void;
  /** The main action of the box, drawn as a primary button. */
  readonly primary?: boolean;
}

export interface StateBoxOptions {
  readonly tone?: "default" | "bad";
  readonly icon: IconNode;
  readonly title: string;
  /** A line of help: text, or nodes (for example a key hint built with buildKeyHint). */
  readonly body: string | readonly Node[];
  /** At most one action. */
  readonly action?: StateAction;
}

/** A key cap for a hint inside a state box, for example "⌘". */
export function buildKeyHint(key: string): HTMLElement {
  const kbd = document.createElement("kbd");
  kbd.className = "state-box-kbd";
  kbd.textContent = key;
  return kbd;
}

/**
 * The shared box. An error box is an alert; the others are quiet. Use buildEmptyState,
 * buildErrorState or buildAiOffState instead of calling this one for the three known states.
 */
export function buildStateBox(options: StateBoxOptions): HTMLDivElement {
  const bad = options.tone === "bad";
  const box = document.createElement("div");
  box.className = bad ? "state-box state-box-bad" : "state-box";
  if (bad) box.setAttribute("role", "alert");
  const title = document.createElement("b");
  title.textContent = options.title;
  const body = document.createElement("p");
  if (typeof options.body === "string") body.textContent = options.body;
  else body.append(...options.body);
  box.append(createIcon(options.icon, "md"), title, body);
  if (options.action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = options.action.primary ? "btn btn-primary" : "btn";
    button.textContent = options.action.label;
    button.addEventListener("click", options.action.onClick);
    box.append(button);
  }
  return box;
}

export interface StateTextOptions {
  readonly title: string;
  readonly body: string | readonly Node[];
  readonly action?: StateAction;
}

/** Nothing here yet: say what to do next. */
export function buildEmptyState(options: StateTextOptions): HTMLDivElement {
  return buildStateBox({ icon: Bookmark, ...options });
}

/** Something broke: say what happened, that nothing was lost, and the next step. */
export function buildErrorState(options: StateTextOptions): HTMLDivElement {
  return buildStateBox({ tone: "bad", icon: CircleX, ...options });
}

export interface AiOffStateOptions {
  /** Why AI is not running: the owner turned it off, or the usage limit was reached. */
  readonly reason?: "off" | "limit";
  readonly action?: StateAction;
}

/** AI is not available. Links still save and search still works. */
export function buildAiOffState(
  options: AiOffStateOptions = {},
): HTMLDivElement {
  if (options.reason === "limit")
    return buildStateBox({
      icon: Pause,
      title: "At usage limit",
      body: "Links still save and search still works. Summaries and suggestions wait until the limit resets.",
      action: options.action,
    });
  return buildStateBox({
    icon: Power,
    title: "AI is off",
    body: "Links still save and search still works. Summaries and suggestions wait until AI is on.",
    action: options.action,
  });
}
