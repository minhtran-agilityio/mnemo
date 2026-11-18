import "./fonts";
import "./tokens.css";
import "./base.css";
import "./style.css";
import "./frame/sidebar.css";
import { getVersion } from "@tauri-apps/api/app";
import { renderEmptyState } from "./frame/empty-state";
import { EVERYTHING_ID } from "./frame/nav";
import { createRouter } from "./frame/router";
import { createSidebar } from "./frame/sidebar";
import { pingErrorText } from "./ping-text";
import { errorMessage, getSetting, ping, setSetting } from "./shared/api";
import { versionErrorText, versionText } from "./version-text";

/** The settings key that keeps whether the sidebar is collapsed ("true" or "false"). */
const COLLAPSED_KEY = "sidebar_collapsed";
/** How long the start waits for the saved state before it shows the sidebar open. */
const READ_TIMEOUT_MS = 2000;

const status = document.querySelector<HTMLElement>("#ping-status");
const versionEl = document.querySelector<HTMLElement>("#app-version");
const note = document.querySelector<HTMLElement>("#setting-note");
const screen = document.querySelector<HTMLElement>("#screen");
const content = document.querySelector<HTMLElement>("#app-content");
const frame = document.querySelector<HTMLElement>("#app");

function showNote(text: string | null): void {
  if (!note) return;
  note.textContent = text ?? "";
  note.hidden = text === null;
}

/** The saved collapsed state. A failed read gives an open sidebar and a visible line. */
async function loadCollapsed(): Promise<boolean> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), READ_TIMEOUT_MS),
  );
  try {
    return (
      (await Promise.race([getSetting(COLLAPSED_KEY), timeout])) === "true"
    );
  } catch (error) {
    console.error("could not read the sidebar setting:", error);
    showNote(
      `Mnemo could not read the saved sidebar setting, so the sidebar is open. ${errorMessage(error)}`,
    );
    return false;
  }
}

// One save at a time, in order, so the last click is the value that stays.
let saving: Promise<void> = Promise.resolve();
function saveCollapsed(collapsed: boolean): void {
  saving = saving.then(async () => {
    try {
      await setSetting(COLLAPSED_KEY, String(collapsed));
      showNote(null);
    } catch (error) {
      console.error("could not save the sidebar setting:", error);
      showNote(
        `Mnemo could not save the sidebar setting, so it will be open again the next time Mnemo starts. ${errorMessage(error)}`,
      );
    }
  });
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

async function start(): Promise<void> {
  if (!screen || !content || !frame) return;
  const collapsed = await loadCollapsed();
  const router = createRouter(window, (route) => {
    sidebar.setCurrent(route.item.id);
    renderEmptyState(screen, route);
    document.title = `${route.item.label} - Mnemo`;
  });
  const sidebar = createSidebar(document, {
    collapsed,
    onToggle: saveCollapsed,
    onSearch: (text) => router.go(EVERYTHING_ID, text),
  });
  frame.insertBefore(sidebar.element, content);
  router.start();
}

void start();
void showPing();
void showVersion();
