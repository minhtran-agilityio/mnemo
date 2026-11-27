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

/** The ds link card has five statuses; a site that was not reached shows as "No summary yet". */
const STATUS: Record<SummaryStatus, LinkStatus> = {
  pending: "pending",
  reading: "reading",
  unreadable: "unreadable",
  ai_off: "ai-off",
  not_reached: "pending",
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
 * `alreadySaved` adds the "Already saved" note (#28): the owner saved this link again.
 */
export function toLinkItem(b: SavedBookmark, alreadySaved = false): LinkItem {
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
    alreadySaved: alreadySaved ? true : undefined,
    // The core's folder flag is passed as it is, in every status (a link filed with AI off is
    // in Unsorted with no guess).
    folder: b.folder,
    folderIsGuess: b.folderIsGuess,
    folderReason: b.folderReason ?? undefined,
  };
}

/**
 * The actions of a card, in order. Unreadable: "Paste the text". No summary yet (pending or AI
 * off): "Summarize later". A site that was not reached (`not_reached`, a stored status, so a
 * list reload or a restart keeps it) offers both (owner decision on #25: "Offer both").
 */
export function actionsFor(b: SavedBookmark): CardAction[] {
  switch (b.summaryStatus) {
    case "unreadable":
      return ["paste"];
    case "not_reached":
      return ["later", "paste"];
    case "pending":
      return ["later"];
    case "ai_off":
      return ["later"];
    default:
      return [];
  }
}

/**
 * The list with `b` in it: an existing bookmark is replaced in place, a new one goes first. A
 * deleted bookmark (the owner deleted it while it was read) leaves the list.
 */
export function upsert<T extends SavedBookmark>(
  items: readonly T[],
  b: T,
): T[] {
  if (b.deletedAt) return items.filter((x) => x.id !== b.id);
  const at = items.findIndex((x) => x.id === b.id);
  if (at < 0) return [b, ...items];
  const next = items.slice();
  next[at] = b;
  return next;
}

/**
 * The list with the bookmark `b` first, taken out of its old place when it is in the list (a link
 * the owner saved again, #28): the list gets no second row for it. A deleted bookmark leaves the
 * list, as in `upsert`.
 */
export function moveToTop<T extends SavedBookmark>(
  items: readonly T[],
  b: T,
): T[] {
  const rest = items.filter((x) => x.id !== b.id);
  return b.deletedAt ? rest : [b, ...rest];
}

/**
 * The list with `b` back in it after an Undo: a bookmark already in the list is replaced in place;
 * one that is not (a delete taken back) goes where its saved date puts it, newest first.
 */
export function restore<T extends SavedBookmark>(
  items: readonly T[],
  b: T,
): T[] {
  if (b.deletedAt) return items.filter((x) => x.id !== b.id);
  if (items.some((x) => x.id === b.id)) return upsert(items, b);
  const at = items.findIndex((x) => x.createdAt < b.createdAt);
  const next = items.slice();
  next.splice(at < 0 ? next.length : at, 0, b);
  return next;
}

/** "1 bookmark" or "3 bookmarks". */
export function bookmarkCount(n: number): string {
  return `${n} ${n === 1 ? "bookmark" : "bookmarks"}`;
}

/** The reason Unsorted gives for a refused rename or delete (the menu shows it, disabled). */
export const UNSORTED_REFUSED = {
  rename: "Unsorted is the default folder. It cannot be renamed.",
  delete: "Unsorted is the default folder. It cannot be deleted.",
} as const;
