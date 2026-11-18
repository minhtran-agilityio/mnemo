export type CardData = { id: string; title: string; meta: string };

// Builds one board card. Content goes in as text, never as HTML.
export function buildCard(card: CardData): HTMLElement {
  const el = document.createElement("article");
  el.className = "card";
  el.dataset.cardId = card.id;
  el.tabIndex = 0;
  const title = document.createElement("strong");
  title.textContent = card.title;
  const meta = document.createElement("span");
  meta.className = "card-meta";
  meta.textContent = card.meta;
  el.append(title, meta);
  return el;
}
