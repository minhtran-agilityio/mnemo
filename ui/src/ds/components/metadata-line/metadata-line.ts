// The metadata line of a record (age, count, source app) and the source app badge.
// App colours are the --app-* tokens. The badge shows the app name as text.
import "./metadata-line.css";

export const APP_LABELS = {
  telegram: "Telegram",
  zalo: "Zalo",
  slack: "Slack",
  gmail: "Gmail",
  gcal: "Calendar",
  github: "GitHub",
  gdrive: "Drive",
  bot: "Bot",
  tok: "TikTok",
} as const;

export type AppId = keyof typeof APP_LABELS;

export function createAppBadge(doc: Document, app: AppId): HTMLSpanElement {
  const span = doc.createElement("span");
  span.className = `app app-${app}`;
  span.textContent = APP_LABELS[app];
  return span;
}

/** A line of parts joined by a quiet dot. A part is text or a node (a badge). */
export function createMetaLine(
  doc: Document,
  parts: readonly (string | Node)[],
): HTMLDivElement {
  const line = doc.createElement("div");
  line.className = "meta";
  parts.forEach((part, i) => {
    if (i > 0) {
      const sep = doc.createElement("span");
      sep.className = "sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "·";
      line.append(sep);
    }
    if (typeof part === "string") {
      const span = doc.createElement("span");
      span.textContent = part;
      line.append(span);
    } else {
      line.append(part);
    }
  });
  return line;
}
