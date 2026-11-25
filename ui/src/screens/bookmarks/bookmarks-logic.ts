// The plain rules of the Bookmarks screen (#25): how a saved link becomes a link card, which
// actions its card offers, the saved date, and how a changed bookmark joins the list.
import type { LinkItem, LinkStatus } from "../../ds";
import type { SavedBookmark, SummaryStatus } from "../../shared/api";

/** An action a card offers. */
export type CardAction = "paste" | "later";

/** The visible name of each action. The acceptance tests find the buttons by these names. */
export const ACTION_LABELS = {
  paste: "Paste the text",
  later: "Summarize later",
} as const;

const STATUS: Record<SummaryStatus, LinkStatus> = {
  pending: "pending",
  reading: "reading",
  unreadable: "unreadable",
  ai_off: "ai-off",
  done: "done",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** The saved date as "25 Nov 2026" (UTC, as the core stores it), or the text as it is. */
export function savedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * A saved link as the link card shows it. The title falls back to the site, then the link. A
 * summary is passed only when the status is done, so a link that was not read never shows one.
 */
export function toLinkItem(b: SavedBookmark): LinkItem {
  const done = b.summaryStatus === "done";
  return {
    title: b.title ?? b.site ?? b.url,
    url: b.url,
    site: b.site ?? undefined,
    saved: savedDate(b.createdAt),
    status: STATUS[b.summaryStatus] ?? "pending",
    summary: done ? (b.summary ?? undefined) : undefined,
    tags: done ? b.tags : undefined,
    tagsKind: "ai",
    reason: done ? (b.reason ?? undefined) : undefined,
    reasonKind: b.reasonIsGuess ? "guess" : "owner",
  };
}

/**
 * The actions of a card, in order. Unreadable: "Paste the text". No summary yet (pending or AI
 * off): "Summarize later". A page that could not be reached for now (pending with the stored
 * `pageNotReached`) offers both (owner decision on #25: "Offer both"). The flag is on the stored
 * row, so a list reload or a restart keeps both actions.
 */
export function actionsFor(b: SavedBookmark): CardAction[] {
  switch (b.summaryStatus) {
    case "unreadable":
      return ["paste"];
    case "pending":
      return b.pageNotReached === true ? ["later", "paste"] : ["later"];
    case "ai_off":
      return ["later"];
    default:
      return [];
  }
}

/**
 * The one action the card shows until the link card takes several (UI request issue 179): "Paste the
 * text" when it is among the actions (the acceptance criterion names it for a link the app could
 * not read), else the first.
 */
export function shownAction(b: SavedBookmark): CardAction | null {
  const actions = actionsFor(b);
  return actions.includes("paste") ? "paste" : (actions[0] ?? null);
}

/** The list with `b` in it: an existing bookmark is replaced in place, a new one goes first. */
export function upsert<T extends SavedBookmark>(
  items: readonly T[],
  b: T,
): T[] {
  const at = items.findIndex((x) => x.id === b.id);
  if (at < 0) return [b, ...items];
  const next = items.slice();
  next[at] = b;
  return next;
}
