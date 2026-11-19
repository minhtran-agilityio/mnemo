// Link: an inline text link. Accent colour and an underline (colour is never the only signal), a
// hover and a focus ring. An external link shows an icon and says it opens outside Mnemo. A link
// that cannot be followed right now is plain text with the reason beside it. All text goes in as text.
import { ExternalLink } from "lucide";
import { createIcon } from "../../icon";
import { nextControlId } from "../field/id";
import "./link.css";

export interface LinkOptions {
  readonly label: string;
  /** Where it goes. Without one (or with a script address) the link is unavailable. */
  readonly href?: string;
  /** The address is outside Mnemo: shows an icon and says so to screen readers. */
  readonly external?: boolean;
  /** "inline" sits in a sentence; "standalone" stands alone with a bigger target. Default inline. */
  readonly variant?: "inline" | "standalone";
  /** Why it cannot be followed. Setting it makes the link unavailable: text plus this reason. */
  readonly unavailable?: string;
  /** Draws a state that is otherwise the pointer or the keyboard (the catalog shows them). */
  readonly forced?: "hover" | "focus";
  readonly onClick?: (event: MouseEvent) => void;
}

/** The words an external link adds for people who cannot see the icon. */
export const EXTERNAL_NOTE = "opens outside Mnemo";

const SCRIPT_ADDRESS = /^\s*(javascript|data|vbscript):/i;

/**
 * Builds the link. An available one is an `a`; an unavailable one is a `span` with
 * `aria-disabled` inside a wrapper that also holds the visible reason, so the reason is read with it.
 */
export function createLink(doc: Document, options: LinkOptions): HTMLElement {
  const variant = options.variant ?? "inline";
  const blocked =
    options.unavailable !== undefined ||
    !options.href ||
    SCRIPT_ADDRESS.test(options.href);

  if (blocked) {
    const wrap = doc.createElement("span");
    wrap.className = "lnk-wrap";
    const text = doc.createElement("span");
    text.className = `lnk lnk-${variant} is-unavailable`;
    text.setAttribute("aria-disabled", "true");
    text.textContent = options.label;
    const reason = doc.createElement("span");
    reason.className = "lnk-reason";
    reason.id = nextControlId("lnk-reason");
    reason.textContent =
      options.unavailable ?? "This address is not available.";
    text.setAttribute("aria-describedby", reason.id);
    wrap.append(text, reason);
    return wrap;
  }

  const link = doc.createElement("a");
  link.className = `lnk lnk-${variant}`;
  if (options.forced) link.classList.add(`is-${options.forced}`);
  link.href = options.href as string;
  link.append(doc.createTextNode(options.label));
  if (options.external) {
    link.classList.add("is-external");
    link.rel = "noopener noreferrer";
    const note = doc.createElement("span");
    note.className = "lnk-note";
    note.textContent = ` (${EXTERNAL_NOTE})`;
    link.append(createIcon(ExternalLink), note);
  }
  if (options.onClick) link.addEventListener("click", options.onClick);
  return link;
}
