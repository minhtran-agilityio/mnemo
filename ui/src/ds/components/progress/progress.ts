import "./progress.css";

export interface ProgressOptions {
  /** What is in progress, for screen readers: "Import", "Reading page". */
  readonly label: string;
  /** 0 to 100. Leave it out when the end is not known: the bar then slides. */
  readonly value?: number;
}

/** A progress bar. Anything over a second shows progress; AI tasks always do. */
export function buildProgress(options: ProgressOptions): HTMLDivElement {
  const bar = document.createElement("div");
  bar.className = "progress";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.append(document.createElement("span"));
  if (options.value === undefined) {
    bar.classList.add("indet");
    bar.setAttribute("aria-label", options.label);
  } else {
    setProgress(bar, options.value, options.label);
  }
  return bar;
}

/** Moves a determinate bar to a new value (clamped to 0 to 100). */
export function setProgress(
  bar: HTMLElement,
  value: number,
  label = bar.getAttribute("aria-label")?.replace(/ \d+%$/, "") ?? "",
): void {
  const percent = Math.round(Math.min(100, Math.max(0, value)));
  bar.setAttribute("aria-valuenow", String(percent));
  bar.setAttribute("aria-label", `${label} ${percent}%`);
  const fill = bar.firstElementChild;
  if (fill instanceof HTMLElement) fill.style.width = `${percent}%`;
}
