// Segmented choice: a radiogroup of buttons. One is checked; arrow keys move and check.
import "./segmented.css";

export interface SegmentedOptions {
  /** Names the group for screen readers: "Sort by". */
  readonly label: string;
  readonly options: readonly string[];
  readonly value?: string;
  readonly onChange?: (value: string) => void;
}

export function createSegmented(
  doc: Document,
  options: SegmentedOptions,
): HTMLElement {
  const group = doc.createElement("div");
  group.className = "seg";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", options.label);
  const value = options.value ?? options.options[0];
  const buttons = options.options.map((text) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.textContent = text;
    return b;
  });
  const pick = (chosen: HTMLButtonElement) => {
    for (const b of buttons) {
      const on = b === chosen;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  const start = buttons.find((x) => x.textContent === value) ?? buttons[0];
  if (start) pick(start);
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => {
      pick(b);
      options.onChange?.(b.textContent ?? "");
    });
    b.addEventListener("keydown", (event) => {
      let next: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown")
        next = (i + 1) % buttons.length;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp")
        next = (i - 1 + buttons.length) % buttons.length;
      if (next === null) return;
      event.preventDefault();
      const target = buttons[next];
      target?.focus();
      target?.click();
    });
  });
  group.append(...buttons);
  return group;
}
