// "Keep editing": the address already changed (a Back, a Forward or a link), and the owner chose to
// stay. This puts the screen's address back by adding an entry. It never rewrites the entry the
// owner moved to, so the browser history keeps every place the owner had. pushState fires no
// hashchange, so nothing is drawn again.

/** Puts `hash` (the address of the screen on show) back as the current address. */
export function keepPlace(win: Window, hash: string): void {
  const target = hash || "#/";
  if (win.location.hash === target) return;
  win.history.pushState(null, "", target);
}
