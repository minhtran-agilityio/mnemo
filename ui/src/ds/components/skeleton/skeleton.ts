import "./skeleton.css";

export interface SkeletonOptions {
  /** The width of each line as a share of the box, 0 to 100. Default: 80, 100, 60. */
  readonly widths?: readonly number[];
}

/** A skeleton: decorative lines for content that is loading. Hidden from screen readers. */
export function buildSkeleton(options: SkeletonOptions = {}): HTMLDivElement {
  const box = document.createElement("div");
  box.className = "skel";
  box.setAttribute("aria-hidden", "true");
  for (const width of options.widths ?? [80, 100, 60]) {
    const line = document.createElement("span");
    line.style.width = `${Math.min(100, Math.max(0, width))}%`;
    box.append(line);
  }
  return box;
}
