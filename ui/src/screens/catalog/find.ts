// Find a part: a dialog that searches the parts, the tokens and a few actions of the UI Catalog.
// Typing narrows the list and ignores Vietnamese marks ("tieng viet" finds "tiếng việt"). Arrow
// keys move, Enter opens the match, Escape closes, and focus goes back to where it was. All text
// goes in as text.

import { Search } from "lucide";
import { createIcon, createKbd } from "../../ds/index";
import { el } from "./parts";

export interface FindItem {
  /** The text on the left. */
  readonly label: string;
  /** The quiet text on the right: the tab, or "Action". */
  readonly where: string;
  /** The label is a token name, so it is drawn in the mono face. */
  readonly mono?: boolean;
  /** More words to match, not shown. */
  readonly keywords?: string;
  run(): void;
}

export interface Finder {
  open(opener?: HTMLElement | null): void;
  isOpen(): boolean;
}

/** Lower case, with no Vietnamese marks and "đ" as "d", so "Đọc sau" matches "doc sau". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

/** The items that hold every word of `query`, at most `limit`. No words matches everything. */
export function matchItems(
  items: readonly FindItem[],
  query: string,
  limit = 50,
): FindItem[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return items
    .filter((item) => {
      const hay = fold(`${item.label} ${item.where} ${item.keywords ?? ""}`);
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

/** Builds the Find box as a child of `wrap`. `items` is asked each time it opens, so it is fresh. */
export function createFinder(
  wrap: HTMLElement,
  signal: AbortSignal,
  items: () => FindItem[],
): Finder {
  const doc = wrap.ownerDocument;
  const dialog = el(doc, "dialog", "pal");
  dialog.setAttribute("aria-label", "Find a part");

  const bar = el(doc, "div", "pal-in");
  const input = el(doc, "input");
  input.type = "text";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", "pal-list");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-label", "Find a part, a token or an action");
  input.placeholder = "Find a part, a token or an action";
  input.autocomplete = "off";
  input.spellcheck = false;
  bar.append(createIcon(Search, "md"), input, createKbd(doc, "Esc"));

  const list = el(doc, "ul", "pal-list");
  list.id = "pal-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Results");

  const foot = el(doc, "div", "pal-foot");
  const keys = el(doc, "span");
  keys.append(createKbd(doc, "↑"), " ", createKbd(doc, "↓"), " move");
  const open = el(doc, "span");
  open.append(createKbd(doc, "↵"), " open");
  const count = el(doc, "span", "num");
  count.setAttribute("role", "status");
  foot.append(keys, open, count);
  dialog.append(bar, list, foot);
  wrap.append(dialog);

  let all: FindItem[] = [];
  let current: FindItem[] = [];
  let active = 0;
  let opener: HTMLElement | null = null;
  let ran = false;

  const mark = () => {
    list.querySelectorAll<HTMLElement>('[role="option"]').forEach((li, i) => {
      li.setAttribute("aria-selected", String(i === active));
    });
    const a = doc.getElementById(`pal-o${active}`);
    if (a) {
      input.setAttribute("aria-activedescendant", a.id);
      a.scrollIntoView?.({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };

  const run = (item: FindItem) => {
    ran = true;
    dialog.close();
    item.run();
  };

  const render = () => {
    current = matchItems(all, input.value);
    list.replaceChildren();
    if (active >= current.length) active = 0;
    current.forEach((item, i) => {
      const li = el(doc, "li");
      li.id = `pal-o${i}`;
      li.setAttribute("role", "option");
      li.append(
        el(doc, "span", item.mono ? "mono" : undefined, item.label),
        el(doc, "span", "where", item.where),
      );
      li.addEventListener("click", () => run(item));
      li.addEventListener("mousemove", () => {
        if (active !== i) {
          active = i;
          mark();
        }
      });
      list.append(li);
    });
    if (!current.length)
      list.append(
        el(
          doc,
          "li",
          "none",
          `Nothing matches "${input.value}". A missing part goes through a UI component request.`,
        ),
      );
    count.textContent = `${current.length} ${current.length === 1 ? "result" : "results"}`;
    mark();
  };

  input.addEventListener("input", () => {
    active = 0;
    render();
  });
  input.addEventListener("keydown", (event) => {
    const n = current.length;
    if (event.key === "ArrowDown" && n) {
      event.preventDefault();
      active = (active + 1) % n;
      mark();
    } else if (event.key === "ArrowUp" && n) {
      event.preventDefault();
      active = (active - 1 + n) % n;
      mark();
    } else if (event.key === "Enter" && current[active]) {
      event.preventDefault();
      run(current[active]);
    }
  });
  dialog.addEventListener("close", () => {
    if (!ran) opener?.focus?.();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  signal.addEventListener("abort", () => {
    if (dialog.open) dialog.close();
    dialog.remove();
  });

  return {
    open(from) {
      if (dialog.open) return;
      opener = from ?? (doc.activeElement as HTMLElement | null);
      ran = false;
      all = items();
      input.value = "";
      active = 0;
      render();
      dialog.showModal();
      input.focus();
    },
    isOpen: () => dialog.open,
  };
}
