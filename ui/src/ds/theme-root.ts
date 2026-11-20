// The one place that writes a palette choice onto the root element: the data-theme attribute that
// tokens.css reads, and the color-scheme that the built-in controls (radios, scroll bars) follow.
// It lives in the design system because it sets a look; ui/src/frame/theme.ts decides the choice.
// It mirrors ui/public/theme-boot.js, which runs before the first paint.

/** Shows the light or dark palette on `root`, or removes the choice (null) so the OS decides. */
export function setRootTheme(
  root: HTMLElement,
  theme: "light" | "dark" | null,
): void {
  if (theme === null) {
    root.removeAttribute("data-theme");
    root.style.removeProperty("color-scheme");
  } else {
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
  }
}
