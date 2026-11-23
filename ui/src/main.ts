import "./fonts";
import "./ds";
import "./style.css";
import "./screens/settings/settings.css";
import "./screens/ideas/ideas.css";
import { getVersion } from "@tauri-apps/api/app";
import { createToastRegion, type ToastRegion } from "./ds";
import { renderEmptyState } from "./frame/empty-state";
import { keepPlace } from "./frame/keep-place";
import { EVERYTHING_ID, isRoadmapItem, UI_CATALOG_ID } from "./frame/nav";
import { createRouter, type Route } from "./frame/router";
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
  THEME_CACHE_KEY,
  THEME_KEY,
  type Theme,
  ThemeReadTimeoutError,
} from "./frame/theme";
import { pingErrorText } from "./ping-text";
import { renderIdeas } from "./screens/ideas/ideas";
import { renderNotes } from "./screens/notes/notes";
import { renderSettings } from "./screens/settings/settings";
import {
  addIdea,
  checkAiHealth,
  countLabelDeleteMoves,
  createLabel,
  dataFolderInfo,
  deleteLabel,
  errorMessage,
  exportData,
  getAiHealth,
  getAiMode,
  getSetting,
  listBookmarks,
  listIdeas,
  listLabelledNotes,
  listLabels,
  listNotes,
  moveLabel,
  openDataFolder,
  pickFolder,
  ping,
  renameLabel,
  resetData,
  runTestPrompt,
  saveLabelledNote,
  setSetting,
  turnIdeaIntoProject,
  updateIdea,
} from "./shared/api";
import { versionErrorText, versionText } from "./version-text";

/** The settings key that keeps whether the sidebar is collapsed ("true" or "false"). */
const COLLAPSED_KEY = "sidebar_collapsed";
/** The id of the sidebar item that opens Settings. */
const SETTINGS_ID = "settings";
/** The id of the sidebar item that opens Notes. */
const NOTES_ID = "notes";
/** The id of the sidebar item that opens Ideas (#34). */
const IDEAS_ID = "ideas";

const status = document.querySelector<HTMLElement>("#ping-status");
const versionEl = document.querySelector<HTMLElement>("#app-version");
const themeNote = document.querySelector<HTMLElement>("#theme-read-note");
const readNote = document.querySelector<HTMLElement>("#setting-read-note");
const saveNote = document.querySelector<HTMLElement>("#setting-save-note");
const themeSaveNote = document.querySelector<HTMLElement>("#theme-save-note");
const screen = document.querySelector<HTMLElement>("#screen");
const content = document.querySelector<HTMLElement>("#app-content");
const frame = document.querySelector<HTMLElement>("#app");

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
/**
 * Asks the open screen whether it may close (Notes with unsaved changes asks the owner).
 * Null when the screen can always close.
 */
let canLeaveScreen: (() => Promise<boolean>) | null = null;
/** The address of the screen on show, so "Keep editing" can put it back. */
let shownHash = "";
/** Counts route changes, so a screen that finishes loading after the owner left is not shown. */
let routeCount = 0;

/** The app's one toast region, added to the page the first time a screen needs it. */
let toastRegion: ToastRegion | null = null;
function toast(message: string): void {
  if (!toastRegion) {
    toastRegion = createToastRegion();
    document.body.append(toastRegion.element);
  }
  toastRegion.show(message);
}

async function start(): Promise<void> {
  if (!screen || !content || !frame) return;
  const router = createRouter(window, (route) => {
    const visit = ++routeCount;
    // The address has already changed. A screen that must ask first keeps the old screen up
    // until the owner answers; a newer route change while it asks wins (visit check).
    const ask = canLeaveScreen;
    if (ask) {
      const back = shownHash;
      void ask().then((ok) => {
        if (visit !== routeCount) return;
        if (ok) {
          canLeaveScreen = null;
          showRoute(route, visit);
        } else {
          // Stay: put the address back without a hashchange and without rewriting history.
          keepPlace(window, back);
        }
      });
      return;
    }
    showRoute(route, visit);
  });

  function showRoute(route: Route, visit: number): void {
    if (!screen) return;
    leaveScreen?.();
    leaveScreen = null;
    canLeaveScreen = null;
    shownHash = window.location.hash;
    const { item } = route;
    sidebar.setCurrent(item.id);
    // The UI Catalog is dev only: a release build drops this branch and the catalog code with it,
    // and its router never returns the catalog item.
    if (import.meta.env.DEV && item.id === UI_CATALOG_ID) {
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
    if (item.id === NOTES_ID) {
      const notes = renderNotes(screen, {
        listLabelledNotes,
        listLabels,
        saveLabelledNote,
        createLabel,
        renameLabel,
        moveLabel,
        deleteLabel,
        countLabelDeleteMoves,
        toast,
      });
      leaveScreen = notes.leave;
      canLeaveScreen = notes.canLeave;
    } else if (item.id === SETTINGS_ID) {
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
        getAiHealth,
        getAiMode,
        checkAiHealth,
        runTestPrompt,
        pickFolder,
        exportData,
        resetData,
        dataFolderInfo,
        openDataFolder,
        afterReset: (complete) => {
          // A complete reset deleted the theme with the data, so its cached copy goes too.
          // After a partial one the setting may have survived, so the cache stays.
          if (complete) {
            try {
              localStorage.removeItem(THEME_CACHE_KEY);
            } catch {
              // Blocked storage has nothing cached to forget.
            }
          }
          location.reload();
        },
      });
    } else if (item.id === IDEAS_ID) {
      leaveScreen = renderIdeas(screen, {
        listIdeas,
        addIdea,
        updateIdea,
        turnIdeaIntoProject,
        listBookmarks,
        listNotes,
      });
    } else if (isRoadmapItem(item)) {
      renderEmptyState(screen, { item, query: route.query });
    } else {
      // A dev-only tool with no screen of its own yet.
      screen.textContent = `${item.label} has no screen yet.`;
    }
    document.title = `${item.label} - Mnemo`;
  }
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
