import "./fonts";
import "./ds";
import "./style.css";
import "./screens/settings/settings.css";
import { getVersion } from "@tauri-apps/api/app";
import { textClasses } from "./ds";
import { renderEmptyState } from "./frame/empty-state";
import { EVERYTHING_ID } from "./frame/nav";
import { createRouter, splitHash } from "./frame/router";
import {
  createSidebarFromSaved,
  ReadTimeoutError,
  readCollapsed,
} from "./frame/sidebar";
import {
  applyTheme,
  loadSavedTheme,
  readCachedTheme,
  saveAndCacheTheme,
  THEME_KEY,
  type Theme,
  ThemeReadTimeoutError,
} from "./frame/theme";
import { pingErrorText } from "./ping-text";
import { renderSettings } from "./screens/settings/settings";
import { errorMessage, getSetting, ping, setSetting } from "./shared/api";
import { versionErrorText, versionText } from "./version-text";

/** The settings key that keeps whether the sidebar is collapsed ("true" or "false"). */
const COLLAPSED_KEY = "sidebar_collapsed";
/** The id of the sidebar item that opens Settings. */
const SETTINGS_ID = "settings";

const status = document.querySelector<HTMLElement>("#ping-status");
const versionEl = document.querySelector<HTMLElement>("#app-version");
const themeNote = document.querySelector<HTMLElement>("#theme-read-note");
const readNote = document.querySelector<HTMLElement>("#setting-read-note");
const saveNote = document.querySelector<HTMLElement>("#setting-save-note");
const themeSaveNote = document.querySelector<HTMLElement>("#theme-save-note");
const screen = document.querySelector<HTMLElement>("#screen");
const content = document.querySelector<HTMLElement>("#app-content");
const frame = document.querySelector<HTMLElement>("#app");

// The status lines under the page take the look of the text part: muted and small.
for (const line of document.querySelectorAll<HTMLElement>(".app-status"))
  line.classList.add(...textClasses({ tone: "muted", size: "sm" }));

/** Each kind of failure has its own line, so a save that works never clears a read failure. */
function showNote(note: HTMLElement | null, text: string | null): void {
  if (!note) return;
  note.textContent = text ?? "";
  note.hidden = text === null;
}

/** The saved collapsed state. A failed read gives an open sidebar and a visible line. */
function loadCollapsed(): Promise<boolean> {
  return readCollapsed(
    () => getSetting(COLLAPSED_KEY),
    (error) => {
      console.error("could not read the sidebar setting:", error);
      showNote(
        readNote,
        `Mnemo could not read the saved sidebar setting, so the sidebar is open. ${error instanceof ReadTimeoutError ? error.message : errorMessage(error)}`,
      );
    },
  );
}

// One save at a time, in order, so the last click is the value that stays.
let saving: Promise<void> = Promise.resolve();
function saveCollapsed(collapsed: boolean): void {
  saving = saving.then(async () => {
    try {
      await setSetting(COLLAPSED_KEY, String(collapsed));
      showNote(saveNote, null);
    } catch (error) {
      console.error("could not save the sidebar setting:", error);
      showNote(
        saveNote,
        `Mnemo could not save the sidebar setting, so it will be open again the next time Mnemo starts. ${errorMessage(error)}`,
      );
    }
  });
}

// The theme in use now. It starts as the last known theme, applied here before the first paint,
// while the saved choice is still being read.
let currentTheme: Theme = readCachedTheme(localStorage);
applyTheme(document.documentElement, currentTheme);

function useTheme(theme: Theme): void {
  currentTheme = theme;
  applyTheme(document.documentElement, theme);
}

/** The saved theme, applied at once. A failed read gives the system theme and a visible line. */
async function loadTheme(): Promise<void> {
  currentTheme = await loadSavedTheme(
    document.documentElement,
    localStorage,
    () => getSetting(THEME_KEY),
    (error) => {
      console.error("could not read the theme setting:", error);
      showNote(
        themeNote,
        `Mnemo could not read the saved theme, so it uses the system theme. ${error instanceof ThemeReadTimeoutError ? error.message : errorMessage(error)}`,
      );
    },
  );
}

async function showPing(): Promise<void> {
  if (!status) return;
  try {
    status.textContent = await ping();
  } catch (error) {
    status.textContent = pingErrorText(error);
  }
}

async function showVersion(): Promise<void> {
  if (!versionEl) return;
  try {
    versionEl.textContent = versionText(await getVersion());
  } catch (error) {
    console.error("getVersion failed:", error);
    versionEl.textContent = versionErrorText();
  }
}

/** Undoes what the open screen changed outside itself, before the next screen opens. */
let leaveScreen: (() => void) | null = null;
/** Counts route changes, so a screen that finishes loading after the owner left is not shown. */
let routeCount = 0;

async function start(): Promise<void> {
  if (!screen || !content || !frame) return;
  const router = createRouter(window, (route) => {
    const visit = ++routeCount;
    leaveScreen?.();
    leaveScreen = null;
    // The UI Catalog is dev only: a release build drops this branch and the catalog code with it.
    // It is not a sidebar item, so no item is marked current while it is open.
    if (
      import.meta.env.DEV &&
      splitHash(window.location.hash).path === "ui-catalog"
    ) {
      sidebar.setCurrent("");
      document.title = "UI Catalog - Mnemo";
      screen.textContent = "Loading the UI Catalog...";
      import("./screens/catalog/catalog")
        .then(({ renderCatalog }) => {
          if (visit !== routeCount) return;
          leaveScreen = renderCatalog(screen, {
            getTheme: () => currentTheme,
          });
        })
        .catch((error: unknown) => {
          console.error("could not load the UI Catalog:", error);
          if (visit === routeCount)
            screen.textContent = `The UI Catalog could not load. ${errorMessage(error)}`;
        });
      return;
    }
    sidebar.setCurrent(route.item.id);
    if (route.item.id === SETTINGS_ID) {
      renderSettings(screen, {
        getTheme: () => currentTheme,
        applyTheme: useTheme,
        saveTheme: (theme) =>
          saveAndCacheTheme(
            (value) => setSetting(THEME_KEY, value),
            localStorage,
            theme,
          ),
        onDetachedSave: (failure) => showNote(themeSaveNote, failure),
      });
    } else {
      renderEmptyState(screen, route);
    }
    document.title = `${route.item.label} - Mnemo`;
  });
  // The theme and the sidebar state are read first, so the frame is built in its final state
  // and never shows in the wrong theme.
  const themeLoaded = loadTheme();
  const sidebar = await createSidebarFromSaved(document, loadCollapsed, {
    onToggle: saveCollapsed,
    onSearch: (text) => router.go(EVERYTHING_ID, text),
  });
  await themeLoaded;
  frame.insertBefore(sidebar.element, content);
  router.start();
}

/** Start-up must never end in a blank window: a failure shows a plain line instead. */
function startFailedText(error: unknown): string {
  return `Mnemo could not build its window. Quit Mnemo and start it again. ${errorMessage(error)}`;
}

start().catch((error: unknown) => {
  console.error("start-up failed:", error);
  if (screen) screen.textContent = startFailedText(error);
});
void showPing();
void showVersion();
