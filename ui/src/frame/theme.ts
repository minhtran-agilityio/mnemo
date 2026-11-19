// The theme choice: System (the default), Light or Dark. It is kept in the settings store under
// the key `theme` and applied as a data-theme attribute on the root element (see tokens.css),
// plus the color-scheme, so the built-in controls match. System removes both and follows the OS:
// tokens.css reads prefers-color-scheme itself, so an OS change shows at once with no script.

/** The settings key that keeps the theme choice. */
export const THEME_KEY = "theme";

export type Theme = "system" | "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];

/** The plain name of each choice, for the screen. */
export const THEME_LABELS: Readonly<Record<Theme, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** A saved value as a theme. A missing or unknown value means System. */
export function parseTheme(value: string | null | undefined): Theme {
  return THEMES.find((theme) => theme === value) ?? "system";
}

/** Shows `theme` on the root element. System removes the override so the OS decides. */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  if (theme === "system") {
    root.removeAttribute("data-theme");
    root.style.removeProperty("color-scheme");
  } else {
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
  }
}
