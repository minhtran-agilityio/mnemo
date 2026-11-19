// A hash router: the address is `#/<item id>`, and `#/everything?q=<word>` carries a search.
// An unknown address opens Today, so the window is never blank.
import {
  EVERYTHING_ID,
  findItem,
  HOME_ID,
  hashItemPath,
  type NavItem,
} from "./nav";

export interface Route {
  item: NavItem;
  /** The searched text, only on the Everything screen. Null when there is none. */
  query: string | null;
}

const HOME = findItem(HOME_ID) as NavItem;

export function parseHash(hash: string): Route {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path = "", search = ""] = splitOnce(text, "?");
  const item = findItem(path.replace(/^\/+/, "")) ?? HOME;
  if (item.id !== EVERYTHING_ID) return { item, query: null };
  const query = new URLSearchParams(search).get("q");
  return { item, query: query?.trim() ? query : null };
}

export function hashFor(id: string, query?: string | null): string {
  const base = hashItemPath(id);
  if (id !== EVERYTHING_ID || !query?.trim()) return base;
  return `${base}?${new URLSearchParams({ q: query })}`;
}

function splitOnce(text: string, separator: string): [string, string] {
  const at = text.indexOf(separator);
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + 1)];
}

export interface Router {
  /** Opens the screen for the current address and keeps following changes. */
  start(): void;
  go(id: string, query?: string | null): void;
}

export function createRouter(
  win: Pick<Window, "location" | "addEventListener">,
  onRoute: (route: Route) => void,
): Router {
  const show = () => onRoute(parseHash(win.location.hash));
  return {
    start() {
      win.addEventListener("hashchange", show);
      show();
    },
    go(id, query) {
      const next = hashFor(id, query);
      // Opening the same address again fires no hashchange, so show it directly.
      if (win.location.hash === next) show();
      else win.location.hash = next;
    },
  };
}
