// The specimen window at the top of the UI Catalog: one Mnemo window built only from the parts on
// this page, scaled to fit. A button over each part opens that part's row below, so the window is
// also a map of the catalog. The window itself is inert; only the hotspots take pointer and keys.
// All text goes in as text.

import {
  Bookmark,
  CalendarDays,
  FileText,
  Kanban,
  MessageCircle,
  Network,
  Plus,
  StickyNote,
  TriangleAlert,
} from "lucide";
import { CATALOG } from "../../ds/catalog";
import {
  buildBanner,
  createButton,
  createChip,
  createLinkCard,
  createMetaLine,
  createNavRail,
  createPageHeader,
  createSearch,
  createSegmented,
  createStatusBar,
  type LinkItem,
} from "../../ds/index";
import { el, headingOf } from "./parts";

const ATTR = "data-spec-part";

const CARDS: readonly LinkItem[] = [
  {
    title: "Tauri 2: capabilities and permissions, explained",
    url: "v2.tauri.app/security/capabilities",
    app: "telegram",
    age: "2 d",
    summary:
      "Each window gets a list of allowed commands. Anything not listed is refused at the core.",
  },
  {
    title: "Hướng dẫn sao lưu an toàn khi đang ghi",
    url: "viblo.asia/p/sao-luu-du-lieu",
    app: "zalo",
    age: "3 h",
    summary:
      "Dùng API sao lưu trực tuyến thay vì sao chép tệp. Ở chế độ WAL cần checkpoint trước.",
  },
  {
    title: "medium.com/@x/9f2c1a",
    url: "medium.com/@x/9f2c1a",
    app: "slack",
    age: "1 h",
  },
];

/** Marks a node as a part of the specimen: `name` is the entry name of the catalog row it opens. */
function part<T extends Element>(node: T, name: string): T {
  node.setAttribute(ATTR, name);
  return node;
}

/** The label of the hotspot: the heading of the row it opens. */
function labelOf(name: string): string {
  const entry = CATALOG.find((e) => e.name === name);
  return entry ? headingOf(entry) : name;
}

export interface SpecimenOptions {
  /** Opens the catalog row of the part with this entry name. */
  open(name: string): void;
  /** Aborts when the screen closes. */
  signal: AbortSignal;
}

/** Builds the window. It is the stage's child; the hotspots are laid over it by `layout`. */
function buildWindow(doc: Document): HTMLElement {
  const win = el(doc, "div", "spec-win");
  win.setAttribute("inert", "");
  win.setAttribute("aria-hidden", "true");

  const rail = createNavRail({
    doc,
    label: "Specimen menu",
    groups: [
      {
        label: "Daily",
        items: [
          { id: "today", label: "Today", icon: CalendarDays },
          { id: "ask", label: "Ask Mnemo", icon: MessageCircle },
        ],
      },
      {
        label: "Library",
        items: [
          { id: "bookmarks", label: "Bookmarks", icon: Bookmark },
          { id: "notes", label: "Notes", icon: StickyNote },
          { id: "files", label: "Files (PDF)", icon: FileText, later: true },
        ],
      },
      {
        label: "Knowledge",
        items: [
          { id: "board", label: "Board", icon: Kanban },
          { id: "graph", label: "Graph", icon: Network },
        ],
      },
    ],
    current: "bookmarks",
  });
  part(rail.element, "nav rail");

  const save = part(
    createButton(doc, { label: "Save link", variant: "primary", icon: Plus }),
    "button",
  );
  const header = part(
    createPageHeader({
      doc,
      crumb: "Library",
      title: "Bookmarks",
      actions: [createButton(doc, { label: "Import" }), save],
    }),
    "page header",
  );

  const search = createSearch(doc, {
    placeholder: "Search links, notes, tasks",
  });
  search.input.tabIndex = -1;
  search.wrap.classList.add("spec-grow");
  part(search.wrap, "search");
  const chips = el(doc, "div", "spec-chips");
  chips.append(
    createChip(doc, { label: "Telegram", pressed: true }),
    createChip(doc, { label: "Zalo" }),
  );
  part(chips, "filter chip");
  const views = part(
    createSegmented(doc, {
      label: "Bookmarks view",
      options: ["List", "Cards", "Compact"],
      value: "Cards",
    }),
    "segmented",
  );
  const tools = el(doc, "div", "spec-tools");
  tools.append(search.wrap, chips, views);

  const banner = part(
    buildBanner({
      tone: "info",
      message:
        "3 folder suggestions are ready. Nothing moves until you accept.",
      action: { label: "Review", onClick: () => {} },
    }),
    "banner",
  );

  const cards = el(doc, "div", "spec-cards");
  CARDS.forEach((item, i) => {
    const card = createLinkCard(doc, item);
    if (i === 0) {
      part(card, "link card");
      const label = card.querySelector(".trust");
      if (label) part(label, "trust label");
    }
    if (i === 2) {
      const write = createButton(doc, {
        label: "Write a note for it",
        size: "sm",
      });
      write.classList.add("spec-self-start");
      card.append(write);
    }
    cards.append(card);
  });

  const main = el(doc, "div", "spec-main");
  main.append(header, tools, banner, cards);
  const body = el(doc, "div", "spec-body");
  body.append(rail.element, main);

  const status = createStatusBar({
    doc,
    label: "Specimen status",
    items: [
      { dot: "accent", pulse: true, text: "AI working · 2 jobs" },
      { icon: TriangleAlert, tone: "warn", text: "62% used", mono: true },
      { text: "Saved 2 min ago" },
      { text: "1,284 links · 96 notes", push: true },
    ],
  });
  const items = status.querySelectorAll(".sb-item");
  part(status, "status bar");
  if (items[0]) part(items[0], "AI status light");
  if (items[1]) {
    part(items[1], "usage meter");
    const meter = el(doc, "span", "spec-meter");
    meter.append(el(doc, "i"));
    items[1].append(meter);
  }

  const titlebar = el(doc, "div", "spec-title", "Mnemo");
  win.append(titlebar, body, status);
  return win;
}

/**
 * The specimen section. It scales the window to the width of the page and keeps the hotspots on
 * the parts when the page resizes or the fonts load.
 */
export function createSpecimen(
  doc: Document,
  options: SpecimenOptions,
): HTMLElement {
  const section = el(doc, "section", "specimen");
  section.setAttribute("aria-labelledby", "spec-title");
  const bar = el(doc, "div", "spec-bar");
  const text = el(doc, "div", "cat-stack");
  const h2 = el(
    doc,
    "h2",
    undefined,
    "One window, built only from parts on this page",
  );
  h2.id = "spec-title";
  text.append(
    h2,
    el(
      doc,
      "p",
      "cat-note",
      "Point at a part, or Tab to it and press Enter, to open it in the catalog below.",
    ),
  );
  const outlines = createButton(doc, {
    label: "Show part names",
    size: "sm",
  });
  outlines.setAttribute("aria-pressed", "false");
  const outlinesState = el(doc, "span", "cat-switch-state", "Off");
  outlines.append(outlinesState);
  bar.append(text, outlines);

  const stage = el(doc, "div", "spec-stage");
  const win = buildWindow(doc);
  const hots = el(doc, "div", "hotspots");
  stage.append(win, hots);
  section.append(bar, stage);

  const layout = () => {
    const width = win.offsetWidth;
    const height = win.offsetHeight;
    const scale =
      width && stage.clientWidth ? Math.min(1, stage.clientWidth / width) : 1;
    win.style.transform = `scale(${scale})`;
    if (height) stage.style.height = `${Math.ceil(height * scale)}px`;
    const focused = doc.activeElement;
    const had =
      focused instanceof HTMLElement && hots.contains(focused)
        ? focused.getAttribute("aria-label")
        : null;
    hots.replaceChildren();
    const at = stage.getBoundingClientRect();
    const found = [...win.querySelectorAll<HTMLElement>(`[${ATTR}]`)].map(
      (node) => ({ node, rect: node.getBoundingClientRect() }),
    );
    // A smaller part sits above a larger one, so the pointer reaches the part it is over.
    const byArea = [...found].sort(
      (a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height,
    );
    for (const { node, rect } of found) {
      const name = node.getAttribute(ATTR) ?? "";
      const label = labelOf(name);
      const hot = el(doc, "button", "hot");
      hot.type = "button";
      hot.style.left = `${rect.left - at.left}px`;
      hot.style.top = `${rect.top - at.top}px`;
      hot.style.width = `${rect.width}px`;
      hot.style.height = `${rect.height}px`;
      hot.style.zIndex = String(1 + byArea.findIndex((o) => o.node === node));
      hot.setAttribute("aria-label", `${label}, open in the catalog`);
      hot.append(el(doc, "span", undefined, label));
      hot.addEventListener("click", () => options.open(name));
      hots.append(hot);
      if (had && had === hot.getAttribute("aria-label")) hot.focus();
    }
  };

  const view = doc.defaultView;
  let frame = 0;
  const later = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  };
  if (typeof ResizeObserver !== "undefined") {
    const watch = new ResizeObserver(later);
    watch.observe(stage);
    options.signal.addEventListener("abort", () => watch.disconnect());
  } else view?.addEventListener("resize", later, { signal: options.signal });
  doc.fonts?.ready.then(later);
  options.signal.addEventListener("abort", () => cancelAnimationFrame(frame));
  layout();

  outlines.addEventListener(
    "click",
    () => {
      const on = stage.classList.toggle("show-outlines");
      outlines.setAttribute("aria-pressed", String(on));
      outlinesState.textContent = on ? "On" : "Off";
    },
    { signal: options.signal },
  );
  return section;
}
