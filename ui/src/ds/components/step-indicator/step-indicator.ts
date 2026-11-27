// Step indicator: an ordered list of steps with the owner's place in it. Not interactive.
import "./step-indicator.css";

export interface StepIndicatorOptions {
  /** Names the list for screen readers: "Import steps". */
  readonly label: string;
  /** The step labels in order: "Pick a file", "Check", "Import", "Done". */
  readonly steps: readonly string[];
  /** The current step, 1-based. Earlier steps are done, later ones to come. */
  readonly current: number;
  /** The words read after each label for screen readers. */
  readonly words?: { done: string; current: string; todo: string };
}

const WORDS = { done: "done", current: "current step", todo: "to come" };

/** The steps of a flow. The state is a class, text for screen readers and aria-current. */
export function createStepIndicator(
  doc: Document,
  options: StepIndicatorOptions,
): HTMLOListElement {
  const words = options.words ?? WORDS;
  const list = doc.createElement("ol");
  list.className = "steps";
  list.setAttribute("aria-label", options.label);
  options.steps.forEach((label, i) => {
    const n = i + 1;
    const state =
      n < options.current ? "done" : n === options.current ? "current" : "todo";
    const item = doc.createElement("li");
    item.className = `steps-item steps-${state}`;
    if (state === "current") item.setAttribute("aria-current", "step");
    const mark = doc.createElement("span");
    mark.className = "steps-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = String(n);
    const text = doc.createElement("span");
    text.className = "steps-label";
    text.textContent = label;
    const hidden = doc.createElement("span");
    hidden.className = "steps-state";
    hidden.textContent = `, ${words[state]}`;
    item.append(mark, text, hidden);
    list.append(item);
  });
  return list;
}
