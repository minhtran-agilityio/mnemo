// A saved link in the three Bookmarks views: a card (Cards), a row (List) and a compact row
// (Compact). Honest failure: a page Mnemo could not read keeps the link only, with no summary. A
// summary the app wrote is labelled "Written by AI", and a reason it guessed is labelled "Guess".
// A long title wraps (card) or is cut off with its full text in the tooltip (rows); a long URL is
// cut off with the full URL in the tooltip.
import { Link, PowerOff } from "lucide";
import { createIcon } from "../../icon";
import { createListRow } from "../list-row/list-row";
import {
  type AppId,
  createAppBadge,
  createMetaLine,
} from "../metadata-line/metadata-line";
import { buildSpinner } from "../spinner/spinner";
import { buildTrustLabel } from "../trust-label/trust-label";
import "./link-card.css";

export interface LinkItem {
  readonly title: string;
  readonly url: string;
  readonly app: AppId;
  readonly age: string;
  /** The summary text. Leave out when Mnemo has none. */
  readonly summary?: string;
  /** Who wrote the summary. A guess is labelled as one. Default `ai`. */
  readonly summaryKind?: "ai" | "guess";
  /** Why there is no summary. Default `unreadable` (Mnemo could not read the page). */
  readonly status?: "reading" | "unreadable" | "ai-off";
}

function textEl<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

const NO_SUMMARY = {
  unreadable: "Link only. Mnemo could not read this page.",
  "ai-off": "No summary: AI is off.",
  reading: "Reading the page",
} as const;

/** The honest line under a link: the summary with its label, or why there is none. */
export function noSummaryText(item: LinkItem): string {
  return NO_SUMMARY[item.status ?? "unreadable"];
}

function reading(doc: Document): HTMLElement {
  const box = doc.createElement("span");
  box.className = "rec-reading";
  box.setAttribute("role", "status");
  box.append(buildSpinner(), doc.createTextNode(NO_SUMMARY.reading));
  return box;
}

export function createLinkCard(
  doc: Document,
  item: LinkItem,
  options: { thumb?: boolean } = {},
): HTMLElement {
  const card = doc.createElement("article");
  card.className = "lcard";
  if (options.thumb) {
    const thumb = doc.createElement("div");
    thumb.className = "thumb";
    thumb.append(createIcon(Link));
    card.append(thumb);
  }
  card.append(createMetaLine(doc, [createAppBadge(doc, item.app), item.age]));
  const title = textEl(doc, "div", "title", item.title);
  title.title = item.title;
  const url = textEl(doc, "div", "url", item.url);
  url.title = item.url;
  card.append(title, url);
  if (item.summary) {
    card.append(
      textEl(doc, "div", "sum", item.summary),
      buildTrustLabel(item.summaryKind ?? "ai"),
    );
  } else if (item.status === "reading") {
    card.append(reading(doc));
  } else {
    const none = doc.createElement("div");
    none.className = "nosum";
    none.append(
      createIcon(item.status === "ai-off" ? PowerOff : Link),
      doc.createTextNode(noSummaryText(item)),
    );
    card.append(none);
  }
  return card;
}

/** The List view: one row per link, with the summary (or why there is none) on a second line. */
export function createLinkRow(doc: Document, item: LinkItem): HTMLLIElement {
  const row = createListRow(doc, {
    title: item.title,
    sub: item.summary ?? noSummaryText(item),
    icon: Link,
  });
  row.append(createMetaLine(doc, [createAppBadge(doc, item.app), item.age]));
  return row;
}

/** The Compact view: the title, the site and the age on one line. */
export function createCompactRow(doc: Document, item: LinkItem): HTMLLIElement {
  const li = doc.createElement("li");
  li.className = "compact-row";
  li.tabIndex = 0;
  const title = textEl(doc, "span", "row-title", item.title);
  title.title = item.title;
  const host = item.url.split("/")[0];
  const dom = textEl(doc, "span", "dom", host);
  dom.title = item.url;
  li.append(title, dom, textEl(doc, "span", "row-meta", item.age));
  return li;
}

export type LinkView = "list" | "cards" | "compact";

/** One of the three Bookmarks views of the same links. */
export function createLinkView(
  doc: Document,
  view: LinkView,
  items: readonly LinkItem[],
): HTMLElement {
  if (view === "cards") {
    const grid = doc.createElement("div");
    grid.className = "views cards";
    grid.append(...items.map((i) => createLinkCard(doc, i, { thumb: true })));
    return grid;
  }
  const ul = doc.createElement("ul");
  ul.className = "list";
  ul.setAttribute(
    "aria-label",
    view === "list" ? "Links, list view" : "Links, compact view",
  );
  ul.append(
    ...items.map((i) =>
      view === "list" ? createLinkRow(doc, i) : createCompactRow(doc, i),
    ),
  );
  return ul;
}
