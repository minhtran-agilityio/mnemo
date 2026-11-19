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

/** The browser key for the copy of the last known theme. The settings store stays the truth. */
export const THEME_CACHE_KEY = "mnemo.theme";

/**
 * The last known theme, read at once with no wait, so the first paint is already in the right
 * theme while the settings store is still being read. Missing or blocked storage gives System.
 */
export function readCachedTheme(storage: Pick<Storage, "getItem">): Theme {
  try {
    return parseTheme(storage.getItem(THEME_CACHE_KEY));
  } catch {
    return "system";
  }
}

/**
 * Keeps a copy of `theme` for the next start. System is the default, so it needs no copy: the
 * copy is removed instead. A failure is safe: the next start reads the store.
 */
export function cacheTheme(
  storage: Pick<Storage, "setItem" | "removeItem">,
  theme: Theme,
): void {
  try {
    if (theme === "system") storage.removeItem(THEME_CACHE_KEY);
    else storage.setItem(THEME_CACHE_KEY, theme);
  } catch {
    // The copy is only a speed-up. Without it the next start shows System until the read ends.
  }
}

/**
 * Reads the saved theme, shows it on `root` and keeps a copy for the next start. A failed read
 * shows System but keeps the old copy, so one bad read does not replace a good last known theme.
 */
export async function loadSavedTheme(
  root: HTMLElement,
  storage: Pick<Storage, "setItem" | "removeItem">,
  read: () => Promise<string | null>,
  onError: (error: unknown) => void,
  limitMs: number = THEME_READ_LIMIT_MS,
): Promise<Theme> {
  let failed = false;
  const theme = await readTheme(
    read,
    (error) => {
      failed = true;
      onError(error);
    },
    limitMs,
  );
  applyTheme(root, theme);
  if (!failed) cacheTheme(storage, theme);
  return theme;
}

/** Saves `theme` and only then keeps a copy for the next start, so a failed save leaves no copy. */
export async function saveAndCacheTheme(
  save: (theme: Theme) => Promise<void>,
  storage: Pick<Storage, "setItem" | "removeItem">,
  theme: Theme,
): Promise<void> {
  await save(theme);
  cacheTheme(storage, theme);
}
