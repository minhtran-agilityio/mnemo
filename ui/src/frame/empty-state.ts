// The screen every item shows until its own screen is built: its name and the phase it
// comes in. Everything shows the searched word. All text goes in as text, never as markup.
import type { Route } from "./router";

/** Fills `container` with the empty state for `route` and returns its heading. */
export function renderEmptyState(
  container: HTMLElement,
  route: Route,
): HTMLElement {
  const doc = container.ownerDocument;
  const { item, query } = route;

  const heading = doc.createElement("h1");
  heading.className = "empty-title";
  heading.tabIndex = -1;
  heading.textContent = item.label;

  const meta = doc.createElement("p");
  meta.className = "empty-meta";
  const phase = doc.createElement("span");
  phase.textContent = `Phase ${item.phase}`;
  meta.append(phase);
  if (item.later) {
    const later = doc.createElement("span");
    later.className = "later-mark";
    later.textContent = "Later";
    meta.append(" ", later);
  }

  const message = doc.createElement("p");
  message.className = "empty-text";
  message.textContent = item.later
    ? `Planned for later, after the first version. It comes in Phase ${item.phase}.`
    : `Not built yet. It comes in Phase ${item.phase}.`;

  const section = doc.createElement("section");
  section.className = "empty-state";
  section.append(heading, meta, message);

  if (query !== null) {
    const searched = doc.createElement("p");
    searched.className = "empty-query";
    const word = doc.createElement("strong");
    word.textContent = query;
    searched.append("You searched for: ", word);
    const note = doc.createElement("p");
    note.className = "empty-text";
    note.textContent = "Search is not built yet, so there are no results.";
    section.append(searched, note);
  }

  container.replaceChildren(section);
  return heading;
}
