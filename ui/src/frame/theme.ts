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

/** How long start-up waits for the saved theme before it uses System. */
export const THEME_READ_LIMIT_MS = 10_000;

/** The error `readTheme` reports when the read takes longer than its limit. */
export class ThemeReadTimeoutError extends Error {
  constructor(limitMs: number) {
    super(`The saved theme did not load within ${limitMs / 1000} seconds.`);
    this.name = "ThemeReadTimeoutError";
  }
}

/**
 * The saved theme from a read of the setting. A failed or slow read gives System, and
 * `onError` hears about it so the owner can see a line. Start-up never waits forever.
 */
export async function readTheme(
  read: () => Promise<string | null>,
  onError: (error: unknown) => void,
  limitMs: number = THEME_READ_LIMIT_MS,
): Promise<Theme> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ThemeReadTimeoutError(limitMs)),
      limitMs,
    );
  });
  try {
    return parseTheme(await Promise.race([read(), limit]));
  } catch (error) {
    onError(error);
    return "system";
  } finally {
    clearTimeout(timer);
  }
}
