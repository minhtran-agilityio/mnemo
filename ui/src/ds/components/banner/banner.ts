import { CircleX, Info, TriangleAlert } from "lucide";
import { createFeedbackIcon } from "../feedback-icon/feedback-icon";
import "./banner.css";

export type BannerTone = "info" | "warn" | "bad";

export interface BannerOptions {
  readonly tone: BannerTone;
  /** A short bold lead, for example "Could not save the database." */
  readonly lead?: string;
  readonly message: string;
  /** One action at most. */
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

const ICONS = { info: Info, warn: TriangleAlert, bad: CircleX } as const;

/**
 * A banner. Info and warn are polite status messages; an error is an alert. The icon and the
 * words carry the tone, so colour is never the only signal.
 */
export function buildBanner(options: BannerOptions): HTMLDivElement {
  const banner = document.createElement("div");
  banner.className =
    options.tone === "info" ? "banner" : `banner banner-${options.tone}`;
  banner.setAttribute("role", options.tone === "bad" ? "alert" : "status");

  const msg = document.createElement("div");
  msg.className = "banner-msg";
  const text = document.createElement("span");
  if (options.lead) {
    const lead = document.createElement("b");
    lead.textContent = options.lead;
    text.append(lead, document.createTextNode(" "));
  }
  text.append(document.createTextNode(options.message));
  msg.append(createFeedbackIcon(ICONS[options.tone], "sm"), text);
  banner.append(msg);

  if (options.action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm banner-action";
    button.textContent = options.action.label;
    button.addEventListener("click", options.action.onClick);
    banner.append(button);
  }
  return banner;
}
