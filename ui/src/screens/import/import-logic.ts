// The Import screen's words and choices (#29), as plain functions of the core's answers, so the
// screen keeps no rules of its own and each state is tested.
import type {
  AiWaitReason,
  ImportFault,
  ImportPreview,
  ImportRetry,
  ImportStatus,
} from "../../shared/api";

/** The page's title and the line under it (the prototype's words). */
export const PAGE_TITLE = "Import bookmarks";
export const PAGE_CONTEXT =
  "Bring your old pile from a browser. Each link is saved and filed like a link you paste.";

/** What the first step asks for. */
export const PICK_TEXT =
  "Pick your browser's bookmarks file. In Chrome: Bookmarks › Bookmark manager › Export. In Firefox: Library › Import and backup › Export. You get one .html file. A text file with one link per line works too.";

/** The four steps, in order. */
export const STEPS = ["Pick a file", "Check", "Import", "Done"] as const;
export type Step = 0 | 1 | 2 | 3;

/** True when the import has ended: finished, or stopped by the owner. */
export function ended(s: ImportStatus): boolean {
  return s.state === "finished" || s.state === "stopped";
}

/** The step an import is on: Import while it runs or is paused, Done when it ended. */
export function stepOf(s: ImportStatus): Step {
  return ended(s) ? 3 : 2;
}

/** "1 link", "3 links". */
export function links(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "link" : "links"}`;
}

/** One count line of the confirm step. */
export interface CountLine {
  label: string;
  count: number;
  /** True for what is skipped (not stored). */
  skipped: boolean;
}

/** The counts the confirm step shows before anything is stored. */
export function previewLines(p: ImportPreview): CountLine[] {
  return [
    { label: "Links to add", count: p.toAdd, skipped: false },
    { label: "Repeats in the file", count: p.repeatsInFile, skipped: true },
    { label: "Already saved", count: p.alreadySaved, skipped: true },
    { label: "Not links", count: p.notLinks, skipped: true },
  ];
}

/** The confirm button's label, or why there is nothing to import. */
export function confirmAction(p: ImportPreview): {
  label: string;
  disabledWhy: string | null;
} {
  if (p.toAdd > 0)
    return { label: `Import ${links(p.toAdd)}`, disabledWhy: null };
  const why =
    p.found === 0
      ? "Mnemo found no links in this file. Pick a browser bookmarks export (HTML) or a text file with one link per line."
      : "Every link in this file is a repeat or is already saved. Nothing is new.";
  return { label: "Import", disabledWhy: why };
}

/** Why the import waits after a fault, and when it tries again (honest failure). */
export function retryText(retry: ImportRetry): string {
  const why: Record<ImportFault, string> = {
    unavailable: "Claude Code could not be started.",
    storage: "Mnemo could not save the import just now.",
    other: "The last summary did not finish.",
  };
  const n = retry.seconds;
  return `${why[retry.reason]} Mnemo tries again in about ${n} ${n === 1 ? "second" : "seconds"}.`;
}

/** Why AI may not run now, and that the import goes on by itself. */
export function waitText(reason: AiWaitReason): string {
  const why: Record<AiWaitReason, string> = {
    off: "AI is off. Turn it on in Settings to make the summaries.",
    limit: "Claude is at its usage limit.",
    threshold: "Usage is at the pause line set in Settings.",
    owner_pause: "Background work is paused in Settings.",
  };
  return `Waiting: ${why[reason]} The import goes on by itself when AI may run again.`;
}

/** The state line of an import. */
export function stateText(s: ImportStatus): string {
  if (s.state === "stopped")
    return 'Stopped. The links that got no summary are saved as link only; use "Summarize later" on a card.';
  if (s.state === "finished") {
    if (!s.withSummaries)
      return `Done. ${links(s.added)} added as link only. Use "Summarize later" on a card to make its summary.`;
    return s.failed > 0
      ? `Done. ${links(s.failed)} got no summary; their cards show what you can do.`
      : "Done.";
  }
  if (s.state === "paused") {
    return s.pausedBy === "closed"
      ? "Paused when Mnemo closed. Press Continue to go on."
      : "Paused. Press Continue to go on.";
  }
  if (s.waitReason) return waitText(s.waitReason);
  if (s.retry) return retryText(s.retry);
  return `Making summaries in the background, at most ${s.maxRuns} at a time.`;
}

/** "12 done, 36 waiting, 2 failed of 50". */
export function countsText(s: ImportStatus): string {
  const total = s.done + s.waiting + s.failed;
  return `${s.done.toLocaleString("en-US")} done, ${s.waiting.toLocaleString("en-US")} waiting, ${s.failed.toLocaleString("en-US")} failed of ${total.toLocaleString("en-US")}`;
}

/**
 * The Done line: "Import finished: 47 saved with a summary, 3 saved as link only, 5 skipped,
 * already saved or repeats." Links that got no summary are saved as link only.
 */
export function doneText(s: ImportStatus): string {
  const n = (x: number) => x.toLocaleString("en-US");
  const withSummary = s.withSummaries ? s.done : 0;
  // A link the owner deleted during the import is neither summarized nor kept.
  const linkOnly = Math.max(0, s.added - withSummary - s.removed);
  const skipped = s.alreadySaved + s.repeatsInFile;
  const parts = [
    `${n(withSummary)} saved with a summary`,
    `${n(linkOnly)} saved as link only`,
    `${n(skipped)} skipped, already saved or repeats`,
  ];
  if (s.notLinks > 0) parts.push(`${n(s.notLinks)} not links`);
  if (s.removed > 0) parts.push(`${n(s.removed)} deleted during the import`);
  return `${s.state === "stopped" ? "Import stopped" : "Import finished"}: ${parts.join(", ")}.`;
}

/** What the import found in the file, skipped entries included. */
export function foundText(s: ImportStatus): string {
  const skipped = [
    s.repeatsInFile > 0
      ? `${s.repeatsInFile.toLocaleString("en-US")} repeats in the file`
      : "",
    s.alreadySaved > 0
      ? `${s.alreadySaved.toLocaleString("en-US")} already saved`
      : "",
    s.notLinks > 0 ? `${s.notLinks.toLocaleString("en-US")} not links` : "",
  ].filter(Boolean);
  const added = `${links(s.added)} added`;
  return skipped.length
    ? `${added}; skipped ${skipped.join(", ")}.`
    : `${added}.`;
}

/** Share of the summaries that ended (done or failed), 0 to 100. */
export function percent(s: ImportStatus): number {
  const total = s.done + s.waiting + s.failed;
  return total === 0 ? 100 : Math.round(((s.done + s.failed) / total) * 100);
}

/** The one action an import offers now. */
export function importAction(s: ImportStatus): "pause" | "continue" | null {
  if (s.state === "running") return "pause";
  if (s.state === "paused") return "continue";
  return null;
}

/** True while "Stop here" may end the import (it runs or is paused). */
export function mayStop(s: ImportStatus): boolean {
  return !ended(s);
}

/** True when a new file may be imported (no import is unfinished). */
export function mayStartAnother(s: ImportStatus | null): boolean {
  return s === null || ended(s);
}

/**
 * Keeps the newer of two answers for the same import, so a late command reply never puts an
 * older count back on the screen. Another import always wins (it is newer).
 */
export function newer(
  current: ImportStatus | null,
  next: ImportStatus,
): ImportStatus {
  if (!current || current.id !== next.id) return next;
  const ended = (s: ImportStatus) => s.done + s.failed;
  if (ended(next) < ended(current)) return current;
  if (ended(next) === ended(current) && next.updatedAt < current.updatedAt)
    return current;
  return next;
}
