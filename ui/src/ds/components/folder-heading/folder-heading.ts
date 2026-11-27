// Folder heading: the name of a group of links, its count, and a "Show all N / Show less" button
// that expands or collapses the group. The heading only reports the toggle; the screen shows or
// hides the links. A folder of 0 is hidden. All text goes in as text.
import "./folder-heading.css";

export interface FolderHeadingOptions {
  /** The folder name. A long name wraps. */
  name: string;
  /** How many links the folder holds. 0 hides the heading. */
  count: number;
  expanded?: boolean;
  /** False when every link already shows: no toggle. Default true. */
  canToggle?: boolean;
  /** The id of the element the toggle shows and hides (aria-controls). */
  controls?: string;
  /** Called with the new state after the owner presses the toggle. */
  onToggle?(expanded: boolean): void;
  /** Draws a toggle state without the pointer or the keyboard, for the UI Catalog. */
  forceState?: "hover" | "focus" | "pressed";
}

export interface FolderHeading {
  element: HTMLElement;
  setExpanded(expanded: boolean): void;
  setCount(count: number): void;
  /** Shows or drops the toggle, for when every link shows or not. */
  setCanToggle(canToggle: boolean): void;
}

export function createFolderHeading(
  doc: Document,
  options: FolderHeadingOptions,
): FolderHeading {
  const root = doc.createElement("div");
  root.className = "folder-heading";
  const title = doc.createElement("h3");
  title.className = "folder-heading-title";
  const name = doc.createElement("span");
  name.className = "folder-heading-name";
  name.textContent = options.name;
  const countNode = doc.createElement("span");
  countNode.className = "folder-heading-count";
  title.append(name, " ", countNode);
  root.append(title);

  let count = options.count;
  let expanded = options.expanded ?? false;
  let canToggle = options.canToggle ?? true;
  let toggle: HTMLButtonElement | null = null;

  function makeToggle(): HTMLButtonElement {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "folder-heading-toggle";
    if (options.forceState) button.classList.add(`is-${options.forceState}`);
    if (options.controls)
      button.setAttribute("aria-controls", options.controls);
    button.addEventListener("click", () => {
      expanded = !expanded;
      render();
      options.onToggle?.(expanded);
    });
    return button;
  }

  function render(): void {
    root.hidden = count <= 0;
    // One formatted number, shown in the count and in the toggle.
    const shown = new Intl.NumberFormat("en").format(count);
    countNode.textContent = shown;
    if (canToggle && !toggle) {
      toggle = makeToggle();
      root.append(toggle);
    } else if (!canToggle && toggle) {
      toggle.remove();
      toggle = null;
    }
    if (!toggle) return;
    const label = expanded ? "Show less" : `Show all ${shown}`;
    toggle.textContent = label;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", `${label} in ${options.name}`);
  }
  render();

  return {
    element: root,
    setExpanded(next) {
      expanded = next;
      render();
    },
    setCount(next) {
      count = next;
      render();
    },
    setCanToggle(next) {
      canToggle = next;
      render();
    },
  };
}
